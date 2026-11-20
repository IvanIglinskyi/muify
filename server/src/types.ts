// Shared API types. The client re-exports these (type-only) from client/src/types.ts.

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Duration in seconds */
  duration: number;
  liked: boolean;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year: number;
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
