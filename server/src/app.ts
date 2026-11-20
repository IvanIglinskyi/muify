import express, { NextFunction, Request, Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import {
  addTrackToPlaylist,
  albumOfTheDay,
  allWeekAlbums,
  catalogStatus,
  clearHistory,
  computeStats,
  createPlaylist,
  dailyMix,
  deletePlaylist,
  getAlbum,
  getPlaylist,
  lastPlayback,
  listAlbums,
  listeningStats,
  listGenres,
  listHistory,
  listPlaylists,
  listTracks,
  MAX_QUEUE,
  playlistTracks,
  recentTracks,
  removeTrackFromPlaylist,
  renamePlaylist,
  reportPlay,
  savePlayback,
  setAlbumLike,
  setTrackLike,
  upstreamAudioFor,
  UserError,
  weekAlbums,
  type ListFilters,
} from "./catalog.js";
import { forgetTokensOf, requireMember, viewerDoc } from "./auth.js";
import { findGenre } from "./data/genres.js";
import { firebase } from "./firebase.js";
import { userStore } from "./userStore.js";
import type { AlbumSort, MeResponse, TrackSort } from "./types.js";

export const app = express();

app.use(express.json({ limit: "100kb" }));

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

/** Express 4 does not catch rejected promises: forward them to the error handler. */
const handle = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

function readLiked(req: Request, res: Response): boolean | undefined {
  const liked = req.body?.liked;
  if (typeof liked !== "boolean") {
    res.status(400).json({ error: "Body must contain boolean field `liked`" });
    return undefined;
  }
  return liked;
}

const MAX_LIMIT = 100;

/** Sends 400 and returns undefined unless `v` is a plausible id string. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function bodyId(res: Response, v: unknown, field: string): string | undefined {
  if (typeof v !== "string" || !ID_RE.test(v)) {
    res.status(400).json({ error: `\`${field}\` must be an id string` });
    return undefined;
  }
  return v;
}

const MAX_PLAYLIST_NAME = 60;
function bodyPlaylistName(res: Response, v: unknown): string | undefined {
  const name = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > MAX_PLAYLIST_NAME) {
    res.status(400).json({ error: `\`name\` must be a non-empty string of at most ${MAX_PLAYLIST_NAME} characters` });
    return undefined;
  }
  return name;
}

function bodyIdList(res: Response, v: unknown, field: string, max: number): string[] | undefined {
  if (!Array.isArray(v) || v.length > max || !v.every((x) => typeof x === "string" && ID_RE.test(x))) {
    res.status(400).json({ error: `\`${field}\` must be an array of at most ${max} id strings` });
    return undefined;
  }
  return v as string[];
}

function bodyNumber(res: Response, v: unknown, field: string, min: number, max: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    res.status(400).json({ error: `\`${field}\` must be a number between ${min} and ${max}` });
    return undefined;
  }
  return v;
}

function requireBody(req: Request, res: Response): Record<string, unknown> | undefined {
  const b = req.body;
  if (typeof b !== "object" || b === null || Array.isArray(b)) {
    res.status(400).json({ error: "Expected a JSON object body (Content-Type: application/json)" });
    return undefined;
  }
  return b as Record<string, unknown>;
}

/** Parses ?q=&genre=&liked=&sort=&limit= shared by the list endpoints; sends 400 on bad input. */
function readFilters<S extends string>(req: Request, res: Response, sorts: readonly S[]): ListFilters<S> | undefined {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const fail = (error: string) => {
    res.status(400).json({ error });
    return undefined;
  };

  const q = str(req.query.q).toLowerCase().slice(0, 100);

  const genre = str(req.query.genre) || null;
  if (genre && !findGenre(genre)) return fail(`Unknown genre "${genre}"`);

  const likedRaw = str(req.query.liked);
  if (likedRaw && likedRaw !== "true" && likedRaw !== "false") return fail("`liked` must be true or false");
  const liked = likedRaw ? likedRaw === "true" : null;

  const sortRaw = str(req.query.sort);
  if (sortRaw && !(sorts as readonly string[]).includes(sortRaw)) {
    return fail(`\`sort\` must be one of: ${sorts.join(", ")}`);
  }
  const sort = (sortRaw || null) as S | null;

  const limitRaw = str(req.query.limit);
  let limit: number | null = null;
  if (limitRaw) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return fail(`\`limit\` must be an integer 1-${MAX_LIMIT}`);
    limit = n;
  }

  return { q, genre, liked, sort, limit };
}

