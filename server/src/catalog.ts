// Catalogue facade used by the routes: serves Jamendo data when JAMENDO_CLIENT_ID is set and
// Jamendo answers, otherwise the built-in fictional seed (no audio → simulated playback).
// User state (likes, user playlists, history, last playback) is keyed by track/album id for both
// sources and persisted by ./userStore.ts.
import { randomUUID } from "node:crypto";
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
  HistoryEntry,
  HistoryItem,
  ListeningStats,
  PlaybackState,
  Playlist,
  Stats,
  Track,
  TrackSort,
} from "./types.js";
import { markChanged, MAX_HISTORY, onBeforeSave, userState, userStateExisted, type StoredPlaylist } from "./userStore.js";

// ---------------------------------------------------------------------------
// Registry of every track/album the server has served (seed + Jamendo). The `liked` flag on
// stored objects is ignored — likes live in the sets below and are applied on the way out.
// ---------------------------------------------------------------------------
const trackIndex = new Map<string, Track>();
const albumIndex = new Map<string, Album>();
/** Real Jamendo stream URLs (contain the client id) — server-side only. */
const upstreamAudio = new Map<string, string>();

const likedTrackIds = new Set<string>(userState.likedTrackIds);
const likedAlbumIds = new Set<string>(userState.likedAlbumIds);

const seedAlbumOfTrack = new Map<string, string>();
for (const a of seedAlbums) for (const tid of a.trackIds) if (!seedAlbumOfTrack.has(tid)) seedAlbumOfTrack.set(tid, a.id);

for (const t of seedTracks) trackIndex.set(t.id, { ...t, albumId: seedAlbumOfTrack.get(t.id) });
for (const a of seedAlbums) albumIndex.set(a.id, a);
// Snapshots of Jamendo items the listener referenced in earlier sessions.
for (const t of Object.values(userState.trackMeta)) if (!trackIndex.has(t.id)) trackIndex.set(t.id, { ...t, liked: false });
for (const a of Object.values(userState.albumMeta)) if (!albumIndex.has(a.id)) albumIndex.set(a.id, { ...a, liked: false });

function persistLikes() {
  userState.likedTrackIds = [...likedTrackIds];
  userState.likedAlbumIds = [...likedAlbumIds];
  markChanged();
}

// First run only: the seed's demo likes make sense for the demo catalogue. With Jamendo
// configured, the listener starts with empty Favourites instead of fictional, unplayable tracks.
// (env.ts has already loaded server/.env by the time this module runs.)
if (!userStateExisted && !jamendoClientId()) {
  for (const t of seedTracks) if (t.liked) likedTrackIds.add(t.id);
  for (const a of seedAlbums) if (a.liked) likedAlbumIds.add(a.id);
  persistLikes();
}

/** Remembers a non-seed track so it still renders after a restart (seed tracks always exist). */
function snapshotTrack(id: string) {
  const t = trackIndex.get(id);
  if (t && t.source !== "seed") userState.trackMeta[id] = { ...t, liked: false };
}

function snapshotAlbum(id: string) {
  const a = albumIndex.get(id);
  if (!a || a.source === "seed") return;
  const { liked: _l, ...plain } = a;
  userState.albumMeta[id] = plain;
  a.trackIds.forEach(snapshotTrack);
}

/** Drops snapshots nothing refers to any more (runs right before every write). */
onBeforeSave((s) => {
  const keepAlbums = new Set(s.likedAlbumIds);
  const keepTracks = new Set<string>([
    ...s.likedTrackIds,
    ...s.playlists.flatMap((p) => p.trackIds),
    ...s.history.map((h) => h.trackId),
    ...(s.playback ? [s.playback.trackId, ...s.playback.queue] : []),
  ]);
  for (const id of Object.keys(s.albumMeta)) {
    if (keepAlbums.has(id)) s.albumMeta[id].trackIds.forEach((t) => keepTracks.add(t));
    else delete s.albumMeta[id];
  }
  for (const id of Object.keys(s.trackMeta)) if (!keepTracks.has(id)) delete s.trackMeta[id];
  // Refresh snapshots that are still referenced (metadata may have been enriched since).
  for (const id of keepTracks) snapshotTrack(id);
});

