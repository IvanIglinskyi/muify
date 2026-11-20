// Catalogue facade used by the routes: serves Jamendo data when JAMENDO_CLIENT_ID is set and
// Jamendo answers, otherwise the built-in fictional seed (no audio → simulated playback).
//
// The catalogue (tracks/albums/genres/curated playlists) is shared by everyone. User state
// (likes, user playlists, history, last playback) belongs to one listener: every function that
// touches it takes the caller's `UserDoc` (see userStore.ts), or `null` for a signed-out guest —
// guests see no likes, default "Recent plays" and the demo player state.
import { randomBytes, randomUUID } from "node:crypto";
import { albumOfTheDayId as seedDayId, albums as seedAlbums, weekAlbumIds as seedWeekIds } from "./data/albums.js";
import { genreDefs } from "./data/genres.js";
import { playlists } from "./data/playlists.js";
import { dailyMixTrackIds, lastPlayback as seedLastPlayback, recentTrackIds, tracks as seedTracks } from "./data/tracks.js";
import { jamendoClientId, jamendoGet, type JamendoParams } from "./jamendo/client.js";
import { genreMappings, type JamendoGenreQuery } from "./jamendo/genres.js";
import {
  jamendoAlbumIdOf,
  jamendoArtistIdOf,
  jamendoTrackIdOf,
  mapAlbum,
  mapArtist,
  mapTrack,
  type MappedAlbum,
  type MappedTrack,
} from "./jamendo/map.js";
import type { JamendoAlbum, JamendoArtist, JamendoTrack } from "./jamendo/types.js";
import {
  artistKey,
  buildProfile,
  hashString,
  MIN_SIGNALS,
  pickMix,
  profileSignature,
  recentlyPlayed,
  seededShuffle,
  type TasteProfile,
} from "./recommend.js";
import type {
  Album,
  AlbumSort,
  AlbumWithTracks,
  Artist,
  ArtistDetails,
  CatalogStatus,
  Genre,
  HistoryEntry,
  HistoryItem,
  ListeningStats,
  PlaybackState,
  Playlist,
  Recommendations,
  SharedPlaylist,
  Stats,
  Track,
  TrackSort,
} from "./types.js";
import { authMode, firebaseConfigInfo } from "./firebase.js";
import { LOCAL_UID, setDocHooks, userStore, type StoredPlaylist, type UserDoc } from "./userStore.js";

/** Artist page id of a seed (fictional) artist: "sa-<slug of the name>". */
export function seedArtistId(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `sa-${slug || "x"}`;
}

/** The caller's state, or null for a guest. */
export type Viewer = UserDoc | null;

// ---------------------------------------------------------------------------
// Registry of every track/album the server has served (seed + Jamendo). The `liked` flag on
// stored objects is ignored — likes live in each user's state and are applied on the way out.
// ---------------------------------------------------------------------------
const trackIndex = new Map<string, Track>();
const albumIndex = new Map<string, Album>();
/** Real Jamendo stream URLs (contain the client id) — server-side only. */
const upstreamAudio = new Map<string, string>();

const seedAlbumOfTrack = new Map<string, string>();
for (const a of seedAlbums) for (const tid of a.trackIds) if (!seedAlbumOfTrack.has(tid)) seedAlbumOfTrack.set(tid, a.id);

for (const t of seedTracks) {
  trackIndex.set(t.id, { ...t, liked: false, albumId: seedAlbumOfTrack.get(t.id), artistId: seedArtistId(t.artist) });
}
for (const a of seedAlbums) albumIndex.set(a.id, { ...a, liked: false, artistId: seedArtistId(a.artist) });

setDocHooks({
  onLoad(doc, fresh) {
    // Snapshots of Jamendo items this listener referenced in earlier sessions.
    for (const t of Object.values(doc.state.trackMeta)) if (!trackIndex.has(t.id)) trackIndex.set(t.id, { ...t, liked: false });
    for (const a of Object.values(doc.state.albumMeta)) if (!albumIndex.has(a.id)) albumIndex.set(a.id, { ...a, liked: false });
    // Local mode, first run only: the seed's demo likes make sense for the demo catalogue. With
    // Jamendo configured (or real accounts) the listener starts with empty Favourites instead.
    if (fresh && doc.uid === LOCAL_UID && !jamendoClientId()) {
      for (const t of seedTracks) if (t.liked) doc.setTrackLike(t.id, true);
      for (const a of seedAlbums) if (a.liked) doc.setAlbumLike(a.id, true);
    }
  },
});

/** Remembers a non-seed track so it still renders after a restart (seed tracks always exist). */
function snapshotTrack(u: UserDoc, id: string) {
  const t = trackIndex.get(id);
  if (t && t.source !== "seed") u.snapshotTrack(t);
}

