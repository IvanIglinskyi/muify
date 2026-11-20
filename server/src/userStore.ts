// Per-user state (profile, likes, user playlists, play history, last playback, metadata snapshots)
// behind one interface with two backends:
//
// - "firebase": Firebase Realtime Database under users/{uid}/… (see firebase.ts). Each user's tree
//   is loaded once into memory, and every mutation records a small multi-path patch
//   ("likes/tracks/j123": 1700000000000, "history/<id>/s": 42, …). Patches are merged and flushed
//   with a debounce as ONE update() call, so a history ping never rewrites the whole user tree.
// - "file": the original single-user JSON file (server/data-store/user-state.json or
//   $MUIFY_DATA_DIR) used when Firebase is not configured. There is one implicit user ("local").
//
// RTDB keys may not contain . $ # [ ] / (or control chars): every id used as a key goes through
// encodeKey(). Values (track ids inside arrays, titles…) are unrestricted.
//
// Catalogue data is NOT stored, except snapshots of non-seed (Jamendo) tracks/albums the user
// references, so liked/playlist/history items still render after a restart.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authMode, firebase, firebaseConfigInfo } from "./firebase.js";
import type { Album, AppNotification, CatalogSource, HistoryEntry, Language, Track } from "./types.js";

export interface StoredPlaylist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
  description?: string;
  /** Public link id while sharing is on (see sharedPlaylists/ in RTDB). */
  shareId?: string;
}

/** Shape of a public share id (random, URL-safe). */
export const SHARE_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

export interface StoredPlayback {
  trackId: string;
  position: number;
  queue: string[];
  volume: number;
  updatedAt: string;
}

