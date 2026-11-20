// Catalogue facade used by the routes: serves Jamendo data when JAMENDO_CLIENT_ID is set and
// Jamendo answers, otherwise the built-in fictional seed (no audio → simulated playback).
// Likes and playlists are our own in-memory state keyed by track/album id, for both sources.
import { albumOfTheDayId as seedDayId, albums as seedAlbums, weekAlbumIds as seedWeekIds } from "./data/albums.js";
import { genreDefs } from "./data/genres.js";
import { playlists, statsBase } from "./data/playlists.js";
import { dailyMixTrackIds, lastPlayback as seedLastPlayback, recentTrackIds, tracks as seedTracks } from "./data/tracks.js";
import { jamendoClientId, jamendoGet, type JamendoParams } from "./jamendo/client.js";
import { genreMappings, type JamendoGenreQuery } from "./jamendo/genres.js";
import { jamendoAlbumIdOf, jamendoTrackIdOf, mapAlbum, mapTrack, type MappedAlbum, type MappedTrack } from "./jamendo/map.js";
import type { JamendoAlbum, JamendoTrack } from "./jamendo/types.js";
import type {
  Album,
  AlbumSort,
  AlbumWithTracks,
  CatalogStatus,
  Genre,
  PlaybackState,
  Playlist,
  Stats,
  Track,
  TrackSort,
} from "./types.js";

// ---------------------------------------------------------------------------
// Registry of every track/album the server has served (seed + Jamendo). The `liked` flag on
// stored objects is ignored — likes live in the sets below and are applied on the way out.
// ---------------------------------------------------------------------------
const trackIndex = new Map<string, Track>();
const albumIndex = new Map<string, Album>();
/** Real Jamendo stream URLs (contain the client id) — server-side only. */
const upstreamAudio = new Map<string, string>();

const likedTrackIds = new Set<string>();
const likedAlbumIds = new Set<string>();

// The seed's demo likes only make sense for the demo catalogue: with Jamendo configured, the
// listener starts with empty Favourites instead of fictional, unplayable tracks.
// (env.ts has already loaded server/.env by the time this module runs.)
const preloadSeedLikes = !jamendoClientId();
for (const t of seedTracks) {
  trackIndex.set(t.id, t);
  if (t.liked && preloadSeedLikes) likedTrackIds.add(t.id);
}
for (const a of seedAlbums) {
  albumIndex.set(a.id, a);
  if (a.liked && preloadSeedLikes) likedAlbumIds.add(a.id);
}

function registerTrack({ track, upstreamAudio: audio }: MappedTrack): Track {
  const known = trackIndex.get(track.id);
  // A track seen via /tracks has richer data (genres from musicinfo) than via /albums/tracks.
  const merged: Track = known
    ? { ...known, ...track, genres: [...new Set([...known.genres, ...track.genres])], coverUrl: track.coverUrl ?? known.coverUrl }
    : track;
  trackIndex.set(merged.id, merged);
  if (audio) upstreamAudio.set(merged.id, audio);
  return merged;
}

function registerAlbum({ album, tracks }: MappedAlbum): Album {
  tracks.forEach(registerTrack);
  const { tracks: _t, ...plain } = album;
  const known = albumIndex.get(plain.id);
  const merged: Album = known ? { ...plain, genres: [...new Set([...known.genres, ...plain.genres])] } : plain;
  albumIndex.set(merged.id, merged);
  return merged;
}

const withLike = (t: Track): Track => ({ ...t, liked: likedTrackIds.has(t.id) });

function tracksByIds(ids: string[]): Track[] {
  return ids.map((id) => trackIndex.get(id)).filter((t): t is Track => Boolean(t)).map(withLike);
}

function withTracks(a: Album): AlbumWithTracks {
  return { ...a, liked: likedAlbumIds.has(a.id), tracks: tracksByIds(a.trackIds) };
}

// ---------------------------------------------------------------------------
// Source selection + fallback
// ---------------------------------------------------------------------------
const RETRY_AFTER_MS = 60_000;
let lastError: string | null = null;
let retryAt = 0;
let warnedMissingKey = false;

function warnMissingKeyOnce() {
  if (warnedMissingKey) return;
  warnedMissingKey = true;
  console.warn(
    "[jamendo] JAMENDO_CLIENT_ID is not set (server/.env) — serving the built-in demo catalogue. " +
      "Tracks have no audio; the player simulates playback."
  );
}