function snapshotAlbum(u: UserDoc, id: string) {
  const a = albumIndex.get(id);
  if (!a || a.source === "seed") return;
  const { liked: _l, ...plain } = a;
  u.snapshotAlbum(plain);
  a.trackIds.forEach((t) => snapshotTrack(u, t));
}

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
        artistId: track.artistId ?? known.artistId,
      }
    : track;
  merged.liked = false;
  trackIndex.set(merged.id, merged);
  if (audio) upstreamAudio.set(merged.id, audio);
  return merged;
}

function registerAlbum({ album, tracks }: MappedAlbum): Album {
  tracks.forEach(registerTrack);
  const { tracks: _t, ...plain } = album;
  const known = albumIndex.get(plain.id);
  const merged: Album = known ? { ...plain, genres: [...new Set([...known.genres, ...plain.genres])] } : plain;
  merged.liked = false;
  albumIndex.set(merged.id, merged);
  return merged;
}

const trackLiked = (id: string, u: Viewer) => Boolean(u?.state.likedTracks.has(id));
const albumLiked = (id: string, u: Viewer) => Boolean(u?.state.likedAlbums.has(id));

const withLike = (t: Track, u: Viewer): Track => ({ ...t, liked: trackLiked(t.id, u) });
const likeAll = (list: Track[], u: Viewer) => list.map((t) => withLike(t, u));

function tracksByIds(ids: string[], u: Viewer): Track[] {
  return ids.map((id) => trackIndex.get(id)).filter((t): t is Track => Boolean(t)).map((t) => withLike(t, u));
}

function withTracks(a: Album, u: Viewer): AlbumWithTracks {
  return { ...a, liked: albumLiked(a.id, u), tracks: tracksByIds(a.trackIds, u) };
}

