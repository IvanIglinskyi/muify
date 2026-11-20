// API types are defined once on the server and shared with the client (type-only import,
// erased at build time).
export type {
  Album,
  AlbumWithTracks,
  ApiError,
  PlaybackState,
  Playlist,
  Stats,
  Track,
} from "../../server/src/types";
