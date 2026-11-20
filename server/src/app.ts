import express, { NextFunction, Request, Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import {
  albumOfTheDay,
  catalogStatus,
  computeStats,
  dailyMix,
  getAlbum,
  getPlaylist,
  lastPlayback,
  listAlbums,
  listGenres,
  listPlaylists,
  listTracks,
  playlistTracks,
  recentTracks,
  setAlbumLike,
  setTrackLike,
  upstreamAudioFor,
  weekAlbums,
  type ListFilters,
} from "./catalog.js";
import { findGenre } from "./data/genres.js";
import type { AlbumSort, TrackSort } from "./types.js";

export const app = express();

app.use(express.json());

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
    res.json(await listAlbums(f));
  })
);

app.get(
  "/api/albums/day",
  handle(async (_req, res) => {
    res.json(await albumOfTheDay());
  })
);

app.get(
  "/api/albums/week",
  handle(async (_req, res) => {
    res.json(await weekAlbums());
  })
);

app.get(
  "/api/albums/:id",
  handle(async (req, res) => {
    const album = await getAlbum(req.params.id);
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
    const album = await setAlbumLike(req.params.id, liked);
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
  handle(async (_req, res) => {
    res.json(await listPlaylists());
  })
);

app.get(
  "/api/playlists/:id",
  handle(async (req, res) => {
    const playlist = await getPlaylist(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: "Playlist not found" });
      return;
    }
    res.json(playlist);
  })
);

app.get(
  "/api/playlists/:id/tracks",
  handle(async (req, res) => {
    const playlist = await getPlaylist(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: "Playlist not found" });
      return;
    }
    res.json(playlistTracks(playlist));
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
    res.json(await listTracks(f));
  })
);

app.get(
  "/api/tracks/recent",
  handle(async (_req, res) => {
    res.json(await recentTracks());
  })
);

app.get(
  "/api/tracks/daily-mix",
  handle(async (_req, res) => {
    res.json(await dailyMix());
  })
);

app.patch(
  "/api/tracks/:id/like",
  handle(async (req, res) => {
    const liked = readLiked(req, res);
    if (liked === undefined) return;
    const track = await setTrackLike(req.params.id, liked);
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
  handle(async (_req, res) => {
    res.json(await lastPlayback());
  })
);

// ---- Stats ----
app.get("/api/stats", (_req, res) => {
  res.json(computeStats());
});

app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api]", err);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.status(500).json({ error: "Internal server error" });
});