function registerTrack({ track, upstreamAudio: audio }: MappedTrack): Track {
  const known = trackIndex.get(track.id);
  // A track seen via /tracks has richer data (genres from musicinfo) than via /albums/tracks.
  const merged: Track = known
    ? {
        ...known,
        ...track,
        genres: [...new Set([...known.genres, ...track.genres])],
        coverUrl: track.coverUrl ?? known.coverUrl,
        albumId: track.albumId ?? known.albumId,
      }
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

/**
 * Jamendo sometimes answers `groupby=artist_id` queries with an empty list (seen on a cold cache)
 * and the full list a moment later. Retry once without grouping and keep one track per artist.
 */
async function groupedByArtist(params: JamendoParams): Promise<Track[]> {
  const grouped = await jamendoTracks({ ...params, groupby: "artist_id" });
  if (grouped.length) return grouped;
  const seen = new Set<string>();
  return (await jamendoTracks(params)).filter((t) => !seen.has(t.artist) && Boolean(seen.add(t.artist)));
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
      const pool = await groupedByArtist({ order: "popularity_month", limit: 50 });
      return seededShuffle(nonEmpty(pool, "daily mix tracks"), dayNumber()).slice(0, 12);
    },
    () => tracksByIds(dailyMixTrackIds)
  );
}

/** Default "Recent plays" (used while the listener has no play history yet). */
function defaultRecentTracks(): Promise<Track[]> {
  return fromJamendo(
    "Recent plays",
    async () => nonEmpty(await groupedByArtist({ featured: 1, limit: 11 }), "featured tracks"),
    () => tracksByIds(recentTrackIds)
  );
}

const RECENT_LIMIT = 20;

