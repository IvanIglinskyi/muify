import type {
  Album,
  AlbumSort,
  AlbumWithTracks,
  ArtistDetails,
  CatalogStatus,
  CreatePlaylistBody,
  FollowedArtist,
  FollowResponse,
  Genre,
  HistoryEntry,
  HistoryItem,
  ListeningStats,
  ListQuery,
  LyricsResponse,
  MeResponse,
  NotificationsResponse,
  PlaybackState,
  Playlist,
  Recommendations,
  ReportPlayBody,
  SavePlaybackBody,
  SearchResults,
  SearchType,
  SharedPlaylist,
  Stats,
  Track,
  TrackSort,
  UpdateMeBody,
  UpdatePlaylistBody,
} from "./types";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Server reason code ("auth-required", "token-revoked", "requires-recent-login", …). */
    public code?: string
  ) {
    super(message);
  }
}

// ---- Auth plumbing (set by AuthProvider) ----
/** Fresh ID token (refreshed by the SDK when close to expiry), or null for guests / local mode. */
let tokenProvider: () => Promise<string | null> = async () => null;
/** Last known token, readable synchronously (pagehide can't await). */
let cachedToken: string | null = null;
/** Called when the server rejects our session (revoked / deleted account). */
let onSessionRejected: (code: string) => void = () => {};

export function setAuthBridge(bridge: {
  getToken: () => Promise<string | null>;
  cachedToken: () => string | null;
  onSessionRejected: (code: string) => void;
}) {
  tokenProvider = bridge.getToken;
  cachedTokenGetter = bridge.cachedToken;
  onSessionRejected = bridge.onSessionRejected;
}
let cachedTokenGetter: () => string | null = () => cachedToken;

async function authHeaders(): Promise<Record<string, string>> {
  const token = await tokenProvider().catch(() => null);
  cachedToken = token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(await authHeaders()), ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code : undefined;
    if (res.status === 401 && (code === "token-revoked" || code === "user-disabled")) onSessionRejected(code);
    throw new ApiRequestError(body.error ?? `Request failed (${res.status})`, res.status, code);
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
 * Fire-and-forget POST that survives page unload (pagehide). navigator.sendBeacon can't carry an
 * Authorization header, so this is a keepalive fetch with the last known ID token (read
 * synchronously: there is no time to await a token refresh while the page goes away).
 */
function beacon(url: string, body: unknown): void {
  const token = cachedTokenGetter();
  fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    keepalive: true,
  }).catch(() => {});
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
  updatePlaylist: (id: string, body: UpdatePlaylistBody) => request<Playlist>(`/api/playlists/${enc(id)}`, json("PATCH", body)),
  reorderPlaylist: (id: string, trackIds: string[]) =>
    request<Playlist>(`/api/playlists/${enc(id)}/tracks`, json("PUT", { trackIds })),
  sharePlaylist: (id: string) => request<Playlist>(`/api/playlists/${enc(id)}/share`, { method: "PUT" }),
  unsharePlaylist: (id: string) => request<Playlist>(`/api/playlists/${enc(id)}/share`, { method: "DELETE" }),
  getSharedPlaylist: (shareId: string, signal?: AbortSignal) =>
    request<SharedPlaylist>(`/api/shared/${enc(shareId)}`, { signal }),
  getArtist: (id: string, signal?: AbortSignal) => request<ArtistDetails>(`/api/artists/${enc(id)}`, { signal }),
  getRecommendations: () => request<Recommendations>("/api/recommendations"),
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
  // ---- Account ----
  getMe: () => request<MeResponse>("/api/me"),
  updateMe: (body: UpdateMeBody) => request<MeResponse>("/api/me", json("PATCH", body)),
  revokeSessions: () => request<void>("/api/me/revoke-sessions", { method: "POST" }),
  exportMyData: () => request<unknown>("/api/me/export"),
  deleteAccount: () => request<void>("/api/me", { method: "DELETE" }),
  // ---- Following / notifications ----
  followArtist: (id: string) => request<FollowResponse>(`/api/artists/${enc(id)}/follow`, { method: "PUT" }),
  unfollowArtist: (id: string) => request<FollowResponse>(`/api/artists/${enc(id)}/follow`, { method: "DELETE" }),
  getFollows: (signal?: AbortSignal) => request<FollowedArtist[]>("/api/me/follows", { signal }),
  getNotifications: (signal?: AbortSignal) => request<NotificationsResponse>("/api/notifications", { signal }),
  markNotificationsRead: (ids: string[] | "all") =>
    request<NotificationsResponse>("/api/notifications/read", json("POST", ids === "all" ? { all: true } : { ids })),
  // ---- Search ----
  search: (q: string, type: SearchType = "all", signal?: AbortSignal) =>
    request<SearchResults>(`/api/search?q=${enc(q)}&type=${type}`, { signal }),
  getRecentSearches: (signal?: AbortSignal) => request<string[]>("/api/me/searches", { signal }),
  addRecentSearch: (q: string) => request<string[]>("/api/me/searches", json("POST", { q })),
  clearRecentSearches: (q?: string) => request<string[]>(`/api/me/searches${q ? `?q=${enc(q)}` : ""}`, { method: "DELETE" }),
  // ---- Lyrics ----
  getLyrics: (trackId: string, signal?: AbortSignal) => request<LyricsResponse>(`/api/tracks/${enc(trackId)}/lyrics`, { signal }),
};