/** Runs the Jamendo branch if possible, else (or on failure) the seed branch. */
async function fromJamendo<T>(label: string, jamendo: () => Promise<T>, seed: () => T): Promise<T> {
  if (!jamendoClientId()) {
    warnMissingKeyOnce();
    return seed();
  }
  if (Date.now() < retryAt) return seed();
  try {
    const value = await jamendo();
    if (lastError) console.info("[jamendo] Jamendo is reachable again — serving real tracks.");
    lastError = null;
    return value;
  } catch (e) {
    const message = (e as Error).message;
    if (!lastError) {
      console.warn(
        `[jamendo] ${label} failed: ${message}. Falling back to the built-in demo catalogue ` +
          `(retrying in ${RETRY_AFTER_MS / 1000} s).`
      );
    }
    lastError = message;
    retryAt = Date.now() + RETRY_AFTER_MS;
    return seed();
  }
}

/** Home sections must never be empty: treat an empty Jamendo answer as a failure. */
function nonEmpty<T>(list: T[], what: string): T[] {
  if (list.length === 0) throw new Error(`Jamendo returned no ${what}`);
  return list;
}

export function catalogStatus(): CatalogStatus {
  const configured = Boolean(jamendoClientId());
  return {
    source: configured && !lastError ? "jamendo" : "seed",
    jamendoConfigured: configured,
    lastError: configured ? lastError : null,
  };
}

// ---------------------------------------------------------------------------
// Jamendo queries
// ---------------------------------------------------------------------------
const TRACK_PARAMS: JamendoParams = { include: "musicinfo", audioformat: "mp32", imagesize: 300 };
const ALBUM_PARAMS: JamendoParams = { audioformat: "mp32", imagesize: 500 };
const MAX_JAMENDO_LIMIT = 200;

async function jamendoTracks(params: JamendoParams, genres: string[] = []): Promise<Track[]> {
  const raw = await jamendoGet<JamendoTrack>("tracks", { ...TRACK_PARAMS, ...params });
  const clientId = jamendoClientId();
  return raw.map((r) => registerTrack(mapTrack(r, genres, clientId))).map(withLike);
}

async function jamendoAlbums(params: JamendoParams, genres: string[] = []): Promise<AlbumWithTracks[]> {
  const raw = await jamendoGet<JamendoAlbum>("albums/tracks", { ...ALBUM_PARAMS, ...params });
  const clientId = jamendoClientId();
  return raw.map((r) => withTracks(registerAlbum(mapAlbum(r, genres, clientId))));
}

/** Albums by Jamendo id, in the given order. */
async function jamendoAlbumsByIds(ids: string[], genres: string[] = []): Promise<AlbumWithTracks[]> {
  if (ids.length === 0) return [];
  const list = await jamendoAlbums({ id: ids.join(" "), limit: ids.length }, genres);
  const byId = new Map(list.map((a) => [a.jamendoId, a]));
  return ids.map((id) => byId.get(id)).filter((a): a is AlbumWithTracks => Boolean(a));
}

function genreQuery(genre: string | null): JamendoGenreQuery {
  return genre ? genreMappings[genre]?.query ?? {} : {};
}

/** Stable per-day number, so "of the day" picks change daily but not per request. */
function dayNumber(): number {
  return Math.floor(Date.now() / 86_400_000);
}

/** Deterministic shuffle seeded by `seed`. */
function seededShuffle<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Popular albums this week (with tracks); shared by Album of the day + Albums of the Week. */
async function popularAlbums(): Promise<AlbumWithTracks[]> {
  const list = await jamendoAlbums({ order: "popularity_week", limit: 10 });
  return nonEmpty(
    list.filter((a) => a.tracks.length > 0),
    "popular albums"
  );
}

// ---------------------------------------------------------------------------
// Public API used by the routes
// ---------------------------------------------------------------------------
export interface ListFilters<S extends string> {
  q: string;
  genre: string | null;
  liked: boolean | null;
  sort: S | null;
  limit: number | null;
}

const matches = (q: string, ...fields: string[]) => !q || fields.join(" ").toLowerCase().includes(q.toLowerCase());

export function albumOfTheDay(): Promise<AlbumWithTracks> {
  return fromJamendo(
    "Album of the day",
    async () => {
      const list = await popularAlbums();
      return list[dayNumber() % Math.min(list.length, 5)];
    },
    () => withTracks(albumIndex.get(seedDayId)!)
  );
}

export function weekAlbums(): Promise<AlbumWithTracks[]> {
  return fromJamendo(
    "Albums of the week",
    async () => {
      const list = await popularAlbums();
      const day = list[dayNumber() % Math.min(list.length, 5)];
      return list.filter((a) => a.id !== day.id).slice(0, 4);
    },
    () => seedWeekIds.map((id) => withTracks(albumIndex.get(id)!))
  );
}

export function dailyMix(): Promise<Track[]> {
  return fromJamendo(
    "Daily mix",
    async () => {
      const pool = await jamendoTracks({ order: "popularity_month", groupby: "artist_id", limit: 50 });
      return seededShuffle(nonEmpty(pool, "daily mix tracks"), dayNumber()).slice(0, 12);
    },
    () => tracksByIds(dailyMixTrackIds)
  );
}

