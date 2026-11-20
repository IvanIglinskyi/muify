// Pure building blocks of the personalised recommendations (no I/O, easy to test).
//
// A listener's taste profile is a weighted tally of artists and genres taken from their likes and
// their play history. The catalogue (catalog.ts) turns the profile into Jamendo queries or scores
// the seed catalogue with it.
import type { Album, Track } from "./types.js";

export interface WeightedArtist {
  /** Artist page id when known, else `name:<lowercased name>`. */
  key: string;
  id: string | null;
  name: string;
  score: number;
}

export interface TasteProfile {
  artists: WeightedArtist[];
  /** Genre/mood ids, best first. */
  genres: { id: string; score: number }[];
  /** Artists the listener liked (tracks or albums), best first — "Because you liked …". */
  likedArtists: WeightedArtist[];
  /** Number of distinct signals (liked tracks + liked albums + distinct played tracks). */
  signals: number;
}

export interface ProfileInput {
  likedTracks: Track[];
  likedAlbums: Album[];
  /** Plays, oldest first (only the most recent ones are used). */
  plays: { track: Track; seconds: number }[];
}

/** Below this many signals the generic mix is served. */
export const MIN_SIGNALS = 3;
/** Plays older than the last N are ignored (taste drifts). */
const RECENT_PLAYS = 300;

const W = {
  likedTrackArtist: 3,
  likedTrackGenre: 2,
  likedAlbumArtist: 3,
  likedAlbumGenre: 1,
  playArtist: 1,
  shortPlayArtist: 0.4,
  playGenre: 0.5,
};

export const artistKey = (id: string | undefined | null, name: string) => id || `name:${name.trim().toLowerCase()}`;

export function buildProfile({ likedTracks, likedAlbums, plays }: ProfileInput): TasteProfile {
  const artists = new Map<string, WeightedArtist>();
  const liked = new Map<string, WeightedArtist>();
  const genres = new Map<string, number>();

  const bumpArtist = (into: Map<string, WeightedArtist>, id: string | undefined, name: string, w: number) => {
    const key = artistKey(id, name);
    const a = into.get(key) ?? { key, id: id ?? null, name, score: 0 };
    a.score += w;
    into.set(key, a);
  };
  const bumpGenres = (ids: string[], w: number) => {
    for (const g of ids) genres.set(g, (genres.get(g) ?? 0) + w);
  };

  for (const t of likedTracks) {
    bumpArtist(artists, t.artistId, t.artist, W.likedTrackArtist);
    bumpArtist(liked, t.artistId, t.artist, W.likedTrackArtist);
    bumpGenres(t.genres, W.likedTrackGenre);
  }
  for (const a of likedAlbums) {
    bumpArtist(artists, a.artistId, a.artist, W.likedAlbumArtist);
    bumpArtist(liked, a.artistId, a.artist, W.likedAlbumArtist);
    bumpGenres(a.genres, W.likedAlbumGenre);
  }
  const distinctPlayed = new Set<string>();
  for (const { track, seconds } of plays.slice(-RECENT_PLAYS)) {
    distinctPlayed.add(track.id);
    bumpArtist(artists, track.artistId, track.artist, seconds >= 30 ? W.playArtist : W.shortPlayArtist);
    bumpGenres(track.genres, W.playGenre);
  }

  const byScore = (a: { score: number; key?: string; id?: string | null }, b: { score: number; key?: string; id?: string | null }) =>
    b.score - a.score || String(a.key ?? a.id).localeCompare(String(b.key ?? b.id));
  return {
    artists: [...artists.values()].sort(byScore),
    likedArtists: [...liked.values()].sort(byScore),
    genres: [...genres].map(([id, score]) => ({ id, score })).sort(byScore),
    signals: likedTracks.length + likedAlbums.length + distinctPlayed.size,
  };
}

/** Short stable string describing the profile (cache key: changes only when the taste does). */
export function profileSignature(p: TasteProfile): string {
  return [
    p.artists.slice(0, 5).map((a) => a.key).join(","),
    p.genres.slice(0, 3).map((g) => g.id).join(","),
    p.likedArtists.slice(0, 3).map((a) => a.key).join(","),
  ].join("|");
}

/** FNV-1a 32-bit hash: per-user-per-day seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic shuffle seeded by `seed`. */
export function seededShuffle<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed % 0x7fffffff || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** How well a track matches the profile (0 = not at all). */
export function scoreTrack(t: Track, p: TasteProfile): number {
  const key = artistKey(t.artistId, t.artist);
  const nameKey = artistKey(null, t.artist);
  const artist = p.artists.find((a) => a.key === key || artistKey(null, a.name) === nameKey);
  const top = p.genres.slice(0, 5);
  const genre = t.genres.reduce((sum, g) => sum + (top.find((x) => x.id === g)?.score ?? 0), 0);
  return (artist?.score ?? 0) * 2 + genre;
}

/**
 * Picks up to `size` tracks from `candidates`: matching tracks ranked by score (ties broken by
 * the seed), recently played ones excluded, at most `perArtist` per artist; then shuffled with
 * the seed so the order varies per user and day.
 */
export function pickMix(
  candidates: Track[],
  p: TasteProfile,
  opts: { exclude: Set<string>; seed: number; size: number; perArtist?: number }
): Track[] {
  const perArtist = opts.perArtist ?? 3;
  const jitter = new Map(seededShuffle(candidates, opts.seed).map((t, i) => [t.id, i]));
  const ranked = candidates
    .filter((t) => !opts.exclude.has(t.id))
    .map((t) => ({ t, s: scoreTrack(t, p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || jitter.get(a.t.id)! - jitter.get(b.t.id)!);
  const out: Track[] = [];
  const perArtistCount = new Map<string, number>();
  const seen = new Set<string>();
  for (const { t } of ranked) {
    if (out.length >= opts.size) break;
    if (seen.has(t.id)) continue;
    const k = artistKey(t.artistId, t.artist);
    const n = perArtistCount.get(k) ?? 0;
    if (n >= perArtist) continue;
    perArtistCount.set(k, n + 1);
    seen.add(t.id);
    out.push(t);
  }
  return seededShuffle(out, opts.seed);
}

/** Ids of the last `n` distinct tracks played (newest first). */
export function recentlyPlayed(history: { trackId: string }[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = history.length - 1; i >= 0 && out.size < n; i--) out.add(history[i].trackId);
  return out;
}
