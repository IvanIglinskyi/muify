import type { JamendoMusicInfo } from "./types.js";

/**
 * How each of our genre/mood ids (see data/genres.ts) is queried on Jamendo /tracks.
 * - `tags`: AND-match on Jamendo tags; `fuzzytags`: OR-match (best matches first);
 * - `speed`, `acousticelectric`, `vocalinstrumental`: Jamendo's own musicinfo filters.
 * Multi-value params are space-separated (URLSearchParams encodes them as "+").
 */
export interface JamendoGenreQuery {
  tags?: string;
  fuzzytags?: string;
  speed?: string;
  acousticelectric?: "acoustic" | "electric";
  vocalinstrumental?: "vocal" | "instrumental";
}

interface GenreMapping {
  query: JamendoGenreQuery;
  /** Jamendo tags (genres / vartags / instruments) that put a track into this genre. */
  matchTags: string[];
  match?: (info: JamendoMusicInfo) => boolean;
}

const fast = (i: JamendoMusicInfo) => i.speed === "high" || i.speed === "veryhigh";

export const genreMappings: Record<string, GenreMapping> = {
  pop: { query: { tags: "pop" }, matchTags: ["pop"] },
  electronic: { query: { tags: "electronic" }, matchTags: ["electronic", "electro", "techno", "house", "edm", "synthpop"] },
  rock: { query: { tags: "rock" }, matchTags: ["rock", "punk", "metal", "indie", "grunge"] },
  "hip-hop": { query: { tags: "hiphop" }, matchTags: ["hiphop", "hip-hop", "rap", "trap"] },
  jazz: { query: { tags: "jazz" }, matchTags: ["jazz", "swing", "bossanova"] },
  "lo-fi": { query: { fuzzytags: "lofi chillhop" }, matchTags: ["lofi", "lo-fi", "chillhop"] },
  acoustic: {
    query: { acousticelectric: "acoustic" },
    matchTags: ["acoustic", "folk", "songwriter"],
    match: (i) => i.acousticelectric === "acoustic",
  },
  chill: { query: { fuzzytags: "chillout relaxation lounge" }, matchTags: ["chillout", "relaxation", "lounge", "calm", "relaxing"] },
  energy: { query: { speed: "high veryhigh" }, matchTags: ["energetic", "powerful"], match: fast },
  focus: {
    query: { vocalinstrumental: "instrumental", fuzzytags: "ambient piano classical" },
    matchTags: ["ambient", "classical", "study"],
  },
  party: { query: { fuzzytags: "party dance" }, matchTags: ["party", "dance", "disco", "club"] },
  romance: { query: { fuzzytags: "love romantic" }, matchTags: ["love", "romantic", "romance"] },
  melancholy: { query: { fuzzytags: "sad melancholic" }, matchTags: ["sad", "melancholic", "melancholy", "nostalgic"] },
  workout: {
    query: { fuzzytags: "sport workout motivational", speed: "high veryhigh" },
    matchTags: ["sport", "workout", "motivational", "fitness"],
  },
};

/** Our genre ids for a Jamendo track, derived from its musicinfo (include=musicinfo). */
export function genresFromMusicInfo(info: JamendoMusicInfo | undefined): string[] {
  if (!info) return [];
  const tags = new Set(
    [...(info.tags?.genres ?? []), ...(info.tags?.vartags ?? []), ...(info.tags?.instruments ?? [])].map((t) =>
      t.toLowerCase()
    )
  );
  return Object.entries(genreMappings)
    .filter(([, m]) => m.matchTags.some((t) => tags.has(t)) || (m.match?.(info) ?? false))
    .map(([id]) => id);
}
