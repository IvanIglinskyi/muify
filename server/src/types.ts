// Shared API types. The client re-exports these (type-only) from client/src/types.ts.

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Duration in seconds */
  duration: number;
  liked: boolean;
  /** Genre and mood ids (see `Genre`). */
  genres: string[];
  /** Play count, used to rank the Top charts (0 for Jamendo tracks: Jamendo ranks those). */
  plays: number;
  /** Where the track comes from: the real Jamendo catalogue or the built-in fictional seed. */
  source: CatalogSource;
  /** Playable URL on our own API (`/api/tracks/:id/stream`). Absent for seed tracks → simulated playback. */
  audioUrl?: string;
  /** Real cover art URL; when absent the client draws a generated SVG cover. */
  coverUrl?: string;
  /** Creative Commons licence URL (Jamendo tracks). */
  licenseUrl?: string;
  /** Numeric Jamendo track id. */
  jamendoId?: string;
  /** Track page on jamendo.com. */
  shareUrl?: string;
}

export type CatalogSource = "jamendo" | "seed";

export type GenreKind = "genre" | "mood";

export interface Genre {
  id: string;
  name: string;
  kind: GenreKind;
  /** Matching tracks/albums, or null when unknown (Jamendo catalogue). */
  trackCount: number | null;
  albumCount: number | null;
}

export type TrackSort = "top" | "title";
export type AlbumSort = "new" | "title";

/** Query params accepted by GET /api/tracks and GET /api/albums. */
export interface ListQuery<S extends string = string> {
  q?: string;
  genre?: string | null;
  liked?: boolean;
  sort?: S;
  limit?: number;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year: number;
  /** ISO date (YYYY-MM-DD), used to order New releases. */
  releaseDate: string;
  /** Genre and mood ids. */
  genres: string[];
  trackCount: number;
  /** Total duration in seconds */
  duration: number;
  liked: boolean;
  trackIds: string[];
  source: CatalogSource;
  /** Real cover art URL; when absent the client draws a generated SVG cover. */
  coverUrl?: string;
  /** Numeric Jamendo album id. */
  jamendoId?: string;
  /** Album page on jamendo.com. */
  shareUrl?: string;
}

export interface AlbumWithTracks extends Album {
  tracks: Track[];
}

export interface Playlist {
  id: string;
  name: string;
  icon?: "heart";
  trackIds: string[];
}

/** GET /api/status — which catalogue the server is serving right now. */
export interface CatalogStatus {
  source: CatalogSource;
  /** Whether JAMENDO_CLIENT_ID is set on the server (the id itself is never sent). */
  jamendoConfigured: boolean;
  /** Last Jamendo error while falling back to seed data, else null. */
  lastError: string | null;
}

export interface Stats {
  totalHours: number;
  likes: number;
  tracks: number;
}

export interface PlaybackState {
  trackId: string;
  /** Seconds into the track */
  position: number;
  queue: string[];
  track: Track;
}

export interface ApiError {
  error: string;
}