/** Real play history (deduplicated, newest first), else the default list. */
export async function recentTracks(): Promise<Track[]> {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let i = userState.history.length - 1; i >= 0 && ids.length < RECENT_LIMIT; i--) {
    const id = userState.history[i].trackId;
    if (seen.has(id) || !trackIndex.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length ? tracksByIds(ids) : defaultRecentTracks();
}

const DEFAULT_VOLUME = 0.8;

export async function lastPlayback(): Promise<PlaybackState> {
  const saved = userState.playback;
  if (saved) {
    const track = await getTrack(saved.trackId);
    if (track) {
      const queueTracks = tracksByIds(saved.queue.includes(track.id) ? saved.queue : [track.id, ...saved.queue]);
      return {
        trackId: track.id,
        position: Math.min(saved.position, Math.max(0, track.duration - 1)),
        queue: queueTracks.map((t) => t.id),
        queueTracks,
        track,
        volume: saved.volume,
        saved: true,
      };
    }
  }
  const recent = await defaultRecentTracks();
  if (recent[0]?.source === "jamendo") {
    return {
      trackId: recent[0].id,
      position: 0,
      queue: recent.map((t) => t.id),
      queueTracks: recent,
      track: recent[0],
      volume: DEFAULT_VOLUME,
      saved: false,
    };
  }
  return {
    ...seedLastPlayback,
    queueTracks: tracksByIds(seedLastPlayback.queue),
    track: withLike(trackIndex.get(seedLastPlayback.trackId)!),
    volume: DEFAULT_VOLUME,
    saved: false,
  };
}

export const MAX_QUEUE = 500;

/** Saves where the listener is. Returns false if the track is unknown. */
export async function savePlayback(input: {
  trackId: string;
  position: number;
  queue?: string[];
  volume?: number;
}): Promise<boolean> {
  const track = await getTrack(input.trackId);
  if (!track) return false;
  const prev = userState.playback;
  const queue = input.queue ? input.queue.filter((id) => trackIndex.has(id)).slice(0, MAX_QUEUE) : prev?.queue ?? [track.id];
  userState.playback = {
    trackId: track.id,
    position: Math.min(Math.max(0, input.position), track.duration || input.position),
    queue,
    volume: input.volume ?? prev?.volume ?? DEFAULT_VOLUME,
    updatedAt: new Date().toISOString(),
  };
  markChanged();
  return true;
}

function seedTrackList(f: ListFilters<TrackSort>): Track[] {
  let list = seedTracks
    .map((t) => trackIndex.get(t.id) ?? t)
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

async function fetchJamendoTrack(jid: string): Promise<Track | undefined> {
  if (!jamendoClientId()) return undefined;
  try {
    const [t] = await jamendoTracks({ id: jid, limit: 1 });
    return t;
  } catch {
    return undefined;
  }
}

/** Known track, or (Jamendo ids only) fetched on demand — e.g. after a server restart. */
export async function getTrack(id: string): Promise<Track | undefined> {
  const known = trackIndex.get(id);
  if (known) return withLike(known);
  const jid = jamendoTrackIdOf(id);
  return jid ? fetchJamendoTrack(jid) : undefined;
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
  if (!upstreamAudio.has(id)) {
    // Restored snapshots (after a restart) carry no stream URL: ask Jamendo again.
    const jid = jamendoTrackIdOf(id);
    if (jid) await fetchJamendoTrack(jid);
  }
  return upstreamAudio.get(id);
}

export async function setTrackLike(id: string, liked: boolean): Promise<Track | undefined> {
  const track = await getTrack(id);
  if (!track) return undefined;
  if (liked === likedTrackIds.has(id)) return withLike(track);
  if (liked) {
    likedTrackIds.add(id);
    snapshotTrack(id);
  } else likedTrackIds.delete(id);
  persistLikes();
  return withLike(track);
}

export async function setAlbumLike(id: string, liked: boolean): Promise<Album | undefined> {
  const album = await getAlbum(id);
  if (!album) return undefined;
  if (liked !== likedAlbumIds.has(id)) {
    if (liked) {
      likedAlbumIds.add(id);
      snapshotAlbum(id);
    } else likedAlbumIds.delete(id);
    persistLikes();
  }
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

const FAVOURITES_ID = "p-favourites";

function resolvePlaylist(p: Playlist): Playlist {
  // "Favourites" always mirrors the liked tracks, in like order.
  return p.id === FAVOURITES_ID ? { ...p, trackIds: [...likedTrackIds] } : { ...p, trackIds: [...p.trackIds] };
}

const userPlaylistOut = (p: StoredPlaylist): Playlist => ({
  id: p.id,
  name: p.name,
  kind: "user",
  // Hide ids we cannot resolve (e.g. a Jamendo track whose snapshot was lost).
  trackIds: p.trackIds.filter((id) => trackIndex.has(id)),
});

export async function listPlaylists(): Promise<Playlist[]> {
  await fillPlaylistsFromJamendo();
  return [...playlists.map(resolvePlaylist), ...userState.playlists.map(userPlaylistOut)];
}

export async function getPlaylist(id: string): Promise<Playlist | undefined> {
  await fillPlaylistsFromJamendo();
  const p = playlists.find((x) => x.id === id);
  if (p) return resolvePlaylist(p);
  const u = userState.playlists.find((x) => x.id === id);
  return u && userPlaylistOut(u);
}

export function playlistTracks(p: Playlist): Track[] {
  return tracksByIds(p.trackIds);
}

export const MAX_PLAYLISTS = 200;
export const MAX_PLAYLIST_TRACKS = 1000;

/** Expected failures the routes turn into HTTP status codes. */
export class UserError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    message: string
  ) {
    super(message);
  }
}

function findUserPlaylist(id: string): StoredPlaylist {
  const u = userState.playlists.find((x) => x.id === id);
  if (u) return u;
  const builtin = playlists.find((x) => x.id === id);
  if (builtin) throw new UserError(403, `Playlist "${builtin.name}" is read-only`);
  throw new UserError(404, "Playlist not found");
}

export async function createPlaylist(name: string, trackIds: string[]): Promise<Playlist> {
  if (userState.playlists.length >= MAX_PLAYLISTS) {
    throw new UserError(409, `You can have at most ${MAX_PLAYLISTS} playlists`);
  }
  const ids = [...new Set(trackIds)];
  for (const id of ids) if (!(await getTrack(id))) throw new UserError(400, `Unknown track id "${id}"`);
  const now = new Date().toISOString();
  const p: StoredPlaylist = { id: `u-${randomUUID().slice(0, 8)}`, name, trackIds: ids, createdAt: now, updatedAt: now };
  userState.playlists.push(p);
  ids.forEach(snapshotTrack);
  markChanged();
  return userPlaylistOut(p);
}

export function renamePlaylist(id: string, name: string): Playlist {
  const p = findUserPlaylist(id);
  p.name = name;
  p.updatedAt = new Date().toISOString();
  markChanged();
  return userPlaylistOut(p);
}

export function deletePlaylist(id: string): void {
  const p = findUserPlaylist(id);
  userState.playlists = userState.playlists.filter((x) => x !== p);
  markChanged();
}

/** Adds a track (no-op if already there). On Favourites this likes the track. */
export async function addTrackToPlaylist(id: string, trackId: string): Promise<Playlist> {
  if (id === FAVOURITES_ID) {
    if (!(await setTrackLike(trackId, true))) throw new UserError(404, "Track not found");
    return (await getPlaylist(id))!;
  }
  const p = findUserPlaylist(id);
  if (!(await getTrack(trackId))) throw new UserError(404, "Track not found");
  if (!p.trackIds.includes(trackId)) {
    if (p.trackIds.length >= MAX_PLAYLIST_TRACKS) throw new UserError(409, "This playlist is full");
    p.trackIds.push(trackId);
    p.updatedAt = new Date().toISOString();
    snapshotTrack(trackId);
    markChanged();
  }
  return userPlaylistOut(p);
}

/** Removes a track. On Favourites this unlikes it. 404 if the track is not in the playlist. */
export async function removeTrackFromPlaylist(id: string, trackId: string): Promise<Playlist> {
  if (id === FAVOURITES_ID) {
    if (!likedTrackIds.has(trackId)) throw new UserError(404, "Track is not in this playlist");
    await setTrackLike(trackId, false);
    return (await getPlaylist(id))!;
  }
  const p = findUserPlaylist(id);
  if (!p.trackIds.includes(trackId)) throw new UserError(404, "Track is not in this playlist");
  p.trackIds = p.trackIds.filter((x) => x !== trackId);
  p.updatedAt = new Date().toISOString();
  markChanged();
  return userPlaylistOut(p);
}

// ---------------------------------------------------------------------------
// Play history
// ---------------------------------------------------------------------------
/** Listened seconds can't exceed the track length (plus a little slack for timer drift). */
const clampSeconds = (seconds: number, t: Track) =>
  Math.round(Math.min(Math.max(0, seconds), (t.duration || 86_400) + 5));

/**
 * Records a play, or (with `entryId`) raises the listened seconds of an earlier report of the
 * same play. Returns undefined if the track is unknown.
 */
export async function reportPlay(trackId: string, seconds: number, entryId?: string): Promise<HistoryEntry | undefined> {
  const track = await getTrack(trackId);
  if (!track) return undefined;
  const s = clampSeconds(seconds, track);
  if (entryId) {
    const existing = userState.history.find((h) => h.id === entryId);
    if (existing && existing.trackId === trackId) {
      if (s > existing.seconds) {
        existing.seconds = s;
        markChanged();
      }
      return existing;
    }
  }
  const entry: HistoryEntry = { id: randomUUID(), trackId, playedAt: new Date().toISOString(), seconds: s };
  userState.history.push(entry);
  if (userState.history.length > MAX_HISTORY) userState.history.splice(0, userState.history.length - MAX_HISTORY);
  snapshotTrack(trackId);
  markChanged();
  return entry;
}

/** Newest first. Entries whose track can no longer be resolved are skipped. */
export function listHistory(limit: number): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (let i = userState.history.length - 1; i >= 0 && out.length < limit; i--) {
    const h = userState.history[i];
    const t = trackIndex.get(h.trackId);
    if (t) out.push({ ...h, track: withLike(t) });
  }
  return out;
}

