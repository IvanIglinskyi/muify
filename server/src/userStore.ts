// Persistent user state (likes, user playlists, play history, last playback) in one JSON file.
//
// - Location: $MUIFY_DATA_DIR (absolute, or relative to the working directory) or server/data-store/.
// - Writes are debounced and atomic: the JSON goes to a temp file first, then replaces the real
//   file with a rename, so a crash mid-write never leaves a truncated state file.
// - Catalogue data is NOT stored here, except snapshots of non-seed (Jamendo) tracks/albums the
//   listener references, so liked/playlist/history items still render after a restart even when
//   they are no longer in the in-memory Jamendo cache.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Album, HistoryEntry, Track } from "./types.js";

export interface StoredPlaylist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredPlayback {
  trackId: string;
  position: number;
  queue: string[];
  volume: number;
  updatedAt: string;
}

export interface UserState {
  version: 1;
  /** In like order (oldest first). */
  likedTrackIds: string[];
  likedAlbumIds: string[];
  playlists: StoredPlaylist[];
  /** Oldest first. */
  history: HistoryEntry[];
  playback: StoredPlayback | null;
  /** Snapshots of referenced non-seed tracks/albums (liked flag is not meaningful here). */
  trackMeta: Record<string, Track>;
  albumMeta: Record<string, Omit<Album, "liked">>;
}

const FILE_NAME = "user-state.json";
const SAVE_DEBOUNCE_MS = 300;
export const MAX_HISTORY = 2000;

function emptyState(): UserState {
  return {
    version: 1,
    likedTrackIds: [],
    likedAlbumIds: [],
    playlists: [],
    history: [],
    playback: null,
    trackMeta: {},
    albumMeta: {},
  };
}

export function dataDir(): string {
  const custom = process.env.MUIFY_DATA_DIR?.trim();
  if (custom) return path.resolve(custom);
  // Resolved from this file: works from src/ (tsx) and dist/ (node) alike.
  return fileURLToPath(new URL("../data-store/", import.meta.url));
}

const isStr = (v: unknown): v is string => typeof v === "string";
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Defensive parse: a hand-edited or older file never crashes the server. */
function normalize(raw: unknown): UserState {
  const s = emptyState();
  if (!isObj(raw)) return s;
  s.likedTrackIds = [...new Set(strList(raw.likedTrackIds))];
  s.likedAlbumIds = [...new Set(strList(raw.likedAlbumIds))];
  if (Array.isArray(raw.playlists)) {
    for (const p of raw.playlists) {
      if (!isObj(p) || !isStr(p.id) || !isStr(p.name)) continue;
      const now = new Date().toISOString();
      s.playlists.push({
        id: p.id,
        name: p.name,
        trackIds: [...new Set(strList(p.trackIds))],
        createdAt: isStr(p.createdAt) ? p.createdAt : now,
        updatedAt: isStr(p.updatedAt) ? p.updatedAt : now,
      });
    }
  }
  if (Array.isArray(raw.history)) {
    for (const h of raw.history) {
      if (!isObj(h) || !isStr(h.id) || !isStr(h.trackId) || !isStr(h.playedAt)) continue;
      s.history.push({ id: h.id, trackId: h.trackId, playedAt: h.playedAt, seconds: Math.max(0, finite(h.seconds, 0)) });
    }
    s.history = s.history.slice(-MAX_HISTORY);
  }
  const pb = raw.playback;
  if (isObj(pb) && isStr(pb.trackId)) {
    s.playback = {
      trackId: pb.trackId,
      position: Math.max(0, finite(pb.position, 0)),
      queue: strList(pb.queue),
      volume: Math.min(1, Math.max(0, finite(pb.volume, 0.8))),
      updatedAt: isStr(pb.updatedAt) ? pb.updatedAt : new Date().toISOString(),
    };
  }
  if (isObj(raw.trackMeta)) {
    for (const [id, t] of Object.entries(raw.trackMeta)) {
      if (isObj(t) && t.id === id && isStr(t.title) && isStr(t.artist)) s.trackMeta[id] = t as unknown as Track;
    }
  }
  if (isObj(raw.albumMeta)) {
    for (const [id, a] of Object.entries(raw.albumMeta)) {
      if (isObj(a) && a.id === id && isStr(a.title) && Array.isArray(a.trackIds)) {
        s.albumMeta[id] = a as unknown as Omit<Album, "liked">;
      }
    }
  }
  return s;
}

const filePath = () => path.join(dataDir(), FILE_NAME);

function load(): { state: UserState; existed: boolean } {
  const file = filePath();
  if (!existsSync(file)) return { state: emptyState(), existed: false };
  try {
    const state = normalize(JSON.parse(readFileSync(file, "utf8")));
    console.info(`[store] Loaded user state from ${file}`);
    return { state, existed: true };
  } catch (e) {
    // Keep the unreadable file for inspection instead of silently overwriting it.
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      renameSync(file, backup);
    } catch {
      /* ignore */
    }
    console.warn(`[store] Could not read ${file} (${(e as Error).message}); starting fresh. Old file kept as ${backup}`);
    return { state: emptyState(), existed: false };
  }
}

const loaded = load();

/** The live state. Mutate it, then call `markChanged()`. */
export const userState: UserState = loaded.state;
/** Whether a state file existed at startup (false on first run). */
export const userStateExisted = loaded.existed;

/** Hook to prune unreferenced snapshots right before each write (set by the catalogue). */
let beforeSave: (s: UserState) => void = () => {};
export function onBeforeSave(fn: (s: UserState) => void) {
  beforeSave = fn;
}

let timer: NodeJS.Timeout | null = null;
let dirty = false;
let writing: Promise<void> | null = null;

function serialize(): string {
  beforeSave(userState);
  return JSON.stringify(userState, null, 1);
}

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** temp file + rename. Windows can briefly lock the target (antivirus, indexer): retry a few times. */
async function writeAtomic(json: string): Promise<void> {
  const file = filePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, json, "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (attempt < 5 && RETRYABLE.has(code)) {
        await sleep(40 * (attempt + 1));
        continue;
      }
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }
}

async function flush(): Promise<void> {
  timer = null;
  if (writing) {
    // A write is in progress: run again once it is done (state may have changed since).
    await writing;
    if (!dirty || timer) return;
  }
  if (!dirty) return;
  dirty = false;
  writing = writeAtomic(serialize())
    .catch((e) => {
      dirty = true; // try again on the next change
      console.error(`[store] Saving user state failed: ${(e as Error).message}`);
    })
    .finally(() => {
      writing = null;
    });
  await writing;
}

/** Schedules a debounced save. */
export function markChanged(): void {
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
}

/** Resolves once everything changed so far is on disk (used by tests / shutdown). */
export async function flushNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await flush();
}

/** Synchronous last-chance write on shutdown. */
function flushSync(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!dirty) return;
  dirty = false;
  const file = filePath();
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(tmp, serialize(), "utf8");
    renameSync(tmp, file);
  } catch (e) {
    console.error(`[store] Final save failed: ${(e as Error).message}`);
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => {
    flushSync();
    process.exit(0);
  });
}
process.once("beforeExit", flushSync);