// ---- Status ----
app.get("/api/status", (_req, res) => {
  res.json(catalogStatus());
});

// ---- Genres ----
app.get("/api/genres", (_req, res) => {
  res.json(listGenres());
});

// ---- Albums ----
const ALBUM_SORTS: readonly AlbumSort[] = ["new", "title"];

/** GET /api/albums?genre=&q=&liked=&sort=new|title&limit= */
app.get(
  "/api/albums",
  handle(async (req, res) => {
    const f = readFilters(req, res, ALBUM_SORTS);
    if (!f) return;
    res.json(await listAlbums(f, await viewerDoc(req)));
  })
);

app.get(
  "/api/albums/day",
  handle(async (req, res) => {
    res.json(await albumOfTheDay(await viewerDoc(req)));
  })
);

/** GET /api/albums/week[?all=true] — the 4 home picks, or every album for the "See All" page. */
app.get(
  "/api/albums/week",
  handle(async (req, res) => {
    const all = req.query.all;
    if (all !== undefined && all !== "true" && all !== "false") {
      res.status(400).json({ error: "`all` must be true or false" });
      return;
    }
    const u = await viewerDoc(req);
    res.json(all === "true" ? await allWeekAlbums(u) : await weekAlbums(u));
  })
);

app.get(
  "/api/albums/:id",
  handle(async (req, res) => {
    const album = await getAlbum(req.params.id, await viewerDoc(req));
    if (!album) {
      res.status(404).json({ error: "Album not found" });
      return;
    }
    res.json(album);
  })
);

app.patch(
  "/api/albums/:id/like",
  handle(async (req, res) => {
    const liked = readLiked(req, res);
    if (liked === undefined) return;
    const m = await requireMember(req, res);
    if (!m) return;
    const album = await setAlbumLike(m.doc, req.params.id, liked);
    if (!album) {
      res.status(404).json({ error: "Album not found" });
      return;
    }
    res.json(album);
  })
);

// ---- Playlists ----
app.get(
  "/api/playlists",
  handle(async (req, res) => {
    res.json(await listPlaylists(await viewerDoc(req)));
  })
);

app.get(
  "/api/playlists/:id",
  handle(async (req, res) => {
    const playlist = await getPlaylist(req.params.id, await viewerDoc(req));
    if (!playlist) {
      res.status(404).json({ error: "Playlist not found" });
      return;
    }
    res.json(playlist);
  })
);

/** POST /api/playlists { name, trackIds? } → 201 */
app.post(
  "/api/playlists",
  handle(async (req, res) => {
    const body = requireBody(req, res);
    if (!body) return;
    const name = bodyPlaylistName(res, body.name);
    if (name === undefined) return;
    const trackIds = body.trackIds === undefined ? [] : bodyIdList(res, body.trackIds, "trackIds", 1000);
    if (!trackIds) return;
    const m = await requireMember(req, res);
    if (!m) return;
    res.status(201).json(await createPlaylist(m.doc, name, trackIds));
  })
);

/** PATCH /api/playlists/:id { name } — user playlists only (403 for built-in ones). */
app.patch(
  "/api/playlists/:id",
  handle(async (req, res) => {
    const body = requireBody(req, res);
    if (!body) return;
    const name = bodyPlaylistName(res, body.name);
    if (name === undefined) return;
    const m = await requireMember(req, res);
    if (!m) return;
    res.json(renamePlaylist(m.doc, req.params.id, name));
  })
);

app.delete(
  "/api/playlists/:id",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    deletePlaylist(m.doc, req.params.id);
    res.status(204).end();
  })
);

