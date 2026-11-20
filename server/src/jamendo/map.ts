// Pure mapping from raw Jamendo v3.0 results to our API types.
// Upstream stream URLs are returned separately and never put into API objects: they carry
// a `from=app-<client id>` parameter, so the browser plays through /api/tracks/:id/stream.
import type { AlbumWithTracks, Track } from "../types.js";
import { genresFromMusicInfo } from "./genres.js";
import type { JamendoAlbum, JamendoAlbumTrack, JamendoTrack } from "./types.js";

export const JAMENDO_TRACK_PREFIX = "j";
export const JAMENDO_ALBUM_PREFIX = "ja";

export const toTrackId = (jamendoId: string | number) => `${JAMENDO_TRACK_PREFIX}${jamendoId}`;
export const toAlbumId = (jamendoId: string | number) => `${JAMENDO_ALBUM_PREFIX}${jamendoId}`;

/** "j123" → "123" (null if not a Jamendo track id). */
export function jamendoTrackIdOf(id: string): string | null {
  const m = /^j(\d+)$/.exec(id);
  return m ? m[1] : null;
}

/** "ja123" → "123" (null if not a Jamendo album id). */
export function jamendoAlbumIdOf(id: string): string | null {
  const m = /^ja(\d+)$/.exec(id);
  return m ? m[1] : null;
}

export const streamPath = (trackId: string) => `/api/tracks/${encodeURIComponent(trackId)}/stream`;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Valid http(s) URL as https, or undefined. */
function cleanUrl(v: unknown, { forceHttps = true } = {}): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    if (forceHttps) u.protocol = "https:";
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Cover/share URLs must not leak the client id either: drop any query param that contains it. */
export function scrubClientId(url: string | undefined, clientId: string | null): string | undefined {
  if (!url || !clientId) return url;
  if (!url.includes(clientId)) return url;
  try {
    const u = new URL(url);
    for (const [k, v] of [...u.searchParams]) if (v.includes(clientId)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return undefined;
  }
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4)) || 0;
}

export interface MappedTrack {
  track: Track;
  /** Real Jamendo stream URL (server-side only). */
  upstreamAudio: string | null;
}

export interface MappedAlbum {
  album: AlbumWithTracks;
  tracks: MappedTrack[];
}

/** Maps a GET /tracks item. `extraGenres` are genre ids the query was filtered by. */
export function mapTrack(raw: JamendoTrack, extraGenres: string[] = [], clientId: string | null = null): MappedTrack {
  const id = toTrackId(raw.id);
  const upstreamAudio = cleanUrl(raw.audio, { forceHttps: false }) ?? null;
  const genres = [...new Set([...extraGenres, ...genresFromMusicInfo(raw.musicinfo)])];
  return {
    upstreamAudio,
    track: {
      id,
      title: str(raw.name) || "Untitled",
      artist: str(raw.artist_name) || "Unknown artist",
      album: str(raw.album_name) || "Single",
      duration: Math.round(num(raw.duration)),
      liked: false,
      genres,
      plays: 0,
      source: "jamendo",
      audioUrl: upstreamAudio ? streamPath(id) : undefined,
      coverUrl: scrubClientId(cleanUrl(raw.image) ?? cleanUrl(raw.album_image), clientId),
      licenseUrl: cleanUrl(raw.license_ccurl),
      jamendoId: String(raw.id),
      shareUrl: scrubClientId(cleanUrl(raw.shareurl) ?? `https://www.jamendo.com/track/${raw.id}`, clientId),
      albumId: raw.album_id && String(raw.album_id) !== "0" ? toAlbumId(raw.album_id) : undefined,
    },
  };
}

function mapAlbumTrack(raw: JamendoAlbumTrack, album: JamendoAlbum, genres: string[], coverUrl: string | undefined): MappedTrack {
  const id = toTrackId(raw.id);
  const upstreamAudio = cleanUrl(raw.audio, { forceHttps: false }) ?? null;
  return {
    upstreamAudio,
    track: {
      id,
      title: str(raw.name) || "Untitled",
      artist: str(album.artist_name) || "Unknown artist",
      album: str(album.name) || "Untitled album",
      duration: Math.round(num(raw.duration)),
      liked: false,
      genres,
      plays: 0,
      source: "jamendo",
      audioUrl: upstreamAudio ? streamPath(id) : undefined,
      coverUrl,
      licenseUrl: cleanUrl(raw.license_ccurl),
      jamendoId: String(raw.id),
      shareUrl: `https://www.jamendo.com/track/${raw.id}`,
      albumId: toAlbumId(album.id),
    },
  };
}

/** Maps a GET /albums/tracks item (album + nested tracks, sorted by position). */
export function mapAlbum(raw: JamendoAlbum, genres: string[] = [], clientId: string | null = null): MappedAlbum {
  const coverUrl = scrubClientId(cleanUrl(raw.image), clientId);
  const tracks = [...(raw.tracks ?? [])]
    .sort((a, b) => num(a.position) - num(b.position))
    .map((t) => mapAlbumTrack(t, raw, genres, coverUrl));
  const releaseDate = str(raw.releasedate);
  return {
    tracks,
    album: {
      id: toAlbumId(raw.id),
      title: str(raw.name) || "Untitled album",
      artist: str(raw.artist_name) || "Unknown artist",
      year: yearOf(releaseDate),
      releaseDate,
      genres,
      trackCount: tracks.length,
      duration: tracks.reduce((sum, t) => sum + t.track.duration, 0),
      liked: false,
      trackIds: tracks.map((t) => t.track.id),
      tracks: tracks.map((t) => t.track),
      source: "jamendo",
      coverUrl,
      jamendoId: String(raw.id),
      shareUrl: scrubClientId(cleanUrl(raw.shareurl), clientId) ?? `https://www.jamendo.com/album/${raw.id}`,
    },
  };
}
