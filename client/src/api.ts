import type {
  Album,
  AlbumSort,
  AlbumWithTracks,
  CatalogStatus,
  CreatePlaylistBody,
  Genre,
  HistoryEntry,
  HistoryItem,
  ListeningStats,
  ListQuery,
  PlaybackState,
  Playlist,
  ReportPlayBody,
  SavePlaybackBody,
  Stats,
  Track,
  TrackSort,
} from "./types";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiRequestError(body.error ?? `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
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

const json = (method: string, body: unknown, extra?: RequestInit): RequestInit => ({
  method,
  body: JSON.stringify(body),
  ...extra,
});

const patchLike = (liked: boolean): RequestInit => json("PATCH", { liked });
const enc = encodeURIComponent;

/**
 * Fire-and-forget POST that survives page unload (pagehide): sendBeacon when available,
 * else a keepalive fetch.
 */
function beacon(url: string, body: unknown): void {
  const data = JSON.stringify(body);
  if (navigator.sendBeacon?.(url, new Blob([data], { type: "application/json" }))) return;
  fetch(url, { method: "POST", body: data, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(
    () => {}
  );
}

export const api = {
  getAlbumOfTheDay: () => request<AlbumWithTracks>("/api/albums/day"),
  getWeekAlbums: (all = false) => request<AlbumWithTracks[]>(`/api/albums/week${all ? "?all=true" : ""}`),
  getAlbum: (id: string, signal?: AbortSignal) => request<AlbumWithTracks>(`/api/albums/${enc(id)}`, { signal }),
  getAlbums: (params: ListQuery<AlbumSort> = {}, signal?: AbortSignal) =>
    request<AlbumWithTracks[]>(`/api/albums${qs(params)}`, { signal }),
  getTracks: (params: ListQuery<TrackSort> = {}, signal?: AbortSignal) =>
    request<Track[]>(`/api/tracks${qs(params)}`, { signal }),
  getGenres: (signal?: AbortSignal) => request<Genre[]>("/api/genres", { signal }),
  getPlaylists: () => request<Playlist[]>("/api/playlists"),
  getPlaylist: (id: string) => request<Playlist>(`/api/playlists/${enc(id)}`),
  getPlaylistTracks: (id: string) => request<Track[]>(`/api/playlists/${enc(id)}/tracks`),
  createPlaylist: (body: CreatePlaylistBody) => request<Playlist>("/api/playlists", json("POST", body)),
  renamePlaylist: (id: string, name: string) => request<Playlist>(`/api/playlists/${enc(id)}`, json("PATCH", { name })),
  deletePlaylist: (id: string) => request<void>(`/api/playlists/${enc(id)}`, { method: "DELETE" }),
  addToPlaylist: (id: string, trackId: string) =>
    request<Playlist>(`/api/playlists/${enc(id)}/tracks`, json("POST", { trackId })),
  removeFromPlaylist: (id: string, trackId: string) =>
    request<Playlist>(`/api/playlists/${enc(id)}/tracks/${enc(trackId)}`, { method: "DELETE" }),
  getRecentTracks: () => request<Track[]>("/api/tracks/recent"),
  getDailyMix: () => request<Track[]>("/api/tracks/daily-mix"),
  getLastPlayback: () => request<PlaybackState>("/api/player/last"),
  savePlayback: (body: SavePlaybackBody) => request<void>("/api/player/state", json("POST", body, { keepalive: true })),
  savePlaybackBeacon: (body: SavePlaybackBody) => beacon("/api/player/state", body),
  getHistory: (limit = 100, signal?: AbortSignal) => request<HistoryItem[]>(`/api/history?limit=${limit}`, { signal }),
  reportPlay: (body: ReportPlayBody) => request<HistoryEntry>("/api/history", json("POST", body, { keepalive: true })),
  reportPlayBeacon: (body: ReportPlayBody) => beacon("/api/history", body),
  clearHistory: () => request<{ cleared: number }>("/api/history", { method: "DELETE" }),
  getStats: () => request<Stats>("/api/stats"),
  getListeningStats: (signal?: AbortSignal) => request<ListeningStats>("/api/stats/listening", { signal }),
  getStatus: (signal?: AbortSignal) => request<CatalogStatus>("/api/status", { signal }),
  likeTrack: (id: string, liked: boolean) => request<Track>(`/api/tracks/${enc(id)}/like`, patchLike(liked)),
  likeAlbum: (id: string, liked: boolean) => request<Album>(`/api/albums/${enc(id)}/like`, patchLike(liked)),
};