/** POST /api/playlists/:id/tracks { trackId } — on Favourites this likes the track. */
app.post(
  "/api/playlists/:id/tracks",
  handle(async (req, res) => {
    const body = requireBody(req, res);
    if (!body) return;
    const trackId = bodyId(res, body.trackId, "trackId");
    if (!trackId) return;
    const m = await requireMember(req, res);
    if (!m) return;
    res.json(await addTrackToPlaylist(m.doc, req.params.id, trackId));
  })
);

/** DELETE /api/playlists/:id/tracks/:trackId (or DELETE …/tracks with { trackId }). */
app.delete(
  "/api/playlists/:id/tracks/:trackId",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    res.json(await removeTrackFromPlaylist(m.doc, req.params.id, req.params.trackId));
  })
);

app.delete(
  "/api/playlists/:id/tracks",
  handle(async (req, res) => {
    const body = requireBody(req, res);
    if (!body) return;
    const trackId = bodyId(res, body.trackId, "trackId");
    if (!trackId) return;
    const m = await requireMember(req, res);
    if (!m) return;
    res.json(await removeTrackFromPlaylist(m.doc, req.params.id, trackId));
  })
);

app.get(
  "/api/playlists/:id/tracks",
  handle(async (req, res) => {
    const u = await viewerDoc(req);
    const playlist = await getPlaylist(req.params.id, u);
    if (!playlist) {
      res.status(404).json({ error: "Playlist not found" });
      return;
    }
    res.json(playlistTracks(playlist, u));
  })
);

// ---- Tracks ----
const TRACK_SORTS: readonly TrackSort[] = ["top", "title"];

/** GET /api/tracks?genre=&q=&liked=&sort=top|title&limit= — searches title, artist and album. */
app.get(
  "/api/tracks",
  handle(async (req, res) => {
    const f = readFilters(req, res, TRACK_SORTS);
    if (!f) return;
    res.json(await listTracks(f, await viewerDoc(req)));
  })
);

app.get(
  "/api/tracks/recent",
  handle(async (req, res) => {
    res.json(await recentTracks(await viewerDoc(req)));
  })
);

app.get(
  "/api/tracks/daily-mix",
  handle(async (req, res) => {
    res.json(await dailyMix(await viewerDoc(req)));
  })
);

app.patch(
  "/api/tracks/:id/like",
  handle(async (req, res) => {
    const liked = readLiked(req, res);
    if (liked === undefined) return;
    const m = await requireMember(req, res);
    if (!m) return;
    const track = await setTrackLike(m.doc, req.params.id, liked);
    if (!track) {
      res.status(404).json({ error: "Track not found" });
      return;
    }
    res.json(track);
  })
);

/**
 * GET /api/tracks/:id/stream — proxies the Jamendo audio stream. Jamendo stream URLs embed our
 * client id, so the browser never sees them. Range requests are forwarded, so seeking works.
 */
const FORWARDED_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

app.get(
  "/api/tracks/:id/stream",
  handle(async (req, res) => {
    const url = await upstreamAudioFor(req.params.id);
    if (!url) {
      res.status(404).json({ error: "This track has no audio stream" });
      return;
    }

    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort(); // listener left (skip / seek): stop downloading
    });

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(url, {
        headers: req.headers.range ? { range: req.headers.range } : {},
        signal: abort.signal,
        redirect: "follow",
      });
    } catch {
      if (!res.headersSent && !abort.signal.aborted) res.status(502).json({ error: "Audio source unreachable" });
      return;
    }

    if (!upstream.ok) {
      res.status(upstream.status === 416 ? 416 : 502).json({ error: `Audio source answered ${upstream.status}` });
      return;
    }

    res.status(upstream.status);
    for (const h of FORWARDED_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader("cache-control", "private, max-age=3600");
    if (!upstream.body || req.method === "HEAD") {
      res.end();
      return;
    }
    try {
      await pipeline(Readable.fromWeb(upstream.body as NodeWebReadableStream<Uint8Array>), res);
    } catch {
      // Client aborted or upstream broke mid-stream; nothing more to send.
      res.destroy();
    }
  })
);

