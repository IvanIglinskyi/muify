import express, { Request, Response } from "express";
import { albumOfTheDayId, albums, findAlbum, weekAlbumIds } from "./data/albums.js";
import { findGenre, genreDefs } from "./data/genres.js";
import { playlists, statsBase } from "./data/playlists.js";
import { dailyMixTrackIds, findTrack, lastPlayback, recentTrackIds, tracks, tracksByIds } from "./data/tracks.js";
import type { Album, AlbumSort, AlbumWithTracks, Genre, PlaybackState, Playlist, Stats, TrackSort } from "./types.js";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(express.json());

function withTracks(album: Album): AlbumWithTracks {
  return { ...album, tracks: tracksByIds(album.trackIds) };
}

function computeStats(): Stats {
  const likedTracks = tracks.filter((t) => t.liked).length;
  const likedAlbums = albums.filter((a) => a.liked).length;
  return {
    totalHours: statsBase.totalHours,
    likes: statsBase.likesFromOtherContent + likedTracks + likedAlbums,
    tracks: statsBase.tracks,
  };
}

function resolvePlaylist(p: Playlist): Playlist {
  // "Favourites" always mirrors the currently liked tracks.
  if (p.id === "p-favourites") {
    return { ...p, trackIds: tracks.filter((t) => t.liked).map((t) => t.id) };
  }
  return p;
}

function readLiked(req: Request, res: Response): boolean | undefined {
  const liked = req.body?.liked;
  if (typeof liked !== "boolean") {
    res.status(400).json({ error: "Body must contain boolean field `liked`" });
    return undefined;
  }
  return liked;
}

interface ListFilters<S extends string> {
  q: string;
  genre: string | null;
  liked: boolean | null;
  sort: S | null;
  limit: number | null;
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

const matches = (q: string, ...fields: string[]) => !q || fields.join(" ").toLowerCase().includes(q);

// ---- Genres ----
app.get("/api/genres", (_req, res) => {
  const list: Genre[] = genreDefs.map((g) => ({
    ...g,
    trackCount: tracks.filter((t) => t.genres.includes(g.id)).length,
    albumCount: albums.filter((a) => a.genres.includes(g.id)).length,
  }));
  res.json(list);
});

// ---- Albums ----
const ALBUM_SORTS: readonly AlbumSort[] = ["new", "title"];

/** GET /api/albums?genre=&q=&liked=&sort=new|title&limit= */
app.get("/api/albums", (req, res) => {
  const f = readFilters(req, res, ALBUM_SORTS);
  if (!f) return;
  let list = albums.filter(
    (a) =>
      (!f.genre || a.genres.includes(f.genre)) &&
      (f.liked === null || a.liked === f.liked) &&
      matches(f.q, a.title, a.artist)
  );
  if (f.sort === "new") list = [...list].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  if (f.sort === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  if (f.limit) list = list.slice(0, f.limit);
  res.json(list.map(withTracks));
});

app.get("/api/albums/day", (_req, res) => {
  res.json(withTracks(findAlbum(albumOfTheDayId)!));
});

app.get("/api/albums/week", (_req, res) => {
  res.json(weekAlbumIds.map((id) => withTracks(findAlbum(id)!)));
});

app.get("/api/albums/:id", (req, res) => {
  const album = findAlbum(req.params.id);
  if (!album) {
    res.status(404).json({ error: "Album not found" });
    return;
  }
  res.json(withTracks(album));
});

app.patch("/api/albums/:id/like", (req, res) => {
  const album = findAlbum(req.params.id);
  if (!album) {
    res.status(404).json({ error: "Album not found" });
    return;
  }
  const liked = readLiked(req, res);
  if (liked === undefined) return;
  album.liked = liked;
  res.json(album);
});

// ---- Playlists ----
app.get("/api/playlists", (_req, res) => {
  res.json(playlists.map(resolvePlaylist));
});

app.get("/api/playlists/:id", (req, res) => {
  const playlist = playlists.find((p) => p.id === req.params.id);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json(resolvePlaylist(playlist));
});

app.get("/api/playlists/:id/tracks", (req, res) => {
  const playlist = playlists.find((p) => p.id === req.params.id);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json(tracksByIds(resolvePlaylist(playlist).trackIds));
});

// ---- Tracks ----
const TRACK_SORTS: readonly TrackSort[] = ["top", "title"];

/** GET /api/tracks?genre=&q=&liked=&sort=top|title&limit= — searches title, artist and album. */
app.get("/api/tracks", (req, res) => {
  const f = readFilters(req, res, TRACK_SORTS);
  if (!f) return;
  let list = tracks.filter(
    (t) =>
      (!f.genre || t.genres.includes(f.genre)) &&
      (f.liked === null || t.liked === f.liked) &&
      matches(f.q, t.title, t.artist, t.album)
  );
  if (f.sort === "top") list = [...list].sort((a, b) => b.plays - a.plays);
  if (f.sort === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  if (f.limit) list = list.slice(0, f.limit);
  res.json(list);
});

app.get("/api/tracks/recent", (_req, res) => {
  res.json(tracksByIds(recentTrackIds));
});

app.get("/api/tracks/daily-mix", (_req, res) => {
  res.json(tracksByIds(dailyMixTrackIds));
});

app.patch("/api/tracks/:id/like", (req, res) => {
  const track = findTrack(req.params.id);
  if (!track) {
    res.status(404).json({ error: "Track not found" });
    return;
  }
  const liked = readLiked(req, res);
  if (liked === undefined) return;
  track.liked = liked;
  res.json(track);
});

// ---- Player ----
app.get("/api/player/last", (_req, res) => {
  const state: PlaybackState = { ...lastPlayback, track: findTrack(lastPlayback.trackId)! };
  res.json(state);
});

// ---- Stats ----
app.get("/api/stats", (_req, res) => {
  res.json(computeStats());
});

app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`MuiFy API: http://localhost:${PORT}`);
});
