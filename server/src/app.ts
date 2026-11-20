import express, { NextFunction, Request, Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import {
  addRecentSearch,
  addTrackToPlaylist,
  albumOfTheDay,
  allWeekAlbums,
  catalogStatus,
  clearHistory,
  clearRecentSearches,
  computeStats,
  createPlaylist,
  dailyMix,
  deletePlaylist,
  followArtist,
  getAlbum,
  getArtist,
  getLyrics,
  getNotifications,
  getPlaylist,
  getSharedPlaylist,
  lastPlayback,
  listAlbums,
  listeningStats,
  listGenres,
  listFollows,
  listHistory,
  listPlaylists,
  listTracks,
  markNotificationsRead,
  MAX_QUEUE,
  playlistTracks,
  recentTracks,
  recommendations,
  removeTrackFromPlaylist,
  reorderPlaylist,
  reportPlay,
  savePlayback,
  search,
  setAlbumLike,
  setTrackLike,
  sharePlaylist,
  unfollowArtist,
  unsharePlaylist,
  updatePlaylist,
  upstreamAudioFor,
  UserError,
  weekAlbums,
  type ListFilters,
} from "./catalog.js";
import { forgetTokensOf, requireMember, viewerDoc } from "./auth.js";
import { findGenre } from "./data/genres.js";
import { firebase } from "./firebase.js";
import { accountLimiter, searchLimiter, securityHeaders, trustProxySetting, writeLimiter } from "./security.js";
import { clientDistDir, clientRouter, shouldServeClient } from "./static.js";
import { SHARE_ID_RE, userStore } from "./userStore.js";
import type { AlbumSort, Language, LyricsResponse, MeResponse, SearchType, TrackSort } from "./types.js";

export const app = express();

app.disable("x-powered-by");
// Behind a reverse proxy / load balancer set TRUST_PROXY (e.g. "1") so req.ip is the real client.
app.set("trust proxy", trustProxySetting());
app.use(securityHeaders());
// JSON bodies are small (ids, names, positions): anything bigger is rejected with 413.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT?.trim() || "100kb" }));
app.use("/api", writeLimiter);

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

const MAX_DESCRIPTION = 300;

/** PATCH /api/playlists/:id { name?, description? } — user playlists only (403 for built-in ones). */
app.patch(
  "/api/playlists/:id",
  handle(async (req, res) => {
    const body = requireBody(req, res);
    if (!body) return;
    if (body.name === undefined && body.description === undefined) {
      res.status(400).json({ error: "Send `name` and/or `description`" });
      return;
    }
    const changes: { name?: string; description?: string } = {};
    if (body.name !== undefined) {
      const name = bodyPlaylistName(res, body.name);
      if (name === undefined) return;
      changes.name = name;
    }
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== "string") {
        res.status(400).json({ error: "`description` must be a string or null" });
        return;
      }
      // Keep line breaks, drop other control characters, trim.
      const d = (body.description ?? "").replace(/\r\n?/g, "\n").replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "").trim();
      if (d.length > MAX_DESCRIPTION) {
        res.status(400).json({ error: `\`description\` must be at most ${MAX_DESCRIPTION} characters` });
        return;
      }
      changes.description = d;
    }
    const m = await requireMember(req, res);
    if (!m) return;
    res.json(updatePlaylist(m.doc, req.params.id, changes));
  })
);

app.delete(
  "/api/playlists/:id",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    await deletePlaylist(m.doc, req.params.id);
    res.status(204).end();
  })
);

/** PUT /api/playlists/:id/tracks { trackIds } — reorder (must be a permutation of the current tracks; 409 otherwise). */
app.put(
  "/api/playlists/:id/tracks",
  handle(async (req, res) => {
    const body = requireBody(req, res);
    if (!body) return;
    const trackIds = bodyIdList(res, body.trackIds, "trackIds", 1000);
    if (!trackIds) return;
    const m = await requireMember(req, res);
    if (!m) return;
    res.json(reorderPlaylist(m.doc, req.params.id, trackIds));
  })
);