export function recentTracks(): Promise<Track[]> {
  return fromJamendo(
    "Recent plays",
    async () => nonEmpty(await jamendoTracks({ featured: 1, groupby: "artist_id", limit: 11 }), "featured tracks"),
    () => tracksByIds(recentTrackIds)
  );
}

export async function lastPlayback(): Promise<PlaybackState> {
  const recent = await recentTracks();
  if (recent[0]?.source === "jamendo") {
    return { trackId: recent[0].id, position: 0, queue: recent.map((t) => t.id), track: recent[0] };
  }
  return { ...seedLastPlayback, track: withLike(trackIndex.get(seedLastPlayback.trackId)!) };
}

function seedTrackList(f: ListFilters<TrackSort>): Track[] {
  let list = seedTracks
    .map(withLike)
    .filter(
      (t) =>
        (!f.genre || t.genres.includes(f.genre)) &&
        (f.liked === null || t.liked === f.liked) &&
        matches(f.q, t.title, t.artist, t.album)
    );
  if (f.sort === "top") list = [...list].sort((a, b) => b.plays - a.plays);
  return list;
}

function localLikedTracks(f: ListFilters<TrackSort>): Track[] {
  return tracksByIds([...likedTrackIds]).filter(
    (t) => (!f.genre || t.genres.includes(f.genre)) && matches(f.q, t.title, t.artist, t.album)
  );
}

