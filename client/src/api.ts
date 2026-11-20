import type {
  Album,
  AlbumSort,
  AlbumWithTracks,
  CatalogStatus,
  Genre,
  ListQuery,
  PlaybackState,
  Playlist,
  Stats,
  Track,
  TrackSort,
} from "./types";

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

/** Builds "?a=1&b=2", skipping empty values. */
function qs(params: ListQuery): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const patchLike = (liked: boolean): RequestInit => ({
  method: "PATCH",
  body: JSON.stringify({ liked }),
});

export const api = {
  getAlbumOfTheDay: () => request<AlbumWithTracks>("/api/albums/day"),
  getWeekAlbums: () => request<AlbumWithTracks[]>("/api/albums/week"),
  getAlbums: (params: ListQuery<AlbumSort> = {}, signal?: AbortSignal) =>
    request<AlbumWithTracks[]>(`/api/albums${qs(params)}`, { signal }),
  getTracks: (params: ListQuery<TrackSort> = {}, signal?: AbortSignal) =>
    request<Track[]>(`/api/tracks${qs(params)}`, { signal }),
  getGenres: (signal?: AbortSignal) => request<Genre[]>("/api/genres", { signal }),
  getPlaylists: () => request<Playlist[]>("/api/playlists"),
  getPlaylist: (id: string) => request<Playlist>(`/api/playlists/${encodeURIComponent(id)}`),
  getPlaylistTracks: (id: string) => request<Track[]>(`/api/playlists/${encodeURIComponent(id)}/tracks`),
  getRecentTracks: () => request<Track[]>("/api/tracks/recent"),
  getDailyMix: () => request<Track[]>("/api/tracks/daily-mix"),
  getLastPlayback: () => request<PlaybackState>("/api/player/last"),
  getStats: () => request<Stats>("/api/stats"),
  getStatus: () => request<CatalogStatus>("/api/status"),
  likeTrack: (id: string, liked: boolean) => request<Track>(`/api/tracks/${id}/like`, patchLike(liked)),
  likeAlbum: (id: string, liked: boolean) => request<Album>(`/api/albums/${id}/like`, patchLike(liked)),
};
