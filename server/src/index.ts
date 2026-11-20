import express, { Request, Response } from "express";
import { albumOfTheDayId, albums, findAlbum, weekAlbumIds } from "./data/albums.js";
import { playlists, statsBase } from "./data/playlists.js";
import { dailyMixTrackIds, findTrack, lastPlayback, recentTrackIds, tracks, tracksByIds } from "./data/tracks.js";
import type { Album, AlbumWithTracks, PlaybackState, Playlist, Stats } from "./types.js";

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

// ---- Albums ----
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

app.get("/api/playlists/:id/tracks", (req, res) => {
  const playlist = playlists.find((p) => p.id === req.params.id);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json(tracksByIds(resolvePlaylist(playlist).trackIds));
});

// ---- Tracks ----
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