/** Re-applies the viewer's likes to albums fetched without them. */
const likeAlbums = (list: AlbumWithTracks[], u: Viewer) =>
  list.map((a) => ({ ...a, liked: albumLiked(a.id, u), tracks: likeAll(a.tracks, u) }));

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
  const fb = firebaseConfigInfo();
  return {
    source: configured && !lastError ? "jamendo" : "seed",
    jamendoConfigured: configured,
    lastError: configured ? lastError : null,
    auth: {
      mode: authMode(),
      emulator: fb.emulator,
      projectId: fb.projectId,
      reason: fb.mode === "local" ? "Firebase is not configured on the server" : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Jamendo queries (results carry no likes; the public functions apply the viewer's likes)
// ---------------------------------------------------------------------------
const TRACK_PARAMS: JamendoParams = { include: "musicinfo", audioformat: "mp32", imagesize: 300 };
const ALBUM_PARAMS: JamendoParams = { audioformat: "mp32", imagesize: 500 };
const MAX_JAMENDO_LIMIT = 200;

async function jamendoTracks(params: JamendoParams, genres: string[] = []): Promise<Track[]> {
  const raw = await jamendoGet<JamendoTrack>("tracks", { ...TRACK_PARAMS, ...params });
  const clientId = jamendoClientId();
  return raw.map((r) => ({ ...registerTrack(mapTrack(r, genres, clientId)) }));
}

async function jamendoAlbums(params: JamendoParams, genres: string[] = []): Promise<AlbumWithTracks[]> {
  const raw = await jamendoGet<JamendoAlbum>("albums/tracks", { ...ALBUM_PARAMS, ...params });
  const clientId = jamendoClientId();
  return raw.map((r) => withTracks(registerAlbum(mapAlbum(r, genres, clientId)), null));
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

export async function albumOfTheDay(u: Viewer): Promise<AlbumWithTracks> {
  const a = await fromJamendo(
    "Album of the day",
    async () => {
      const list = await popularAlbums();
      return list[dayNumber() % Math.min(list.length, 5)];
    },
    () => withTracks(albumIndex.get(seedDayId)!, null)
  );
  return likeAlbums([a], u)[0];
}

export async function weekAlbums(u: Viewer): Promise<AlbumWithTracks[]> {
  const list = await fromJamendo(
    "Albums of the week",
    async () => {
      const all = await popularAlbums();
      const day = all[dayNumber() % Math.min(all.length, 5)];
      return all.filter((a) => a.id !== day.id).slice(0, 4);
    },
    () => seedWeekIds.map((id) => withTracks(albumIndex.get(id)!, null))
  );
  return likeAlbums(list, u);
}

/** The same mix for everyone (guests, listeners without enough data). */
async function genericDailyMix(): Promise<Track[]> {
  return fromJamendo(
    "Daily mix",
    async () => {
      const pool = await groupedByArtist({ order: "popularity_month", limit: 50 });
      return seededShuffle(nonEmpty(pool, "daily mix tracks"), dayNumber()).slice(0, 12);
    },
    () => tracksByIds(dailyMixTrackIds, null)
  );
}

export async function dailyMix(u: Viewer): Promise<Track[]> {
  return (await recommendations(u)).dailyMix.tracks;
}

// ---------------------------------------------------------------------------
// Personalised recommendations (Daily Mix + "Because you liked …")
// ---------------------------------------------------------------------------
const MIX_SIZE = 12;
const BECAUSE_SIZE = 10;
const BECAUSE_MIN = 4;
/** Recently played tracks are left out of the personal mix. */
const EXCLUDE_RECENT = 30;
const REC_TTL_MS = 60 * 60_000;
const REC_CACHE_MAX = 500;

interface CachedRecs {
  key: string;
  until: number;
  mixIds: string[];
  personalised: boolean;
  basedOn: string[];
  because: { artist: { id: string | null; name: string }; trackIds: string[] } | null;
}
const recCache = new Map<string, CachedRecs>();
/** In-flight computations, so a burst of requests from one user costs one set of Jamendo calls. */
const recInflight = new Map<string, Promise<CachedRecs>>();

function tasteOf(u: UserDoc): TasteProfile {
  const s = u.state;
  return buildProfile({
    likedTracks: [...s.likedTracks.keys()].map((id) => trackIndex.get(id)).filter((t): t is Track => Boolean(t)),
    likedAlbums: [...s.likedAlbums.keys()].map((id) => albumIndex.get(id)).filter((a): a is Album => Boolean(a)),
    plays: s.history
      .map((h) => ({ track: trackIndex.get(h.trackId), seconds: h.seconds }))
      .filter((p): p is { track: Track; seconds: number } => Boolean(p.track)),
  });
}

/** Jamendo tags for our genre ids (OR-matched with fuzzytags). */
function tagsFor(genreIds: string[]): string[] {
  return [...new Set(genreIds.flatMap((g) => genreMappings[g]?.matchTags.slice(0, 2) ?? []))].slice(0, 6);
}

/** Candidate pool for one listener: seed catalogue, or Jamendo tracks by their artists / tags. */
async function candidatePool(p: TasteProfile, source: "jamendo" | "seed"): Promise<Track[]> {
  if (source === "seed") return seedTracks.map((t) => trackIndex.get(t.id)!).filter(Boolean);
  const artistIds = p.artists
    .map((a) => (a.id ? jamendoArtistIdOf(a.id) : null))
    .filter((x): x is string => Boolean(x))
    .slice(0, 5);
  const tags = tagsFor(p.genres.slice(0, 3).map((g) => g.id));
  const [byArtists, byTags] = await Promise.all([
    artistIds.length ? jamendoTracks({ artist_id: artistIds.join(" "), order: "popularity_total", limit: 40 }) : [],
    tags.length ? jamendoTracks({ fuzzytags: tags.join(" "), boost: "popularity_month", groupby: "artist_id", limit: 50 }) : [],
  ]);
  return [...byArtists, ...byTags];
}

function becauseRow(
  p: TasteProfile,
  pool: Track[],
  u: UserDoc,
  seed: number
): CachedRecs["because"] {
  // One of the top liked artists, rotating daily.
  const choices = p.likedArtists.slice(0, 3);
  if (!choices.length) return null;
  const artist = choices[seed % choices.length];
  const own = (t: Track) => artistKey(t.artistId, t.artist) === artist.key || t.artist === artist.name;
  const likedOfArtist = [...u.state.likedTracks.keys()]
    .map((id) => trackIndex.get(id))
    .filter((t): t is Track => Boolean(t) && own(t!));
  const genres = new Set(likedOfArtist.flatMap((t) => t.genres));
  if (genres.size === 0) for (const g of p.genres.slice(0, 2)) genres.add(g.id);
  const recent = recentlyPlayed(u.state.history, EXCLUDE_RECENT);
  const fresh = (t: Track) => !u.state.likedTracks.has(t.id) && !recent.has(t.id);
  const sameArtist = seededShuffle(pool.filter((t) => own(t) && fresh(t)), seed).slice(0, 3);
  const similar = seededShuffle(
    pool.filter((t) => !own(t) && fresh(t) && t.genres.some((g) => genres.has(g))),
    seed
  );
  const out: Track[] = [];
  const seen = new Set<string>();
  const perArtist = new Map<string, number>();
  for (const t of [...sameArtist, ...similar]) {
    if (out.length >= BECAUSE_SIZE || seen.has(t.id)) continue;
    const k = artistKey(t.artistId, t.artist);
    if ((perArtist.get(k) ?? 0) >= 3) continue;
    perArtist.set(k, (perArtist.get(k) ?? 0) + 1);
    seen.add(t.id);
    out.push(t);
  }
  if (out.length < BECAUSE_MIN) return null;
  return { artist: { id: artist.id, name: artist.name }, trackIds: out.map((t) => t.id) };
}

async function computeRecs(u: UserDoc, p: TasteProfile, key: string): Promise<CachedRecs> {
  const generic = async (): Promise<CachedRecs> => ({
    key,
    until: Date.now() + REC_TTL_MS,
    mixIds: (await genericDailyMix()).map((t) => t.id),
    personalised: false,
    basedOn: [],
    because: null,
  });
  if (p.signals < MIN_SIGNALS) return generic();

  const seed = hashString(`${u.uid}:${dayNumber()}`);
  const source = catalogStatus().source;
  let pool: Track[];
  try {
    pool = await candidatePool(p, source);
  } catch (e) {
    console.warn(`[recs] Jamendo candidates failed (${(e as Error).message}); serving the generic mix.`);
    const g = await generic();
    return { ...g, until: Date.now() + 5 * 60_000 }; // try again soon
  }
  const exclude = recentlyPlayed(u.state.history, EXCLUDE_RECENT);
  let mix = pickMix(pool, p, { exclude, seed, size: MIX_SIZE });
  if (mix.length < MIX_SIZE / 2) return generic();
  if (mix.length < MIX_SIZE) {
    // Top up with the generic mix (still skipping what was just played).
    const have = new Set(mix.map((t) => t.id));
    const extra = (await genericDailyMix()).filter((t) => !have.has(t.id) && !exclude.has(t.id));
    mix = [...mix, ...extra].slice(0, MIX_SIZE);
  }
  return {
    key,
    until: Date.now() + REC_TTL_MS,
    mixIds: mix.map((t) => t.id),
    personalised: true,
    basedOn: p.artists.slice(0, 3).map((a) => a.name),
    because: becauseRow(p, pool, u, seed),
  };
}

/** Personal Daily Mix + "Because you liked …" (cached per user; generic for guests). */
export async function recommendations(u: Viewer): Promise<Recommendations> {
  if (!u) {
    return { dailyMix: { personalised: false, tracks: await genericDailyMix(), basedOn: [] }, becauseYouLiked: null };
  }
  const p = tasteOf(u);
  // Changes when the day, the catalogue source or the listener's taste changes.
  const key = `${dayNumber()}|${catalogStatus().source}|${p.signals >= MIN_SIGNALS ? profileSignature(p) : "generic"}`;
  let recs = recCache.get(u.uid);
  if (!recs || recs.key !== key || recs.until < Date.now()) {
    let pending = recInflight.get(u.uid);
    if (!pending) {
      pending = computeRecs(u, p, key).finally(() => recInflight.delete(u.uid));
      recInflight.set(u.uid, pending);
    }
    recs = await pending;
    recCache.delete(u.uid);
    if (recCache.size >= REC_CACHE_MAX) recCache.delete(recCache.keys().next().value!);
    recCache.set(u.uid, recs);
  }
  return {
    dailyMix: { personalised: recs.personalised, tracks: tracksByIds(recs.mixIds, u), basedOn: recs.basedOn },
    becauseYouLiked: recs.because && { artist: recs.because.artist, tracks: tracksByIds(recs.because.trackIds, u) },
  };
}

/** Test hook. */
export function clearRecommendationCache() {
  recCache.clear();
}

/** Default "Recent plays" (used while the listener has no play history yet). */
function defaultRecentTracks(): Promise<Track[]> {
  return fromJamendo(
    "Recent plays",
    async () => nonEmpty(await groupedByArtist({ featured: 1, limit: 11 }), "featured tracks"),
    () => tracksByIds(recentTrackIds, null)
  );
}

const RECENT_LIMIT = 20;

/** Real play history (deduplicated, newest first), else the default list. */
export async function recentTracks(u: Viewer): Promise<Track[]> {
  const seen = new Set<string>();
  const ids: string[] = [];
  const history = u?.state.history ?? [];
  for (let i = history.length - 1; i >= 0 && ids.length < RECENT_LIMIT; i--) {
    const id = history[i].trackId;
    if (seen.has(id) || !trackIndex.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length ? tracksByIds(ids, u) : likeAll(await defaultRecentTracks(), u);
}

const DEFAULT_VOLUME = 0.8;

export async function lastPlayback(u: Viewer): Promise<PlaybackState> {
  const saved = u?.state.playback;
  if (saved) {
    const track = await getTrack(saved.trackId, u);
    if (track) {
      const queueTracks = tracksByIds(saved.queue.includes(track.id) ? saved.queue : [track.id, ...saved.queue], u);
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
  const recent = likeAll(await defaultRecentTracks(), u);
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
    queueTracks: tracksByIds(seedLastPlayback.queue, u),
    track: withLike(trackIndex.get(seedLastPlayback.trackId)!, u),
    volume: DEFAULT_VOLUME,
    saved: false,
  };
}

export const MAX_QUEUE = 500;

/** Saves where the listener is. Returns false if the track is unknown. */
export async function savePlayback(
  u: UserDoc,
  input: { trackId: string; position: number; queue?: string[]; volume?: number }
): Promise<boolean> {
  const track = await getTrack(input.trackId, null);
  if (!track) return false;
  const prev = u.state.playback;
  const queue = input.queue ? input.queue.filter((id) => trackIndex.has(id)).slice(0, MAX_QUEUE) : prev?.queue ?? [track.id];
  u.setPlayback({
    trackId: track.id,
    position: Math.min(Math.max(0, input.position), track.duration || input.position),
    queue,
    volume: input.volume ?? prev?.volume ?? DEFAULT_VOLUME,
    updatedAt: new Date().toISOString(),
  });
  snapshotTrack(u, track.id);
  if (input.queue) queue.forEach((id) => snapshotTrack(u, id));
  return true;
}

function seedTrackList(f: ListFilters<TrackSort>, u: Viewer): Track[] {
  let list = seedTracks
    .map((t) => trackIndex.get(t.id) ?? t)
    .map((t) => withLike(t, u))
    .filter(
      (t) =>
        (!f.genre || t.genres.includes(f.genre)) &&
        (f.liked === null || t.liked === f.liked) &&
        matches(f.q, t.title, t.artist, t.album)
    );
  if (f.sort === "top") list = [...list].sort((a, b) => b.plays - a.plays);
  return list;
}

function likedTracksOf(f: ListFilters<TrackSort>, u: Viewer): Track[] {
  if (!u) return [];
  return tracksByIds([...u.state.likedTracks.keys()], u).filter(
    (t) => (!f.genre || t.genres.includes(f.genre)) && matches(f.q, t.title, t.artist, t.album)
  );
}

/** GET /api/tracks — Top charts (popularity), genre filter and search. */
export async function listTracks(f: ListFilters<TrackSort>, u: Viewer): Promise<Track[]> {
  let list: Track[];
  if (f.liked === true) {
    list = likedTracksOf(f, u); // likes are ours: answer from the registry
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
        const found = likeAll(await jamendoTracks(params, f.genre ? [f.genre] : []), u);
        return f.liked === false ? found.filter((t) => !t.liked) : found;
      },
      () => seedTrackList(f, u)
    );
  }
  if (f.sort === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  return f.limit ? list.slice(0, f.limit) : list;
}

function seedAlbumList(f: ListFilters<AlbumSort>, u: Viewer): AlbumWithTracks[] {
  let list = seedAlbums
    .map((a) => withTracks(albumIndex.get(a.id) ?? a, u))
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
export async function listAlbums(f: ListFilters<AlbumSort>, u: Viewer): Promise<AlbumWithTracks[]> {
  let list: AlbumWithTracks[];
  if (f.liked === true) {
    list = [...(u?.state.likedAlbums.keys() ?? [])]
      .map((id) => albumIndex.get(id))
      .filter((a): a is Album => Boolean(a))
      .map((a) => withTracks(a, u))
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
        found = likeAlbums(
          found.filter((a) => a.tracks.length > 0),
          u
        );
        if (f.sort === "new") found = [...found].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
        return f.liked === false ? found.filter((a) => !a.liked) : found;
      },
      () => seedAlbumList(f, u)
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
export async function getTrack(id: string, u: Viewer): Promise<Track | undefined> {
  const known = trackIndex.get(id);
  if (known) return withLike(known, u);
  const jid = jamendoTrackIdOf(id);
  const fetched = jid ? await fetchJamendoTrack(jid) : undefined;
  return fetched && withLike(fetched, u);
}

export async function getAlbum(id: string, u: Viewer): Promise<AlbumWithTracks | undefined> {
  const known = albumIndex.get(id);
  if (known) return withTracks(known, u);
  const jid = jamendoAlbumIdOf(id);
  if (!jid || !jamendoClientId()) return undefined;
  try {
    const [a] = await jamendoAlbumsByIds([jid]);
    return a && likeAlbums([a], u)[0];
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------
const ARTIST_TOP_TRACKS = 10;
const ARTIST_ALBUMS = 24;

/** Artist page from what the server already knows (seed data, or Jamendo items seen before). */
function artistFromRegistry(id: string, u: Viewer): ArtistDetails | undefined {
  const tracks = [...trackIndex.values()].filter((t) => t.artistId === id);
  const albums = [...albumIndex.values()].filter((a) => a.artistId === id);
  const name = tracks[0]?.artist ?? albums[0]?.artist;
  if (!name) return undefined;
  const source = tracks[0]?.source ?? albums[0]?.source ?? "seed";
  return {
    id,
    name,
    source,
    shareUrl: jamendoArtistIdOf(id) ? `https://www.jamendo.com/artist/${jamendoArtistIdOf(id)}` : undefined,
    topTracks: likeAll([...tracks].sort((a, b) => b.plays - a.plays).slice(0, ARTIST_TOP_TRACKS), u),
    albums: albums
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
      .slice(0, ARTIST_ALBUMS)
      .map((a) => withTracks(a, u)),
  };
}

/**
 * GET /api/artists/:id — "sa-…" ids come from the seed; "jr…" ids from Jamendo (/artists for the
 * profile, /tracks?artist_id for the top tracks, /albums/tracks?artist_id for the albums).
 * Returns undefined when the artist does not exist. If Jamendo is down, falls back to what the
 * server already knows about the artist, else throws a 502 UserError.
 */
export async function getArtist(id: string, u: Viewer): Promise<ArtistDetails | undefined> {
  const jid = jamendoArtistIdOf(id);
  if (!jid) return id.startsWith("sa-") ? artistFromRegistry(id, u) : undefined;
  if (!jamendoClientId()) return artistFromRegistry(id, u);
  try {
    const [info, top, albums] = await Promise.all([
      jamendoGet<JamendoArtist>("artists", { id: jid }),
      jamendoTracks({ artist_id: jid, order: "popularity_total", limit: ARTIST_TOP_TRACKS }),
      jamendoAlbums({ artist_id: jid, order: "releasedate_desc", limit: ARTIST_ALBUMS }),
    ]);
    if (!info[0]) return undefined;
    const artist: Artist = mapArtist(info[0], jamendoClientId());
    return {
      ...artist,
      topTracks: likeAll(top, u),
      albums: likeAlbums(
        albums.filter((a) => a.tracks.length > 0),
        u
      ),
    };
  } catch (e) {
    const known = artistFromRegistry(id, u);
    if (known) return known;
    console.warn(`[jamendo] Artist ${id} failed: ${(e as Error).message}`);
    throw new UserError(502, "Artist details are unavailable right now. Please try again later.");
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

export async function setTrackLike(u: UserDoc, id: string, liked: boolean): Promise<Track | undefined> {
  const track = await getTrack(id, u);
  if (!track) return undefined;
  if (liked !== trackLiked(id, u)) {
    u.setTrackLike(id, liked);
    if (liked) snapshotTrack(u, id);
  }
  return withLike(track, u);
}

export async function setAlbumLike(u: UserDoc, id: string, liked: boolean): Promise<Album | undefined> {
  const album = await getAlbum(id, u);
  if (!album) return undefined;
  if (liked !== albumLiked(id, u)) {
    u.setAlbumLike(id, liked);
    if (liked) snapshotAlbum(u, id);
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

function resolvePlaylist(p: Playlist, u: Viewer): Playlist {
  // "Favourites" always mirrors the liked tracks, in like order.
  return p.id === FAVOURITES_ID
    ? { ...p, trackIds: [...(u?.state.likedTracks.keys() ?? [])] }
    : { ...p, trackIds: [...p.trackIds] };
}

const userPlaylistOut = (p: StoredPlaylist): Playlist => ({
  id: p.id,
  name: p.name,
  kind: "user",
  // Hide ids we cannot resolve (e.g. a Jamendo track whose snapshot was lost).
  trackIds: p.trackIds.filter((id) => trackIndex.has(id)),
  description: p.description ?? "",
  shareId: p.shareId ?? null,
});

export async function listPlaylists(u: Viewer): Promise<Playlist[]> {
  await fillPlaylistsFromJamendo();
  return [...playlists.map((p) => resolvePlaylist(p, u)), ...(u?.state.playlists ?? []).map(userPlaylistOut)];
}

export async function getPlaylist(id: string, u: Viewer): Promise<Playlist | undefined> {
  await fillPlaylistsFromJamendo();
  const p = playlists.find((x) => x.id === id);
  if (p) return resolvePlaylist(p, u);
  const own = u?.state.playlists.find((x) => x.id === id);
  return own && userPlaylistOut(own);
}

export function playlistTracks(p: Playlist, u: Viewer): Track[] {
  return tracksByIds(p.trackIds, u);
}

export const MAX_PLAYLISTS = 200;
export const MAX_PLAYLIST_TRACKS = 1000;

/** Expected failures the routes turn into HTTP status codes. */
export class UserError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 502,
    message: string
  ) {
    super(message);
  }
}

function findUserPlaylist(u: UserDoc, id: string): StoredPlaylist {
  const own = u.state.playlists.find((x) => x.id === id);
  if (own) return own;
  const builtin = playlists.find((x) => x.id === id);
  if (builtin) throw new UserError(403, `Playlist "${builtin.name}" is read-only`);
  throw new UserError(404, "Playlist not found");
}

export async function createPlaylist(u: UserDoc, name: string, trackIds: string[]): Promise<Playlist> {
  if (u.state.playlists.length >= MAX_PLAYLISTS) {
    throw new UserError(409, `You can have at most ${MAX_PLAYLISTS} playlists`);
  }
  const ids = [...new Set(trackIds)];
  for (const id of ids) if (!(await getTrack(id, null))) throw new UserError(400, `Unknown track id "${id}"`);
  const now = new Date().toISOString();
  const p: StoredPlaylist = { id: `u-${randomUUID().slice(0, 8)}`, name, trackIds: ids, createdAt: now, updatedAt: now };
  ids.forEach((id) => snapshotTrack(u, id));
  u.savePlaylist(p);
  return userPlaylistOut(p);
}

/** Renames and/or changes the description ("" clears it). */
export function updatePlaylist(u: UserDoc, id: string, changes: { name?: string; description?: string }): Playlist {
  const p = findUserPlaylist(u, id);
  if (changes.name !== undefined) p.name = changes.name;
  if (changes.description !== undefined) {
    if (changes.description) p.description = changes.description;
    else delete p.description;
  }
  p.updatedAt = new Date().toISOString();
  u.savePlaylist(p);
  return userPlaylistOut(p);
}

export async function deletePlaylist(u: UserDoc, id: string): Promise<void> {
  const p = findUserPlaylist(u, id);
  if (p.shareId) await userStore().removeShare(p.shareId);
  u.removePlaylist(id);
}

/**
 * New track order. `trackIds` must list exactly the playlist's (visible) tracks — otherwise the
 * client is out of date (409). Ids hidden from the client (unresolvable) keep their place at the end.
 */
export function reorderPlaylist(u: UserDoc, id: string, trackIds: string[]): Playlist {
  const p = findUserPlaylist(u, id);
  const visible = p.trackIds.filter((t) => trackIndex.has(t));
  const hidden = p.trackIds.filter((t) => !trackIndex.has(t));
  const same =
    trackIds.length === visible.length && new Set(trackIds).size === trackIds.length && trackIds.every((t) => visible.includes(t));
  if (!same) throw new UserError(409, "The new order must list exactly the playlist's current tracks (reload and try again)");
  p.trackIds = [...trackIds, ...hidden];
  p.updatedAt = new Date().toISOString();
  u.savePlaylist(p);
  return userPlaylistOut(p);
}

/** Turns the public link on (idempotent: an existing link is kept). */
export async function sharePlaylist(u: UserDoc, id: string): Promise<Playlist> {
  const p = findUserPlaylist(u, id);
  if (!p.shareId) {
    const shareId = randomBytes(9).toString("base64url"); // 12 URL-safe chars
    await userStore().putShare(shareId, u.uid, p.id);
    p.shareId = shareId;
    p.updatedAt = new Date().toISOString();
    u.savePlaylist(p);
  }
  return userPlaylistOut(p);
}

/** Turns the public link off: the old link answers 404 from now on. */
export async function unsharePlaylist(u: UserDoc, id: string): Promise<Playlist> {
  const p = findUserPlaylist(u, id);
  if (p.shareId) {
    const old = p.shareId;
    delete p.shareId;
    p.updatedAt = new Date().toISOString();
    u.savePlaylist(p);
    await userStore().removeShare(old);
  }
  return userPlaylistOut(p);
}

/** GET /api/shared/:shareId — read-only view for anyone (guests included). */
export async function getSharedPlaylist(shareId: string, viewer: Viewer): Promise<SharedPlaylist | undefined> {
  const found = await userStore().resolveShare(shareId);
  if (!found) return undefined;
  const { doc, playlist } = found;
  const tracks = tracksByIds(playlist.trackIds, viewer);
  const mine = viewer?.uid === doc.uid;
  return {
    shareId,
    name: playlist.name,
    description: playlist.description ?? null,
    ownerName: doc.state.profile?.displayName ?? null,
    ownedByYou: mine,
    playlistId: mine ? playlist.id : null,
    trackIds: tracks.map((t) => t.id),
    tracks,
    updatedAt: playlist.updatedAt,
  };
}

/** Adds a track (no-op if already there). On Favourites this likes the track. */
export async function addTrackToPlaylist(u: UserDoc, id: string, trackId: string): Promise<Playlist> {
  if (id === FAVOURITES_ID) {
    if (!(await setTrackLike(u, trackId, true))) throw new UserError(404, "Track not found");
    return (await getPlaylist(id, u))!;
  }
  const p = findUserPlaylist(u, id);
  if (!(await getTrack(trackId, null))) throw new UserError(404, "Track not found");
  if (!p.trackIds.includes(trackId)) {
    if (p.trackIds.length >= MAX_PLAYLIST_TRACKS) throw new UserError(409, "This playlist is full");
    p.trackIds.push(trackId);
    p.updatedAt = new Date().toISOString();
    snapshotTrack(u, trackId);
    u.savePlaylist(p);
  }
  return userPlaylistOut(p);
}

/** Removes a track. On Favourites this unlikes it. 404 if the track is not in the playlist. */
export async function removeTrackFromPlaylist(u: UserDoc, id: string, trackId: string): Promise<Playlist> {
  if (id === FAVOURITES_ID) {
    if (!trackLiked(trackId, u)) throw new UserError(404, "Track is not in this playlist");
    await setTrackLike(u, trackId, false);
    return (await getPlaylist(id, u))!;
  }
  const p = findUserPlaylist(u, id);
  if (!p.trackIds.includes(trackId)) throw new UserError(404, "Track is not in this playlist");
  p.trackIds = p.trackIds.filter((x) => x !== trackId);
  p.updatedAt = new Date().toISOString();
  u.savePlaylist(p);
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
export async function reportPlay(
  u: UserDoc,
  trackId: string,
  seconds: number,
  entryId?: string
): Promise<HistoryEntry | undefined> {
  const track = await getTrack(trackId, null);
  if (!track) return undefined;
  const s = clampSeconds(seconds, track);
  if (entryId) {
    // Updates hit recent entries: search from the end.
    const h = u.state.history;
    let existing: HistoryEntry | undefined;
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].id === entryId) {
        existing = h[i];
        break;
      }
    }
    if (existing && existing.trackId === trackId) {
      if (s > existing.seconds) u.setHistorySeconds(existing, s);
      return existing;
    }
  }
  const entry: HistoryEntry = { id: randomUUID(), trackId, playedAt: new Date().toISOString(), seconds: s };
  snapshotTrack(u, trackId);
  u.addHistory(entry);
  return entry;
}

/** Newest first. Entries whose track can no longer be resolved are skipped. */
export function listHistory(u: UserDoc, limit: number): HistoryItem[] {
  const out: HistoryItem[] = [];
  const history = u.state.history;
  for (let i = history.length - 1; i >= 0 && out.length < limit; i--) {
    const h = history[i];
    const t = trackIndex.get(h.trackId);
    if (t) out.push({ ...h, track: withLike(t, u) });
  }
  return out;
}

export function clearHistory(u: UserDoc): number {
  return u.clearHistory();
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Tally = { plays: number; seconds: number };

export function listeningStats(u: UserDoc): ListeningStats {
  const byTrack = new Map<string, Tally>();
  const byArtist = new Map<string, Tally>();
  const artistIds = new Map<string, string>();
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
  const history = u.state.history;
  for (const h of history) {
    totalSeconds += h.seconds;
    bump(byTrack, h.trackId, h.seconds);
    const t = trackIndex.get(h.trackId);
    if (t) {
      bump(byArtist, t.artist, h.seconds);
      if (t.artistId && !artistIds.has(t.artist)) artistIds.set(t.artist, t.artistId);
    }
    const day = localDate(new Date(h.playedAt));
    if (days.has(day)) bump(days, day, h.seconds);
  }
  const rank = (a: Tally, b: Tally) => b.plays - a.plays || b.seconds - a.seconds;
  const topTracks: ListeningStats["topTracks"] = [];
  for (const [id, v] of [...byTrack].sort((a, b) => rank(a[1], b[1]))) {
    const t = trackIndex.get(id);
    if (t) topTracks.push({ track: withLike(t, u), ...v });
    if (topTracks.length === 10) break;
  }
  return {
    totalSeconds,
    plays: history.length,
    uniqueTracks: byTrack.size,
    uniqueArtists: byArtist.size,
    likedTracks: u.state.likedTracks.size,
    likedAlbums: u.state.likedAlbums.size,
    firstPlayedAt: history[0]?.playedAt ?? null,
    topTracks,
    topArtists: [...byArtist]
      .sort((a, b) => rank(a[1], b[1]))
      .slice(0, 10)
      .map(([artist, v]) => ({ artist, artistId: artistIds.get(artist) ?? null, ...v })),
    last7Days: [...days].map(([date, v]) => ({ date, ...v })),
  };
}

/** Home statistics tiles: real listening time, likes and distinct tracks of this listener. */
export function computeStats(u: UserDoc): Stats {
  let totalSeconds = 0;
  const distinct = new Set<string>();
  for (const h of u.state.history) {
    totalSeconds += h.seconds;
    distinct.add(h.trackId);
  }
  return {
    totalSeconds,
    likes: u.state.likedTracks.size + u.state.likedAlbums.size,
    tracks: distinct.size,
    plays: u.state.history.length,
  };
}

/** Every album for the "Albums of the Week" page: this week's picks first, then more popular ones. */
export async function allWeekAlbums(u: Viewer): Promise<AlbumWithTracks[]> {
  const list = await fromJamendo(
    "Albums of the week (all)",
    async () => {
      const all = await popularAlbums();
      const day = all[dayNumber() % Math.min(all.length, 5)];
      return all.filter((a) => a.id !== day.id);
    },
    () => {
      const rest = seedAlbums.filter((a) => a.id !== seedDayId && !seedWeekIds.includes(a.id)).map((a) => a.id);
      return [...seedWeekIds, ...rest].map((id) => withTracks(albumIndex.get(id)!, null));
    }
  );
  return likeAlbums(list, u);
}
