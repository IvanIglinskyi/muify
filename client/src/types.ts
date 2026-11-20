// API types are defined once on the server and shared with the client (type-only import,
// erased at build time).
export type {
  Album,
  AlbumWithTracks,
  AlbumSort,
  ApiError,
  CatalogSource,
  CatalogStatus,
  Genre,
  GenreKind,
  ListQuery,
  PlaybackState,
  Playlist,
  Stats,
  Track,
  TrackSort,
} from "../../server/src/types";