// ---- Player ----
app.get(
  "/api/player/last",
  handle(async (req, res) => {
    res.json(await lastPlayback(await viewerDoc(req)));
  })
);

/** POST (or PUT) /api/player/state { trackId, position, queue?, volume? } → 204. Also sent as a keepalive fetch on pagehide. */
const savePlayerState = handle(async (req, res) => {
  const body = requireBody(req, res);
  if (!body) return;
  const trackId = bodyId(res, body.trackId, "trackId");
  if (!trackId) return;
  const position = bodyNumber(res, body.position, "position", 0, 86_400);
  if (position === undefined) return;
  let queue: string[] | undefined;
  if (body.queue !== undefined) {
    queue = bodyIdList(res, body.queue, "queue", MAX_QUEUE);
    if (!queue) return;
  }
  let volume: number | undefined;
  if (body.volume !== undefined) {
    volume = bodyNumber(res, body.volume, "volume", 0, 1);
    if (volume === undefined) return;
  }
  const m = await requireMember(req, res);
  if (!m) return;
  if (!(await savePlayback(m.doc, { trackId, position, queue, volume }))) {
    res.status(404).json({ error: "Track not found" });
    return;
  }
  res.status(204).end();
});
app.post("/api/player/state", savePlayerState);
app.put("/api/player/state", savePlayerState);

// ---- History ----
const MAX_HISTORY_PAGE = 500;

/** GET /api/history?limit= — newest first. */
app.get(
  "/api/history",
  handle(async (req, res) => {
  let limit = 100;
  if (req.query.limit !== undefined) {
    const n = Number(req.query.limit);
    if (typeof req.query.limit !== "string" || !Number.isInteger(n) || n < 1 || n > MAX_HISTORY_PAGE) {
      res.status(400).json({ error: `\`limit\` must be an integer 1-${MAX_HISTORY_PAGE}` });
      return;
    }
    limit = n;
  }
  const m = await requireMember(req, res);
  if (!m) return;
  res.json(listHistory(m.doc, limit));
  })
);

/** POST /api/history { trackId, seconds, entryId? } → 201 (new play) or 200 (updated play). */
app.post(
  "/api/history",
  handle(async (req, res) => {
    const body = requireBody(req, res);
    if (!body) return;
    const trackId = bodyId(res, body.trackId, "trackId");
    if (!trackId) return;
    const seconds = bodyNumber(res, body.seconds, "seconds", 0, 86_400);
    if (seconds === undefined) return;
    let entryId: string | undefined;
    if (body.entryId !== undefined) {
      entryId = bodyId(res, body.entryId, "entryId");
      if (!entryId) return;
    }
    const m = await requireMember(req, res);
    if (!m) return;
    const entry = await reportPlay(m.doc, trackId, seconds, entryId);
    if (!entry) {
      res.status(404).json({ error: "Track not found" });
      return;
    }
    res.status(entry.id === entryId ? 200 : 201).json(entry);
  })
);

app.delete(
  "/api/history",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    res.json({ cleared: clearHistory(m.doc) });
  })
);

// ---- Stats ----
app.get(
  "/api/stats",
  handle(async (req, res) => {
    res.json(computeStats(await viewerDoc(req)));
  })
);

/** Listening statistics computed from the real play history. */
app.get(
  "/api/stats/listening",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    res.json(listeningStats(m.doc));
  })
);

// ---- Account (Firebase mode; in local mode these describe the implicit local user) ----
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_DISPLAY_NAME = 50;
/** Destructive account actions need a sign-in this recent (the client re-authenticates first). */
const RECENT_LOGIN_S = 5 * 60;