/** GET /api/tracks — Top charts (popularity), genre filter and search. */
export async function listTracks(f: ListFilters<TrackSort>): Promise<Track[]> {
  let list: Track[];
  if (f.liked === true) {
    list = localLikedTracks(f); // likes are ours: answer from the registry
    if (f.sort === "top") list = [...list].sort((a, b) => b.plays - a.plays);
  } else {
    list = await fromJamendo(
      "Track search",
      async () => {
        const params: JamendoParams = { ...genreQuery(f.genre), limit: Math.min(f.limit ?? 50, MAX_JAMENDO_LIMIT) };
        if (f.q) {
          params.search = f.q;
          if (f.sort === "top") params.boost = "popularity_month"; // keep search relevance first
        } else if (f.sort === "top") {
          params.order = "popularity_month";
          params.groupby = "artist_id"; // one track per artist, as Jamendo recommends for charts
        }
        const found = await jamendoTracks(params, f.genre ? [f.genre] : []);
        return f.liked === false ? found.filter((t) => !t.liked) : found;
      },
      () => seedTrackList(f)
    );
  }
  if (f.sort === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  return f.limit ? list.slice(0, f.limit) : list;
}

function seedAlbumList(f: ListFilters<AlbumSort>): AlbumWithTracks[] {
  let list = seedAlbums
    .map(withTracks)
    .filter(
      (a) =>
        (!f.genre || a.genres.includes(f.genre)) &&
        (f.liked === null || a.liked === f.liked) &&
        matches(f.q, a.title, a.artist)
    );
  if (f.sort === "new") list = [...list].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  return list;
}

/** GET /api/albums — New releases, genre filter and search. */
export async function listAlbums(f: ListFilters<AlbumSort>): Promise<AlbumWithTracks[]> {
  let list: AlbumWithTracks[];
  if (f.liked === true) {
    list = [...likedAlbumIds]
      .map((id) => albumIndex.get(id))
      .filter((a): a is Album => Boolean(a))
      .map(withTracks)
      .filter((a) => (!f.genre || a.genres.includes(f.genre)) && matches(f.q, a.title, a.artist));
    if (f.sort === "new") list = [...list].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  } else {
    list = await fromJamendo(
      "Album search",
      async () => {
        const limit = Math.min(f.limit ?? 24, 50);
        let found: AlbumWithTracks[];
        if (!f.q && !f.genre) {
          found = await jamendoAlbums({ order: f.sort === "new" ? "releasedate_desc" : "popularity_month", limit });
        } else {
          // /albums has no tag filter or full-text search: find matching tracks grouped by album,
          // then load those albums (with their track lists) in one request.
          const params: JamendoParams = { ...genreQuery(f.genre), groupby: "album_id", limit };
          if (f.q) params.search = f.q;
          else if (f.sort === "new") params.order = "releasedate_desc";
          const raw = await jamendoGet<JamendoTrack>("tracks", { ...TRACK_PARAMS, ...params });
          const ids = [...new Set(raw.map((t) => String(t.album_id)).filter((id) => id && id !== "0"))];
          found = await jamendoAlbumsByIds(ids, f.genre ? [f.genre] : []);
        }
        found = found.filter((a) => a.tracks.length > 0);
        if (f.sort === "new") found = [...found].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
        return f.liked === false ? found.filter((a) => !a.liked) : found;
      },
      () => seedAlbumList(f)
    );
  }
  if (f.sort === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  return f.limit ? list.slice(0, f.limit) : list;
}

/** Known track, or (Jamendo ids only) fetched on demand — e.g. after a server restart. */
export async function getTrack(id: string): Promise<Track | undefined> {
  const known = trackIndex.get(id);
  if (known) return withLike(known);
  const jid = jamendoTrackIdOf(id);
  if (!jid || !jamendoClientId()) return undefined;
  try {
    const [t] = await jamendoTracks({ id: jid, limit: 1 });
    return t;
  } catch {
    return undefined;
  }
}

export async function getAlbum(id: string): Promise<AlbumWithTracks | undefined> {
  const known = albumIndex.get(id);
  if (known) return withTracks(known);
  const jid = jamendoAlbumIdOf(id);
  if (!jid || !jamendoClientId()) return undefined;
  try {
    const [a] = await jamendoAlbumsByIds([jid]);
    return a;
  } catch {
    return undefined;
  }
}

/** Upstream stream URL for a Jamendo track (server-side only). */
export async function upstreamAudioFor(id: string): Promise<string | undefined> {
  if (!upstreamAudio.has(id)) await getTrack(id);
  return upstreamAudio.get(id);
}

export async function setTrackLike(id: string, liked: boolean): Promise<Track | undefined> {
  const track = await getTrack(id);
  if (!track) return undefined;
  if (liked) likedTrackIds.add(id);
  else likedTrackIds.delete(id);
  return withLike(track);
}

export async function setAlbumLike(id: string, liked: boolean): Promise<Album | undefined> {
  const album = await getAlbum(id);
  if (!album) return undefined;
  if (liked) likedAlbumIds.add(id);
  else likedAlbumIds.delete(id);
  const { tracks: _t, ...plain } = album;
  return { ...plain, liked };
}

// ---------------------------------------------------------------------------
// Genres, playlists, stats
// ---------------------------------------------------------------------------
export function listGenres(): Genre[] {
  const jamendo = catalogStatus().source === "jamendo";
  return genreDefs.map((g) => ({
    ...g,
    // Exact Jamendo counts would cost one `fullcount` request per genre — not worth it.
    trackCount: jamendo ? null : seedTracks.filter((t) => t.genres.includes(g.id)).length,
    albumCount: jamendo ? null : seedAlbums.filter((a) => a.genres.includes(g.id)).length,
  }));
}

/** Jamendo queries used to fill the built-in playlists with real tracks (once). */
const playlistQueries: Record<string, JamendoParams> = {
  "p-gym": { fuzzytags: "sport workout energetic", speed: "high veryhigh" },
  "p-pre-party": { fuzzytags: "party dance" },
  "p-reading": { vocalinstrumental: "instrumental", fuzzytags: "piano classical ambient" },
  "p-meditation": { fuzzytags: "meditation relaxation ambient" },
  "p-walk": { fuzzytags: "pop indie happy" },
};
let playlistsFilled = false;

async function fillPlaylistsFromJamendo(): Promise<void> {
  if (playlistsFilled || !jamendoClientId()) return;
  await fromJamendo(
    "Playlists",
    async () => {
      const entries = Object.entries(playlistQueries);
      const results = await Promise.all(
        entries.map(([, q]) => jamendoTracks({ ...q, boost: "popularity_total", groupby: "artist_id", limit: 8 }))
      );
      entries.forEach(([id], i) => {
        const p = playlists.find((x) => x.id === id);
        if (p && results[i].length) p.trackIds = results[i].map((t) => t.id);
      });
      playlistsFilled = true;
    },
    () => undefined
  );
}

function resolvePlaylist(p: Playlist): Playlist {
  // "Favourites" always mirrors the liked tracks, in like order.
  return p.id === "p-favourites" ? { ...p, trackIds: [...likedTrackIds] } : { ...p, trackIds: [...p.trackIds] };
}

export async function listPlaylists(): Promise<Playlist[]> {
  await fillPlaylistsFromJamendo();
  return playlists.map(resolvePlaylist);
}

export async function getPlaylist(id: string): Promise<Playlist | undefined> {
  await fillPlaylistsFromJamendo();
  const p = playlists.find((x) => x.id === id);
  return p && resolvePlaylist(p);
}

export function playlistTracks(p: Playlist): Track[] {
  return tracksByIds(p.trackIds);
}

export function computeStats(): Stats {
  return {
    totalHours: statsBase.totalHours,
    likes: statsBase.likesFromOtherContent + likedTrackIds.size + likedAlbumIds.size,
    tracks: statsBase.tracks,
  };
}