/** PUT /api/playlists/:id/share → playlist with `shareId` (public read-only link /p/:shareId). */
app.put(
  "/api/playlists/:id/share",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    res.json(await sharePlaylist(m.doc, req.params.id));
  })
);

/** DELETE /api/playlists/:id/share → playlist with `shareId: null`; the old link then answers 404. */
app.delete(
  "/api/playlists/:id/share",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    res.json(await unsharePlaylist(m.doc, req.params.id));
  })
);

/** GET /api/shared/:shareId — public read-only playlist (no sign-in needed). */
app.get(
  "/api/shared/:shareId",
  handle(async (req, res) => {
    const shareId = req.params.shareId;
    const shared = SHARE_ID_RE.test(shareId) ? await getSharedPlaylist(shareId, await viewerDoc(req)) : undefined;
    res.setHeader("cache-control", "no-store");
    if (!shared) {
      res.status(404).json({ error: "This playlist link is not active" });
      return;
    }
    res.json(shared);
  })
);

// ---- Artists ----
const ARTIST_ID_RE = /^(jr\d{1,12}|sa-[a-z0-9-]{1,60})$/;

app.get(
  "/api/artists/:id",
  handle(async (req, res) => {
    if (!ARTIST_ID_RE.test(req.params.id)) {
      res.status(400).json({ error: "Malformed artist id" });
      return;
    }
    const artist = await getArtist(req.params.id, await viewerDoc(req));
    if (!artist) {
      res.status(404).json({ error: "Artist not found" });
      return;
    }
    res.json(artist);
  })
);

/** PUT /api/artists/:id/follow → { following: true, artist } (idempotent). */
app.put(
  "/api/artists/:id/follow",
  handle(async (req, res) => {
    if (!ARTIST_ID_RE.test(req.params.id)) {
      res.status(400).json({ error: "Malformed artist id" });
      return;
    }
    const m = await requireMember(req, res);
    if (!m) return;
    const artist = await followArtist(m.doc, req.params.id);
    if (!artist) {
      res.status(404).json({ error: "Artist not found" });
      return;
    }
    res.json({ following: true, artist });
  })
);

/** DELETE /api/artists/:id/follow → { following: false, artist: null } (idempotent). */
app.delete(
  "/api/artists/:id/follow",
  handle(async (req, res) => {
    if (!ARTIST_ID_RE.test(req.params.id)) {
      res.status(400).json({ error: "Malformed artist id" });
      return;
    }
    const m = await requireMember(req, res);
    if (!m) return;
    unfollowArtist(m.doc, req.params.id);
    res.json({ following: false, artist: null });
  })
);

/** GET /api/me/follows — followed artists, most recent first. */
app.get(
  "/api/me/follows",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    res.setHeader("cache-control", "no-store");
    res.json(listFollows(m.doc));
  })
);

// ---- Notifications ----
/** GET /api/notifications — new releases of followed artists (looked up lazily, ≤ every 6 h). */
app.get(
  "/api/notifications",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    res.setHeader("cache-control", "no-store");
    res.json(await getNotifications(m.doc));
  })
);

const NOTIF_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** POST /api/notifications/read { ids: string[] } or { all: true } */
app.post(
  "/api/notifications/read",
  handle(async (req, res) => {
    const body = requireBody(req, res);
    if (!body) return;
    let ids: string[] | "all";
    if (body.all === true) ids = "all";
    else if (Array.isArray(body.ids) && body.ids.length <= 100 && body.ids.every((x) => typeof x === "string" && NOTIF_ID_RE.test(x))) {
      ids = body.ids as string[];
    } else {
      res.status(400).json({ error: "Send `ids` (array of notification ids) or `all: true`" });
      return;
    }
    const m = await requireMember(req, res);
    if (!m) return;
    res.json(markNotificationsRead(m.doc, ids));
  })
);