async function meOf(m: NonNullable<Awaited<ReturnType<typeof requireMember>>>): Promise<MeResponse> {
  const p = m.doc.state.profile;
  if (m.identity.kind === "local") {
    return {
      uid: m.identity.uid,
      mode: "local",
      email: null,
      emailVerified: false,
      displayName: p?.displayName ?? null,
      photoURL: null,
      accentColor: p?.accentColor ?? null,
      usePhoto: false,
      providers: [],
      createdAt: p?.createdAt ?? null,
    };
  }
  const fb = await firebase();
  const u = await fb.getUser(m.identity.uid);
  return {
    uid: u.uid,
    mode: "firebase",
    email: u.email,
    emailVerified: u.emailVerified,
    displayName: u.displayName ?? p?.displayName ?? null,
    photoURL: u.photoURL,
    accentColor: p?.accentColor ?? null,
    usePhoto: p?.usePhoto ?? true,
    providers: u.providers,
    createdAt: u.createdAt ?? p?.createdAt ?? null,
  };
}

app.get(
  "/api/me",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    res.setHeader("cache-control", "no-store");
    res.json(await meOf(m));
  })
);

/** PATCH /api/me { displayName?, accentColor?, usePhoto? } */
app.patch(
  "/api/me",
  handle(async (req, res) => {
    const body = requireBody(req, res);
    if (!body) return;
    const changes: { displayName?: string; accentColor?: string | null; usePhoto?: boolean } = {};
    if (body.displayName !== undefined) {
      const name = typeof body.displayName === "string" ? body.displayName.replace(/\s+/g, " ").trim() : "";
      if (!name || name.length > MAX_DISPLAY_NAME) {
        res.status(400).json({ error: `\`displayName\` must be 1-${MAX_DISPLAY_NAME} characters` });
        return;
      }
      changes.displayName = name;
    }
    if (body.accentColor !== undefined) {
      if (body.accentColor !== null && (typeof body.accentColor !== "string" || !ACCENT_RE.test(body.accentColor))) {
        res.status(400).json({ error: "`accentColor` must be #rrggbb or null" });
        return;
      }
      changes.accentColor = body.accentColor === null ? null : body.accentColor.toLowerCase();
    }
    if (body.usePhoto !== undefined) {
      if (typeof body.usePhoto !== "boolean") {
        res.status(400).json({ error: "`usePhoto` must be a boolean" });
        return;
      }
      changes.usePhoto = body.usePhoto;
    }
    const m = await requireMember(req, res);
    if (!m) return;
    if (m.identity.kind === "user" && changes.displayName !== undefined) {
      await (await firebase()).updateUser(m.identity.uid, { displayName: changes.displayName });
    }
    m.doc.updateProfile(changes);
    res.json(await meOf(m));
  })
);

/** Signs the account out everywhere: refresh tokens are revoked, current ID tokens rejected. */
app.post(
  "/api/me/revoke-sessions",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    if (m.identity.kind !== "user") {
      res.status(400).json({ error: "There are no accounts in local mode", code: "local-mode" });
      return;
    }
    await (await firebase()).revokeRefreshTokens(m.identity.uid);
    forgetTokensOf(m.identity.uid);
    res.status(204).end();
  })
);

/** GET /api/me/export — everything stored for the caller, as a JSON download. */
app.get(
  "/api/me/export",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-disposition", `attachment; filename="muify-data-${date}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      account: await meOf(m),
      ...m.doc.exportJson(),
    });
  })
);

/**
 * DELETE /api/me — deletes users/{uid} in Realtime Database and the Firebase Auth user.
 * Requires a sign-in within the last 5 minutes (403 requires-recent-login otherwise).
 */
app.delete(
  "/api/me",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    if (m.identity.kind !== "user") {
      res.status(400).json({ error: "There are no accounts in local mode", code: "local-mode" });
      return;
    }
    if (Date.now() / 1000 - m.identity.token.authTime > RECENT_LOGIN_S) {
      res.status(403).json({ error: "Please confirm your identity again before deleting the account", code: "requires-recent-login" });
      return;
    }
    const uid = m.identity.uid;
    await userStore().delete(uid);
    await (await firebase()).deleteUser(uid);
    forgetTokensOf(uid);
    res.status(204).end();
  })
);

app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof UserError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // body-parser: malformed JSON (400) / body too large (413).
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
    res.status(err.status ?? 400).json({ error: err.type === "entity.too.large" ? "Request body too large" : "Malformed JSON body" });
    return;
  }
  console.error("[api]", err);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.status(500).json({ error: "Internal server error" });
});