export interface UserProfile {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  /** Accent colour of the initials avatar (#rrggbb). */
  accentColor: string | null;
  /** Show the provider photo (Google) instead of initials when there is one. */
  usePhoto: boolean;
  /** UI language, or null for the browser default. */
  language: Language | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredFollow {
  name: string;
  imageUrl?: string;
  source: CatalogSource;
  /** Followed at (ms). */
  at: number;
}

export interface UserState {
  /** id → liked-at (ms). Map iteration order = like order (oldest first). */
  likedTracks: Map<string, number>;
  likedAlbums: Map<string, number>;
  playlists: StoredPlaylist[];
  /** Oldest first. */
  history: HistoryEntry[];
  playback: StoredPlayback | null;
  /** Snapshots of referenced non-seed tracks/albums (liked flag is not meaningful here). */
  trackMeta: Record<string, Track>;
  albumMeta: Record<string, Omit<Album, "liked">>;
  profile: UserProfile | null;
  /** artistId → follow. Map order = follow order (oldest first). */
  follows: Map<string, StoredFollow>;
  /** id → notification (oldest first). */
  notifications: Map<string, AppNotification>;
  /** Last new-release lookup (ms), or null. */
  notifCheckedAt: number | null;
  /** Recent search queries, newest first. */
  searches: string[];
}

export const MAX_HISTORY = 2000;
export const MAX_FOLLOWS = 500;
export const MAX_NOTIFICATIONS = 50;
export const MAX_SEARCHES = 10;
export const LOCAL_UID = "local";

function emptyState(): UserState {
  return {
    likedTracks: new Map(),
    likedAlbums: new Map(),
    playlists: [],
    history: [],
    playback: null,
    trackMeta: {},
    albumMeta: {},
    profile: null,
    follows: new Map(),
    notifications: new Map(),
    notifCheckedAt: null,
    searches: [],
  };
}

// ---------------------------------------------------------------------------
// RTDB key encoding
// ---------------------------------------------------------------------------
/** Percent-encodes anything RTDB forbids in keys (. $ # [ ] / and control chars) — and "%" itself. */
export function encodeKey(id: string): string {
  if (id === "") return "%00empty";
  return id.replace(/[.$#[\]/%\x00-\x1f\x7f]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

export function decodeKey(key: string): string {
  if (key === "%00empty") return "";
  return key.replace(/%([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

// ---------------------------------------------------------------------------
// Defensive parsing (hand-edited files / older data never crash the server)
// ---------------------------------------------------------------------------
const isStr = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
/** RTDB returns arrays as arrays or (sparse) objects keyed "0", "1", … */
function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter(isStr);
  if (isObj(v)) {
    return Object.entries(v)
      .filter(([k, x]) => /^\d+$/.test(k) && isStr(x))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, x]) => x as string);
  }
  return [];
}
const nowIso = () => new Date().toISOString();

function parsePlaylist(id: string, p: unknown): StoredPlaylist | null {
  if (!isObj(p) || !isStr(p.name)) return null;
  const now = nowIso();
  const out: StoredPlaylist = {
    id,
    name: p.name,
    trackIds: [...new Set(strList(p.trackIds))],
    createdAt: isStr(p.createdAt) ? p.createdAt : now,
    updatedAt: isStr(p.updatedAt) ? p.updatedAt : now,
  };
  if (isStr(p.description) && p.description.trim()) out.description = p.description;
  if (isStr(p.shareId) && SHARE_ID_RE.test(p.shareId)) out.shareId = p.shareId;
  return out;
}

function parsePlayback(pb: unknown): StoredPlayback | null {
  if (!isObj(pb) || !isStr(pb.trackId)) return null;
  return {
    trackId: pb.trackId,
    position: Math.max(0, finite(pb.position, 0)),
    queue: strList(pb.queue),
    volume: Math.min(1, Math.max(0, finite(pb.volume, 0.8))),
    updatedAt: isStr(pb.updatedAt) ? pb.updatedAt : nowIso(),
  };
}

function parseTrackMeta(id: string, t: unknown): Track | null {
  if (!isObj(t) || t.id !== id || !isStr(t.title) || !isStr(t.artist)) return null;
  return { ...(t as unknown as Track), genres: strList(t.genres) };
}

function parseAlbumMeta(id: string, a: unknown): Omit<Album, "liked"> | null {
  if (!isObj(a) || a.id !== id || !isStr(a.title)) return null;
  return { ...(a as unknown as Album), trackIds: strList(a.trackIds), genres: strList(a.genres) };
}

function parseProfile(p: unknown): UserProfile | null {
  if (!isObj(p)) return null;
  const s = (v: unknown) => (isStr(v) ? v : null);
  return {
    displayName: s(p.displayName),
    email: s(p.email),
    photoURL: s(p.photoURL),
    accentColor: isStr(p.accentColor) && /^#[0-9a-fA-F]{6}$/.test(p.accentColor) ? p.accentColor : null,
    usePhoto: p.usePhoto !== false,
    language: p.language === "uk" || p.language === "en" ? p.language : null,
    createdAt: s(p.createdAt) ?? nowIso(),
    updatedAt: s(p.updatedAt) ?? nowIso(),
  };
}

function parseFollow(f: unknown): StoredFollow | null {
  if (!isObj(f) || !isStr(f.name)) return null;
  const out: StoredFollow = {
    name: f.name,
    source: f.source === "jamendo" ? "jamendo" : "seed",
    at: finite(f.at, Date.now()),
  };
  if (isStr(f.imageUrl) && /^https:\/\//.test(f.imageUrl)) out.imageUrl = f.imageUrl;
  return out;
}

const NOTIF_FIELDS = ["albumId", "albumTitle", "artistId", "artistName", "coverUrl", "releaseDate"] as const;

function parseNotification(id: string, n: unknown): AppNotification | null {
  if (!isObj(n) || (n.kind !== "release" && n.kind !== "welcome") || !isStr(n.createdAt)) return null;
  const out: AppNotification = { id, kind: n.kind, createdAt: n.createdAt, read: n.read === true };
  for (const k of NOTIF_FIELDS) {
    const v = n[k];
    if (isStr(v)) out[k] = v;
  }
  if (n.demo === true) out.demo = true;
  return out;
}

function parseSearches(v: unknown): string[] {
  return strList(v)
    .map((q) => q.trim())
    .filter((q) => q && q.length <= 100)
    .slice(0, MAX_SEARCHES);
}

/** Notifications oldest → newest (Map order). */
function notificationMap(list: AppNotification[]): Map<string, AppNotification> {
  return new Map(list.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((n) => [n.id, n]));
}

/** The v1 JSON file format (local mode). Fields after `albumMeta` were added later (all optional). */
interface FileStateV1 {
  version: 1;
  likedTrackIds: string[];
  likedAlbumIds: string[];
  playlists: StoredPlaylist[];
  history: HistoryEntry[];
  playback: StoredPlayback | null;
  trackMeta: Record<string, Track>;
  albumMeta: Record<string, Omit<Album, "liked">>;
  profile?: UserProfile | null;
  follows?: Record<string, StoredFollow>;
  notifications?: AppNotification[];
  notifCheckedAt?: number | null;
  searches?: string[];
}

function fromFile(raw: unknown): UserState {
  const s = emptyState();
  if (!isObj(raw)) return s;
  const t0 = Date.now();
  strList(raw.likedTrackIds).forEach((id, i) => s.likedTracks.set(id, t0 + i));
  strList(raw.likedAlbumIds).forEach((id, i) => s.likedAlbums.set(id, t0 + i));
  if (Array.isArray(raw.playlists)) {
    for (const p of raw.playlists) {
      const parsed = isObj(p) && isStr(p.id) ? parsePlaylist(p.id, p) : null;
      if (parsed) s.playlists.push(parsed);
    }
  }
  if (Array.isArray(raw.history)) {
    for (const h of raw.history) {
      if (!isObj(h) || !isStr(h.id) || !isStr(h.trackId) || !isStr(h.playedAt)) continue;
      s.history.push({ id: h.id, trackId: h.trackId, playedAt: h.playedAt, seconds: Math.max(0, finite(h.seconds, 0)) });
    }
    s.history = s.history.slice(-MAX_HISTORY);
  }
  s.playback = parsePlayback(raw.playback);
  if (isObj(raw.trackMeta)) {
    for (const [id, t] of Object.entries(raw.trackMeta)) {
      const parsed = parseTrackMeta(id, t);
      if (parsed) s.trackMeta[id] = parsed;
    }
  }
  if (isObj(raw.albumMeta)) {
    for (const [id, a] of Object.entries(raw.albumMeta)) {
      const parsed = parseAlbumMeta(id, a);
      if (parsed) s.albumMeta[id] = parsed;
    }
  }
  s.profile = parseProfile(raw.profile);
  if (isObj(raw.follows)) {
    for (const [id, f] of Object.entries(raw.follows)) {
      const parsed = parseFollow(f);
      if (parsed) s.follows.set(id, parsed);
    }
  }
  if (Array.isArray(raw.notifications)) {
    s.notifications = notificationMap(
      raw.notifications
        .map((n) => (isObj(n) && isStr(n.id) ? parseNotification(n.id, n) : null))
        .filter((n): n is AppNotification => Boolean(n))
    );
  }
  s.notifCheckedAt = typeof raw.notifCheckedAt === "number" ? raw.notifCheckedAt : null;
  s.searches = parseSearches(raw.searches);
  return s;
}

function toFile(s: UserState): FileStateV1 {
  return {
    version: 1,
    likedTrackIds: [...s.likedTracks.keys()],
    likedAlbumIds: [...s.likedAlbums.keys()],
    playlists: s.playlists,
    history: s.history,
    playback: s.playback,
    trackMeta: s.trackMeta,
    albumMeta: s.albumMeta,
    profile: s.profile,
    follows: Object.fromEntries(s.follows),
    notifications: [...s.notifications.values()],
    notifCheckedAt: s.notifCheckedAt,
    searches: s.searches,
  };
}

/** RTDB tree of users/{uid} → state. */
function fromRtdb(raw: unknown): UserState {
  const s = emptyState();
  if (!isObj(raw)) return s;
  const likeMap = (v: unknown, into: Map<string, number>) => {
    if (!isObj(v)) return;
    Object.entries(v)
      .map(([k, at]) => [decodeKey(k), finite(at, 0)] as const)
      .sort((a, b) => a[1] - b[1])
      .forEach(([id, at]) => into.set(id, at));
  };
  if (isObj(raw.likes)) {
    likeMap(raw.likes.tracks, s.likedTracks);
    likeMap(raw.likes.albums, s.likedAlbums);
  }
  if (isObj(raw.playlists)) {
    for (const [k, p] of Object.entries(raw.playlists)) {
      const parsed = parsePlaylist(decodeKey(k), p);
      if (parsed) s.playlists.push(parsed);
    }
    s.playlists.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  if (isObj(raw.history)) {
    for (const [k, h] of Object.entries(raw.history)) {
      if (!isObj(h) || !isStr(h.t) || !isStr(h.at)) continue;
      s.history.push({ id: decodeKey(k), trackId: h.t, playedAt: h.at, seconds: Math.max(0, finite(h.s, 0)) });
    }
    s.history.sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  }
  s.playback = parsePlayback(raw.player);
  if (isObj(raw.meta)) {
    if (isObj(raw.meta.tracks)) {
      for (const [k, t] of Object.entries(raw.meta.tracks)) {
        const id = decodeKey(k);
        const parsed = parseTrackMeta(id, t);
        if (parsed) s.trackMeta[id] = parsed;
      }
    }
    if (isObj(raw.meta.albums)) {
      for (const [k, a] of Object.entries(raw.meta.albums)) {
        const id = decodeKey(k);
        const parsed = parseAlbumMeta(id, a);
        if (parsed) s.albumMeta[id] = parsed;
      }
    }
  }
  s.profile = parseProfile(raw.profile);
  if (isObj(raw.follows)) {
    const list = Object.entries(raw.follows)
      .map(([k, f]) => [decodeKey(k), parseFollow(f)] as const)
      .filter((e): e is readonly [string, StoredFollow] => Boolean(e[1]))
      .sort((a, b) => a[1].at - b[1].at);
    for (const [id, f] of list) s.follows.set(id, f);
  }
  if (isObj(raw.notifications)) {
    const n = raw.notifications;
    if (isObj(n.items)) {
      s.notifications = notificationMap(
        Object.entries(n.items)
          .map(([k, v]) => parseNotification(decodeKey(k), v))
          .filter((x): x is AppNotification => Boolean(x))
      );
    }
    s.notifCheckedAt = typeof n.checkedAt === "number" ? n.checkedAt : null;
  }
  s.searches = parseSearches(raw.searches);
  return s;
}

/** JSON-safe copy (RTDB rejects `undefined`). */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const playlistValue = (p: StoredPlaylist) => ({
  name: p.name,
  trackIds: p.trackIds,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  // Absent (not null) when unset: the whole node is replaced on every save.
  ...(p.description ? { description: p.description } : {}),
  ...(p.shareId ? { shareId: p.shareId } : {}),
});

const historyValue = (h: HistoryEntry) => ({ t: h.trackId, at: h.playedAt, s: h.seconds });

// ---------------------------------------------------------------------------
// Patch merging. RTDB rejects one update() whose keys overlap ("a" and "a/b"), so a new path
// replaces pending descendants and is folded into a pending ancestor.
// ---------------------------------------------------------------------------
function setNested(target: Record<string, unknown>, segs: string[], value: unknown) {
  let obj = target;
  for (let i = 0; i < segs.length - 1; i++) {
    const next = obj[segs[i]];
    obj = obj[segs[i]] = isObj(next) ? { ...next } : {};
  }
  const last = segs[segs.length - 1];
  if (value === null) delete obj[last];
  else obj[last] = value;
}

export function mergePatch(patch: Map<string, unknown>, p: string, value: unknown): void {
  for (const k of [...patch.keys()]) if (k.startsWith(`${p}/`)) patch.delete(k);
  const segs = p.split("/");
  for (let i = 1; i < segs.length; i++) {
    const ancestor = segs.slice(0, i).join("/");
    if (patch.has(ancestor)) {
      const base = patch.get(ancestor);
      const copy: Record<string, unknown> = isObj(base) ? { ...base } : {};
      setNested(copy, segs.slice(i), value);
      patch.set(ancestor, Object.keys(copy).length ? copy : null);
      return;
    }
  }
  patch.set(p, value);
}

// ---------------------------------------------------------------------------
// UserDoc: one user's live state + pending patch
// ---------------------------------------------------------------------------
interface Backend {
  schedule(doc: UserDoc): void;
}

export class UserDoc {
  /** Set once the account is deleted: later mutations are dropped, never written. */
  deleted = false;
  readonly pending = new Map<string, unknown>();
  lastUsed = Date.now();

  constructor(
    readonly uid: string,
    readonly state: UserState,
    private readonly backend: Backend
  ) {}

  private put(p: string, value: unknown) {
    if (this.deleted) return;
    mergePatch(this.pending, p, value === undefined ? null : value);
    this.backend.schedule(this);
  }

  /** Takes the pending patch for writing (null if nothing to write). */
  takePatch(): Record<string, unknown> | null {
    if (this.pending.size === 0) return null;
    const out = Object.fromEntries(this.pending);
    this.pending.clear();
    return out;
  }

  /** Puts a failed patch back underneath newer pending changes. */
  restorePatch(patch: Record<string, unknown>) {
    if (this.deleted) return;
    const newer = new Map(this.pending);
    this.pending.clear();
    for (const [k, v] of Object.entries(patch)) mergePatch(this.pending, k, v);
    for (const [k, v] of newer) mergePatch(this.pending, k, v);
  }

  // ---- likes ----
  setTrackLike(id: string, liked: boolean) {
    if (liked === this.state.likedTracks.has(id)) return;
    const at = Date.now();
    if (liked) this.state.likedTracks.set(id, at);
    else this.state.likedTracks.delete(id);
    this.put(`likes/tracks/${encodeKey(id)}`, liked ? at : null);
  }

  setAlbumLike(id: string, liked: boolean) {
    if (liked === this.state.likedAlbums.has(id)) return;
    const at = Date.now();
    if (liked) this.state.likedAlbums.set(id, at);
    else this.state.likedAlbums.delete(id);
    this.put(`likes/albums/${encodeKey(id)}`, liked ? at : null);
  }

  // ---- playlists ----
  /** Insert or replace (after editing the object in place). */
  savePlaylist(p: StoredPlaylist) {
    if (!this.state.playlists.includes(p)) this.state.playlists.push(p);
    this.put(`playlists/${encodeKey(p.id)}`, clean(playlistValue(p)));
  }

  removePlaylist(id: string) {
    this.state.playlists = this.state.playlists.filter((p) => p.id !== id);
    this.put(`playlists/${encodeKey(id)}`, null);
  }

  // ---- history ----
  addHistory(entry: HistoryEntry) {
    this.state.history.push(entry);
    this.put(`history/${encodeKey(entry.id)}`, historyValue(entry));
    const excess = this.state.history.length - MAX_HISTORY;
    if (excess > 0) {
      for (const old of this.state.history.splice(0, excess)) this.put(`history/${encodeKey(old.id)}`, null);
    }
  }

  setHistorySeconds(entry: HistoryEntry, seconds: number) {
    entry.seconds = seconds;
    this.put(`history/${encodeKey(entry.id)}/s`, seconds);
  }

  clearHistory(): number {
    const n = this.state.history.length;
    this.state.history = [];
    this.put("history", null);
    return n;
  }

  // ---- player ----
  setPlayback(pb: StoredPlayback) {
    const prev = this.state.playback;
    this.state.playback = pb;
    const sameQueue = prev !== null && prev.queue.length === pb.queue.length && prev.queue.every((id, i) => id === pb.queue[i]);
    if (!prev || !sameQueue) {
      this.put("player", clean(pb));
      return;
    }
    // Position pings: a handful of small fields, not the whole queue.
    if (prev.trackId !== pb.trackId) this.put("player/trackId", pb.trackId);
    if (prev.position !== pb.position) this.put("player/position", pb.position);
    if (prev.volume !== pb.volume) this.put("player/volume", pb.volume);
    this.put("player/updatedAt", pb.updatedAt);
  }

  // ---- metadata snapshots ----
  snapshotTrack(t: Track) {
    const snap = clean({ ...t, liked: false });
    const prev = this.state.trackMeta[t.id];
    if (prev && JSON.stringify(prev) === JSON.stringify(snap)) return;
    this.state.trackMeta[t.id] = snap;
    this.put(`meta/tracks/${encodeKey(t.id)}`, snap);
  }

  snapshotAlbum(a: Omit<Album, "liked">) {
    const snap = clean(a);
    const prev = this.state.albumMeta[a.id];
    if (prev && JSON.stringify(prev) === JSON.stringify(snap)) return;
    this.state.albumMeta[a.id] = snap;
    this.put(`meta/albums/${encodeKey(a.id)}`, snap);
  }

  /** Drops snapshots nothing refers to any more (runs before each write). */
  pruneMeta() {
    const s = this.state;
    const keepTracks = new Set<string>([
      ...s.likedTracks.keys(),
      ...s.playlists.flatMap((p) => p.trackIds),
      ...s.history.map((h) => h.trackId),
      ...(s.playback ? [s.playback.trackId, ...s.playback.queue] : []),
    ]);
    for (const id of Object.keys(s.albumMeta)) {
      if (s.likedAlbums.has(id)) s.albumMeta[id].trackIds.forEach((t) => keepTracks.add(t));
      else {
        delete s.albumMeta[id];
        this.put(`meta/albums/${encodeKey(id)}`, null);
      }
    }
    for (const id of Object.keys(s.trackMeta)) {
      if (!keepTracks.has(id)) {
        delete s.trackMeta[id];
        this.put(`meta/tracks/${encodeKey(id)}`, null);
      }
    }
  }

  // ---- follows ----
  setFollow(artistId: string, follow: StoredFollow | null) {
    if (follow) {
      this.state.follows.delete(artistId); // re-insert at the end (follow order)
      this.state.follows.set(artistId, follow);
    } else if (!this.state.follows.delete(artistId)) return;
    this.put(`follows/${encodeKey(artistId)}`, follow ? clean(follow) : null);
  }

  // ---- notifications ----
  /** Adds (or replaces) notifications; keeps the newest MAX_NOTIFICATIONS. */
  addNotifications(list: AppNotification[]) {
    if (!list.length) return;
    const all = notificationMap([...this.state.notifications.values(), ...list.map((n) => ({ ...n }))]);
    for (const n of list) this.put(`notifications/items/${encodeKey(n.id)}`, clean({ ...all.get(n.id)!, id: undefined }));
    const excess = all.size - MAX_NOTIFICATIONS;
    if (excess > 0) {
      for (const id of [...all.keys()].slice(0, excess)) {
        all.delete(id);
        this.put(`notifications/items/${encodeKey(id)}`, null);
      }
    }
    this.state.notifications = all;
  }

  /** Marks the given (or all) notifications read; returns how many changed. */
  markNotificationsRead(ids: string[] | "all"): number {
    let n = 0;
    for (const item of this.state.notifications.values()) {
      if (item.read || (ids !== "all" && !ids.includes(item.id))) continue;
      item.read = true;
      n++;
      this.put(`notifications/items/${encodeKey(item.id)}/read`, true);
    }
    return n;
  }

  setNotifCheckedAt(at: number) {
    this.state.notifCheckedAt = at;
    this.put("notifications/checkedAt", at);
  }

  // ---- recent searches ----
  setSearches(list: string[]) {
    this.state.searches = list.slice(0, MAX_SEARCHES);
    this.put("searches", this.state.searches.length ? [...this.state.searches] : null);
  }

  // ---- profile ----
  updateProfile(changes: Partial<Omit<UserProfile, "createdAt" | "updatedAt">>) {
    const now = nowIso();
    const base: UserProfile = this.state.profile ?? {
      displayName: null,
      email: null,
      photoURL: null,
      accentColor: null,
      usePhoto: true,
      language: null,
      createdAt: now,
      updatedAt: now,
    };
    const next: UserProfile = { ...base, ...changes, updatedAt: now };
    const isNew = !this.state.profile;
    this.state.profile = next;
    if (isNew) this.put("profile", clean(next));
    else {
      for (const [k, v] of Object.entries(changes)) this.put(`profile/${k}`, v ?? null);
      this.put("profile/updatedAt", now);
    }
  }

  /** Plain JSON export of everything stored for this user. */
  exportJson() {
    const s = this.state;
    return {
      profile: s.profile,
      likedTracks: [...s.likedTracks].map(([id, at]) => ({ id, likedAt: new Date(at).toISOString() })),
      likedAlbums: [...s.likedAlbums].map(([id, at]) => ({ id, likedAt: new Date(at).toISOString() })),
      playlists: s.playlists,
      history: s.history,
      playback: s.playback,
      trackSnapshots: s.trackMeta,
      albumSnapshots: s.albumMeta,
      followedArtists: [...s.follows].map(([id, f]) => ({
        id,
        name: f.name,
        source: f.source,
        imageUrl: f.imageUrl ?? null,
        followedAt: new Date(f.at).toISOString(),
      })),
      notifications: [...s.notifications.values()],
      recentSearches: s.searches,
    };
  }
}

// ---------------------------------------------------------------------------
// Hooks (set by the catalogue)
// ---------------------------------------------------------------------------
interface DocHooks {
  /** A doc was loaded into memory. `fresh` = no stored state existed yet. */
  onLoad(doc: UserDoc, fresh: boolean): void;
}
let hooks: DocHooks = { onLoad: () => {} };
export function setDocHooks(h: DocHooks) {
  hooks = h;
}

export interface UserStore {
  readonly kind: "file" | "firebase";
  get(uid: string): Promise<UserDoc>;
  /** Deletes everything stored for `uid` (pending writes are dropped), incl. their public links. */
  delete(uid: string): Promise<void>;
  flushAll(): Promise<void>;
  /** Registers a public link (Firebase: sharedPlaylists/{shareId} → { ownerUid, playlistId }). */
  putShare(shareId: string, uid: string, playlistId: string): Promise<void>;
  removeShare(shareId: string): Promise<void>;
  /** The playlist behind a public link, or null (unknown link, sharing turned off, owner gone). */
  resolveShare(shareId: string): Promise<{ doc: UserDoc; playlist: StoredPlaylist } | null>;
}

/** The owner's playlist that currently carries `shareId` (the link only works while it does). */
function sharedPlaylistOf(doc: UserDoc, shareId: string, playlistId?: string): StoredPlaylist | null {
  if (doc.deleted) return null;
  return doc.state.playlists.find((p) => p.shareId === shareId && (playlistId === undefined || p.id === playlistId)) ?? null;
}

// ---------------------------------------------------------------------------
// File backend (local mode)
// ---------------------------------------------------------------------------
const FILE_NAME = "user-state.json";
const SAVE_DEBOUNCE_MS = 300;

export function dataDir(): string {
  const custom = process.env.MUIFY_DATA_DIR?.trim();
  if (custom) return path.resolve(custom);
  // Resolved from this file: works from src/ (tsx) and dist/ (node) alike.
  return fileURLToPath(new URL("../data-store/", import.meta.url));
}

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FileUserStore implements UserStore, Backend {
  readonly kind = "file" as const;
  private doc: UserDoc | null = null;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private writing: Promise<void> | null = null;

  private filePath() {
    return path.join(dataDir(), FILE_NAME);
  }

  private load(): UserDoc {
    const file = this.filePath();
    let state = emptyState();
    let existed = false;
    if (existsSync(file)) {
      try {
        state = fromFile(JSON.parse(readFileSync(file, "utf8")));
        existed = true;
        console.info(`[store] Loaded user state from ${file}`);
      } catch (e) {
        // Keep the unreadable file for inspection instead of silently overwriting it.
        const backup = `${file}.corrupt-${Date.now()}`;
        try {
          renameSync(file, backup);
        } catch {
          /* ignore */
        }
        console.warn(`[store] Could not read ${file} (${(e as Error).message}); starting fresh. Old file kept as ${backup}`);
      }
    }
    const doc = new UserDoc(LOCAL_UID, state, this);
    hooks.onLoad(doc, !existed);
    return doc;
  }

  async get(uid: string): Promise<UserDoc> {
    if (uid !== LOCAL_UID) throw new Error("The file store only holds the local user");
    this.doc ??= this.load();
    return this.doc;
  }

  schedule() {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS);
  }

  private serialize(): string {
    const doc = this.doc!;
    doc.pruneMeta();
    doc.takePatch(); // the file is always rewritten whole
    return JSON.stringify(toFile(doc.state), null, 1);
  }

  /** temp file + rename. Windows can briefly lock the target (antivirus, indexer): retry a few times. */
  private async writeAtomic(json: string): Promise<void> {
    const file = this.filePath();
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

  private async flush(): Promise<void> {
    this.timer = null;
    if (this.writing) {
      await this.writing;
      if (!this.dirty || this.timer) return;
    }
    if (!this.dirty || !this.doc) return;
    this.dirty = false;
    this.writing = this.writeAtomic(this.serialize())
      .catch((e) => {
        this.dirty = true;
        console.error(`[store] Saving user state failed: ${(e as Error).message}`);
      })
      .finally(() => {
        this.writing = null;
      });
    await this.writing;
  }

  async flushAll(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  flushSync(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty || !this.doc) return;
    this.dirty = false;
    const file = this.filePath();
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(tmp, this.serialize(), "utf8");
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

  // Local mode: the share id lives on the playlist itself — no separate index needed.
  async putShare(): Promise<void> {}
  async removeShare(): Promise<void> {}
  async resolveShare(shareId: string): Promise<{ doc: UserDoc; playlist: StoredPlaylist } | null> {
    const doc = await this.get(LOCAL_UID);
    const playlist = sharedPlaylistOf(doc, shareId);
    return playlist ? { doc, playlist } : null;
  }

  async delete(): Promise<void> {
    // Local mode has no accounts; "delete" resets the local state.
    const doc = await this.get(LOCAL_UID);
    doc.state.likedTracks.clear();
    doc.state.likedAlbums.clear();
    doc.state.playlists = [];
    doc.state.history = [];
    doc.state.playback = null;
    doc.state.follows.clear();
    doc.state.notifications.clear();
    doc.state.notifCheckedAt = null;
    doc.state.searches = [];
    this.schedule();
  }
}

// ---------------------------------------------------------------------------
// Firebase Realtime Database backend
// ---------------------------------------------------------------------------
const RTDB_DEBOUNCE_MS = 400;
const RTDB_MAX_DELAY_MS = 3000;
const IDLE_EVICT_MS = 30 * 60_000;
const userPath = (uid: string) => `users/${encodeKey(uid)}`;
const sharePath = (shareId: string) => `sharedPlaylists/${encodeKey(shareId)}`;

class RtdbUserStore implements UserStore, Backend {
  readonly kind = "firebase" as const;
  private docs = new Map<string, UserDoc>();
  private loading = new Map<string, Promise<UserDoc>>();
  private timers = new Map<string, { timer: NodeJS.Timeout; firstAt: number }>();
  private inflight = new Map<string, Promise<void>>();

  constructor() {
    setInterval(() => this.evictIdle(), 5 * 60_000).unref();
  }

  async get(uid: string): Promise<UserDoc> {
    const known = this.docs.get(uid);
    if (known) {
      known.lastUsed = Date.now();
      return known;
    }
    let p = this.loading.get(uid);
    if (!p) {
      p = (async () => {
        const fb = await firebase();
        const raw = await fb.db.get(userPath(uid));
        const doc = new UserDoc(uid, fromRtdb(raw), this);
        hooks.onLoad(doc, raw == null);
        this.docs.set(uid, doc);
        return doc;
      })().finally(() => this.loading.delete(uid));
      this.loading.set(uid, p);
    }
    return p;
  }

  schedule(doc: UserDoc) {
    const t = this.timers.get(doc.uid);
    const firstAt = t?.firstAt ?? Date.now();
    if (t) clearTimeout(t.timer);
    const wait = Math.max(0, Math.min(RTDB_DEBOUNCE_MS, firstAt + RTDB_MAX_DELAY_MS - Date.now()));
    this.timers.set(doc.uid, { timer: setTimeout(() => void this.flushDoc(doc), wait), firstAt });
  }

  private async flushDoc(doc: UserDoc): Promise<void> {
    const t = this.timers.get(doc.uid);
    if (t) clearTimeout(t.timer);
    this.timers.delete(doc.uid);
    const prev = this.inflight.get(doc.uid);
    if (prev) await prev; // keep writes for one user in order
    if (doc.deleted) return;
    doc.pruneMeta();
    const patch = doc.takePatch();
    if (!patch) return;
    // Pruning above may have re-scheduled a timer; the patch now includes everything.
    const again = this.timers.get(doc.uid);
    if (again) {
      clearTimeout(again.timer);
      this.timers.delete(doc.uid);
    }
    const run = (async () => {
      try {
        const fb = await firebase();
        await fb.db.update(userPath(doc.uid), patch);
      } catch (e) {
        console.error(`[store] Writing user ${doc.uid} to Realtime Database failed: ${(e as Error).message}`);
        doc.restorePatch(patch);
        // Retry later (not in a tight loop).
        const timer = setTimeout(() => void this.flushDoc(doc), 5000);
        this.timers.set(doc.uid, { timer, firstAt: Date.now() });
      }
    })();
    this.inflight.set(doc.uid, run);
    await run.finally(() => {
      if (this.inflight.get(doc.uid) === run) this.inflight.delete(doc.uid);
    });
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.docs.values()].map((d) => this.flushDoc(d)));
  }

  async putShare(shareId: string, uid: string, playlistId: string): Promise<void> {
    const fb = await firebase();
    await fb.db.update(sharePath(shareId), { ownerUid: uid, playlistId, createdAt: nowIso() });
  }

  async removeShare(shareId: string): Promise<void> {
    const fb = await firebase();
    await fb.db.remove(sharePath(shareId));
  }

  async resolveShare(shareId: string): Promise<{ doc: UserDoc; playlist: StoredPlaylist } | null> {
    const fb = await firebase();
    const ref = await fb.db.get(sharePath(shareId));
    if (!isObj(ref) || !isStr(ref.ownerUid) || !isStr(ref.playlistId) || !ref.ownerUid) return null;
    const doc = await this.get(ref.ownerUid);
    const playlist = sharedPlaylistOf(doc, shareId, ref.playlistId);
    return playlist ? { doc, playlist } : null;
  }

  async delete(uid: string): Promise<void> {
    // Load the user first if needed: their public links must go too.
    const doc = this.docs.get(uid) ?? (await this.loading.get(uid)?.catch(() => undefined)) ?? (await this.get(uid).catch(() => undefined));
    const shareIds = doc ? doc.state.playlists.map((p) => p.shareId).filter((x): x is string => Boolean(x)) : [];
    if (doc) {
      doc.deleted = true;
      doc.pending.clear();
    }
    const t = this.timers.get(uid);
    if (t) clearTimeout(t.timer);
    this.timers.delete(uid);
    await this.inflight.get(uid);
    this.docs.delete(uid);
    const fb = await firebase();
    await Promise.all(shareIds.map((id) => fb.db.remove(sharePath(id))));
    await fb.db.remove(userPath(uid));
  }

  private evictIdle() {
    const cutoff = Date.now() - IDLE_EVICT_MS;
    for (const [uid, doc] of this.docs) {
      if (doc.lastUsed < cutoff && doc.pending.size === 0 && !this.timers.has(uid) && !this.inflight.has(uid)) {
        this.docs.delete(uid);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Store selection
// ---------------------------------------------------------------------------
let store: UserStore | null = null;
let warned = false;

export function userStore(): UserStore {
  if (store) return store;
  if (authMode() === "firebase") {
    const info = firebaseConfigInfo();
    console.info(
      `[auth] Firebase mode: project "${info.projectId}"${info.emulator ? " (emulators)" : ""}. ` +
        "User state lives in Realtime Database under users/{uid}; sign-in is required to save it."
    );
    store = new RtdbUserStore();
  } else {
    if (!warned) {
      warned = true;
      console.warn(
        `[auth] Firebase is not configured (${firebaseConfigInfo().reason}). Running in LOCAL mode: ` +
          `no sign-in, one shared user, state in ${path.join(dataDir(), FILE_NAME)}. ` +
          "See server/.env.example to enable Firebase accounts."
      );
    }
    store = new FileUserStore();
  }
  return store;
}

/** Test hook: forget the selected backend (after switching Firebase services). */
export function resetUserStoreForTesting() {
  store = null;
}

// ---------------------------------------------------------------------------
// Shutdown: last-chance writes
// ---------------------------------------------------------------------------
async function shutdown() {
  if (store instanceof FileUserStore) store.flushSync();
  else if (store) {
    await Promise.race([store.flushAll(), sleep(2500)]).catch(() => {});
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}
process.once("beforeExit", () => {
  if (store instanceof FileUserStore) store.flushSync();
});