// ---- Search ----
const SEARCH_TYPES: readonly SearchType[] = ["all", "tracks", "albums", "artists", "playlists"];
const MAX_QUERY = 100;

/** GET /api/search?q=&type=all|tracks|albums|artists|playlists */
app.get(
  "/api/search",
  searchLimiter,
  handle(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.replace(/\s+/g, " ").trim() : "";
    if (!q || q.length > MAX_QUERY) {
      res.status(400).json({ error: `\`q\` must be 1-${MAX_QUERY} characters` });
      return;
    }
    const typeRaw = typeof req.query.type === "string" ? req.query.type : "all";
    if (!(SEARCH_TYPES as readonly string[]).includes(typeRaw)) {
      res.status(400).json({ error: `\`type\` must be one of: ${SEARCH_TYPES.join(", ")}` });
      return;
    }
    res.setHeader("cache-control", "private, no-cache");
    res.json(await search(q, typeRaw as SearchType, await viewerDoc(req)));
  })
);

/** GET /api/me/searches — recent searches, newest first. */
app.get(
  "/api/me/searches",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    res.setHeader("cache-control", "no-store");
    res.json(m.doc.state.searches);
  })
);

/** POST /api/me/searches { q } → the updated list. */
app.post(
  "/api/me/searches",
  handle(async (req, res) => {
    const body = requireBody(req, res);
    if (!body) return;
    const q = typeof body.q === "string" ? body.q.replace(/\s+/g, " ").trim() : "";
    if (!q || q.length > MAX_QUERY) {
      res.status(400).json({ error: `\`q\` must be 1-${MAX_QUERY} characters` });
      return;
    }
    const m = await requireMember(req, res);
    if (!m) return;
    res.json(addRecentSearch(m.doc, q));
  })
);

/** DELETE /api/me/searches[?q=] — clears all (or one) recent searches. */
app.delete(
  "/api/me/searches",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    res.json(clearRecentSearches(m.doc, q || undefined));
  })
);

// ---- Recommendations ----
app.get(
  "/api/recommendations",
  handle(async (req, res) => {
    res.setHeader("cache-control", "private, no-cache");
    res.json(await recommendations(await viewerDoc(req)));
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

/** GET /api/tracks/:id/lyrics → { trackId, lyrics: string | null } (404 for unknown tracks). */
app.get(
  "/api/tracks/:id/lyrics",
  handle(async (req, res) => {
    if (!ID_RE.test(req.params.id)) {
      res.status(400).json({ error: "Malformed track id" });
      return;
    }
    const lyrics = await getLyrics(req.params.id);
    if (lyrics === undefined) {
      res.status(404).json({ error: "Track not found" });
      return;
    }
    res.setHeader("cache-control", "private, max-age=3600");
    const body: LyricsResponse = { trackId: req.params.id, lyrics };
    res.json(body);
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
/** GET /api/stats — the caller's own totals (401 for guests). */
app.get(
  "/api/stats",
  handle(async (req, res) => {
    const m = await requireMember(req, res);
    if (!m) return;
    res.setHeader("cache-control", "no-store");
    res.json(computeStats(m.doc));
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
      language: p?.language ?? null,
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
    language: p?.language ?? null,
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

/** PATCH /api/me { displayName?, accentColor?, usePhoto?, language? } */
app.patch(
  "/api/me",
  handle(async (req, res) => {
    const body = requireBody(req, res);
    if (!body) return;
    const changes: { displayName?: string; accentColor?: string | null; usePhoto?: boolean; language?: Language | null } = {};
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
    if (body.language !== undefined) {
      if (body.language !== null && body.language !== "uk" && body.language !== "en") {
        res.status(400).json({ error: "`language` must be \"uk\", \"en\" or null" });
        return;
      }
      changes.language = body.language;
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
  accountLimiter,
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
  accountLimiter,
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
  accountLimiter,
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

// Production: the built client on the same port (see static.ts).
if (shouldServeClient()) {
  app.use(clientRouter(clientDistDir()));
}

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