export function clearHistory(): number {
  const n = userState.history.length;
  userState.history = [];
  markChanged();
  return n;
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Tally = { plays: number; seconds: number };

export function listeningStats(): ListeningStats {
  const byTrack = new Map<string, Tally>();
  const byArtist = new Map<string, Tally>();
  const days = new Map<string, Tally>();
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    days.set(localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)), { plays: 0, seconds: 0 });
  }
  const bump = (m: Map<string, Tally>, key: string, seconds: number) => {
    const v = m.get(key) ?? { plays: 0, seconds: 0 };
    v.plays++;
    v.seconds += seconds;
    m.set(key, v);
  };
  let totalSeconds = 0;
  for (const h of userState.history) {
    totalSeconds += h.seconds;
    bump(byTrack, h.trackId, h.seconds);
    const t = trackIndex.get(h.trackId);
    if (t) bump(byArtist, t.artist, h.seconds);
    const day = localDate(new Date(h.playedAt));
    if (days.has(day)) bump(days, day, h.seconds);
  }
  const rank = (a: Tally, b: Tally) => b.plays - a.plays || b.seconds - a.seconds;
  const topTracks: ListeningStats["topTracks"] = [];
  for (const [id, v] of [...byTrack].sort((a, b) => rank(a[1], b[1]))) {
    const t = trackIndex.get(id);
    if (t) topTracks.push({ track: withLike(t), ...v });
    if (topTracks.length === 10) break;
  }
  return {
    totalSeconds,
    plays: userState.history.length,
    uniqueTracks: byTrack.size,
    uniqueArtists: byArtist.size,
    likedTracks: likedTrackIds.size,
    likedAlbums: likedAlbumIds.size,
    firstPlayedAt: userState.history[0]?.playedAt ?? null,
    topTracks,
    topArtists: [...byArtist]
      .sort((a, b) => rank(a[1], b[1]))
      .slice(0, 10)
      .map(([artist, v]) => ({ artist, ...v })),
    last7Days: [...days].map(([date, v]) => ({ date, ...v })),
  };
}

export function computeStats(): Stats {
  return {
    totalHours: statsBase.totalHours,
    likes: statsBase.likesFromOtherContent + likedTrackIds.size + likedAlbumIds.size,
    tracks: statsBase.tracks,
  };
}

/** Every album for the "Albums of the Week" page: this week's picks first, then more popular ones. */
export function allWeekAlbums(): Promise<AlbumWithTracks[]> {
  return fromJamendo(
    "Albums of the week (all)",
    async () => {
      const list = await popularAlbums();
      const day = list[dayNumber() % Math.min(list.length, 5)];
      return list.filter((a) => a.id !== day.id);
    },
    () => {
      const rest = seedAlbums.filter((a) => a.id !== seedDayId && !seedWeekIds.includes(a.id)).map((a) => a.id);
      return [...seedWeekIds, ...rest].map((id) => withTracks(albumIndex.get(id)!));
    }
  );
}
