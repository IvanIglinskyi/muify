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
  /** Play count, used to rank the Top charts. */
  plays: number;
}

export type GenreKind = "genre" | "mood";

export interface Genre {
  id: string;
  name: string;
  kind: GenreKind;
  trackCount: number;
  albumCount: number;
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
