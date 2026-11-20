import type { Album, AlbumWithTracks, PlaybackState, Playlist, Stats, Track } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const patchLike = (liked: boolean): RequestInit => ({
  method: "PATCH",
  body: JSON.stringify({ liked }),
});

export const api = {
  getAlbumOfTheDay: () => request<AlbumWithTracks>("/api/albums/day"),
  getWeekAlbums: () => request<AlbumWithTracks[]>("/api/albums/week"),
  getPlaylists: () => request<Playlist[]>("/api/playlists"),
  getPlaylistTracks: (id: string) => request<Track[]>(`/api/playlists/${id}/tracks`),
  getRecentTracks: () => request<Track[]>("/api/tracks/recent"),
  getDailyMix: () => request<Track[]>("/api/tracks/daily-mix"),
  getLastPlayback: () => request<PlaybackState>("/api/player/last"),
  getStats: () => request<Stats>("/api/stats"),
  likeTrack: (id: string, liked: boolean) => request<Track>(`/api/tracks/${id}/like`, patchLike(liked)),
  likeAlbum: (id: string, liked: boolean) => request<Album>(`/api/albums/${id}/like`, patchLike(liked)),
};
