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
  /** Album the track belongs to (when known), for "Go to album". */
  albumId?: string;
  /** Artist page id ("jr123" Jamendo, "sa-name" seed); absent on old snapshots. */
  artistId?: string;
  /** Jamendo has lyrics for this track (true), has none (false), or unknown (absent). */
  hasLyrics?: boolean;
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
  /** Artist page id (see Track.artistId). */
  artistId?: string;
}

export interface AlbumWithTracks extends Album {
  tracks: Track[];
}

/**
 * "favourites": derived from liked tracks (add/remove = like/unlike).
 * "builtin": read-only curated playlist. "user": created by the listener (fully editable).
 */
export type PlaylistKind = "favourites" | "builtin" | "user";

export interface Playlist {
  id: string;
  name: string;
  icon?: "heart";
  kind: PlaylistKind;
  trackIds: string[];
  /** Optional description (user playlists). */
  description?: string;
  /** Public read-only link id (user playlists with sharing on), else null/absent. */
  shareId?: string | null;
}

/** PATCH /api/playlists/:id — at least one field. `description: ""` (or null) clears it. */
export interface UpdatePlaylistBody {
  name?: string;
  description?: string | null;
}

/** PUT /api/playlists/:id/tracks — the playlist's tracks in their new order. */
export interface ReorderPlaylistBody {
  trackIds: string[];
}

/** GET /api/shared/:shareId — a public, read-only view of a shared user playlist. */
export interface SharedPlaylist {
  shareId: string;
  name: string;
  description: string | null;
  /** Owner's display name (never the email), or null. */
  ownerName: string | null;
  /** True when the caller owns the playlist. */
  ownedByYou: boolean;
  /** The owner's playlist id (only when `ownedByYou`). */
  playlistId: string | null;
  trackIds: string[];
  tracks: Track[];
  updatedAt: string;
}

export interface Artist {
  id: string;
  name: string;
  source: CatalogSource;
  /** Artist photo (Jamendo); when absent the client draws a generated cover. */
  imageUrl?: string;
  /** Artist page on jamendo.com. */
  shareUrl?: string;
  website?: string;
  /** ISO date the artist joined Jamendo. */
  joinDate?: string;
}

/** GET /api/artists/:id */
export interface ArtistDetails extends Artist {
  /** Most popular tracks first. */
  topTracks: Track[];
  /** Newest first. */
  albums: AlbumWithTracks[];
  /** The caller follows this artist (always false for guests). */
  following: boolean;
}

/** GET /api/me/follows — an artist the caller follows. */
export interface FollowedArtist {
  id: string;
  name: string;
  imageUrl?: string;
  source: CatalogSource;
  /** ISO timestamp of the follow. */
  followedAt: string;
}

/** PUT/DELETE /api/artists/:id/follow */
export interface FollowResponse {
  following: boolean;
  artist: FollowedArtist | null;
}

export type NotificationKind = "release" | "welcome";

/**
 * One notification. The text is NOT stored: the client renders it in the listener's language from
 * `kind` + the data fields.
 */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  /** ISO timestamp the notification was created. */
  createdAt: string;
  read: boolean;
  /** "release": the new album. */
  albumId?: string;
  albumTitle?: string;
  artistId?: string;
  artistName?: string;
  coverUrl?: string;
  /** "release": album release date (YYYY-MM-DD). */
  releaseDate?: string;
  /** Synthesised from the demo catalogue (seed mode) rather than a real new release. */
  demo?: boolean;
}

/** GET /api/notifications */
export interface NotificationsResponse {
  items: AppNotification[];
  unread: number;
  /** When new releases were last looked up (ISO), or null. */
  checkedAt: string | null;
}

export type SearchType = "all" | "tracks" | "albums" | "artists" | "playlists";

/** GET /api/search?q=&type= */
export interface SearchResults {
  q: string;
  type: SearchType;
  tracks: Track[];
  albums: AlbumWithTracks[];
  artists: Artist[];
  /** The caller's own playlists whose name matches (empty for guests). */
  playlists: Playlist[];
}

/** GET /api/tracks/:id/lyrics */
export interface LyricsResponse {
  trackId: string;
  /** Plain text (line breaks kept), or null when Jamendo has none. */
  lyrics: string | null;
}

export type Language = "uk" | "en";

/** GET /api/recommendations */
export interface Recommendations {
  dailyMix: {
    /** Built from the listener's likes and plays (false: the generic mix for everyone). */
    personalised: boolean;
    tracks: Track[];
    /** Artist names the mix is based on (empty when generic). */
    basedOn: string[];
  };
  /** "Because you liked <artist>" row, or null when there isn't enough data. */
  becauseYouLiked: { artist: { id: string | null; name: string }; tracks: Track[] } | null;
}

/** POST /api/playlists */
export interface CreatePlaylistBody {
  name: string;
  trackIds?: string[];
}

/** One reported play (GET /api/history). */
export interface HistoryEntry {
  id: string;
  trackId: string;
  /** ISO timestamp of when the play was first reported. */
  playedAt: string;
  /** Seconds actually listened during this play. */
  seconds: number;
}

export interface HistoryItem extends HistoryEntry {
  track: Track;
}

/**
 * POST /api/history — report a play (after >= 10 s or at the end of the track).
 * Pass `entryId` from a previous answer to update the listened seconds of the same play.
 */
export interface ReportPlayBody {
  trackId: string;
  seconds: number;
  entryId?: string;
}

/** GET /api/stats/listening — computed from the real play history. */
export interface ListeningStats {
  totalSeconds: number;
  plays: number;
  uniqueTracks: number;
  uniqueArtists: number;
  likedTracks: number;
  likedAlbums: number;
  firstPlayedAt: string | null;
  topTracks: { track: Track; plays: number; seconds: number }[];
  topArtists: { artist: string; artistId: string | null; plays: number; seconds: number }[];
  /** Oldest → newest, local server dates (YYYY-MM-DD). */
  last7Days: { date: string; seconds: number; plays: number }[];
}

/** GET /api/status — which catalogue the server is serving right now. */
export interface CatalogStatus {
  source: CatalogSource;
  /** Whether JAMENDO_CLIENT_ID is set on the server (the id itself is never sent). */
  jamendoConfigured: boolean;
  /** Last Jamendo error while falling back to seed data, else null. */
  lastError: string | null;
  /** How listeners are identified. */
  auth: AuthStatus;
}

/**
 * "firebase": Firebase Auth accounts, per-user state in Realtime Database (guests can browse and
 * play; saving requires sign-in). "local": no accounts — one implicit local user (JSON file).
 */
export type AuthMode = "firebase" | "local";

export interface AuthStatus {
  mode: AuthMode;
  /** Server talks to the Firebase Emulator Suite. */
  emulator: boolean;
  /** Firebase project id (public), or null in local mode. */
  projectId: string | null;
  /** Why accounts are off (local mode), else null. */
  reason: string | null;
}

/** GET /api/me — the signed-in account (Firebase mode) or the local user. */
export interface MeResponse {
  uid: string;
  mode: AuthMode;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoURL: string | null;
  /** Initials-avatar colour (#rrggbb) or null for the default. */
  accentColor: string | null;
  /** Show the provider photo instead of initials (when there is one). */
  usePhoto: boolean;
  /** Linked sign-in providers ("password", "google.com"). */
  providers: string[];
  createdAt: string | null;
  /** UI language chosen by the listener, or null (browser default). */
  language: Language | null;
}

/** PATCH /api/me */
export interface UpdateMeBody {
  displayName?: string;
  accentColor?: string | null;
  usePhoto?: boolean;
  language?: Language | null;
}

/** GET /api/stats — the Home statistics tiles, computed from the caller's own data. */
export interface Stats {
  /** Seconds listened (sum of the play history). */
  totalSeconds: number;
  /** Liked tracks + liked albums. */
  likes: number;
  /** Distinct tracks played. */
  tracks: number;
  /** Reported plays. */
  plays: number;
}

export interface PlaybackState {
  trackId: string;
  /** Seconds into the track */
  position: number;
  queue: string[];
  track: Track;
  /** Tracks of `queue` (so the client can render/play them without extra requests). */
  queueTracks: Track[];
  /** 0..1 */
  volume: number;
  /** True when restored from the listener's saved state (false: demo default). */
  saved: boolean;
}

/** POST /api/player/state (also sent with a keepalive fetch on pagehide). */
export interface SavePlaybackBody {
  trackId: string;
  position: number;
  queue?: string[];
  volume?: number;
}

export interface ApiError {
  error: string;
  /** Machine-readable reason: "auth-required", "token-revoked", "requires-recent-login", … */
  code?: string;
}
