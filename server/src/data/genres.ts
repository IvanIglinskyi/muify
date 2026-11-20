import type { GenreKind } from "../types.js";

export interface GenreDef {
  id: string;
  name: string;
  kind: GenreKind;
}

/** Genres and moods shown as tiles on the Explore page. Tracks/albums reference these ids. */
export const genreDefs: GenreDef[] = [
  { id: "pop", name: "Pop", kind: "genre" },
  { id: "electronic", name: "Electronic", kind: "genre" },
  { id: "rock", name: "Rock", kind: "genre" },
  { id: "hip-hop", name: "Hip-Hop", kind: "genre" },
  { id: "jazz", name: "Jazz", kind: "genre" },
  { id: "lo-fi", name: "Lo-Fi", kind: "genre" },
  { id: "acoustic", name: "Acoustic", kind: "genre" },
  { id: "chill", name: "Chill", kind: "mood" },
  { id: "energy", name: "Energy", kind: "mood" },
  { id: "focus", name: "Focus", kind: "mood" },
  { id: "party", name: "Party", kind: "mood" },
  { id: "romance", name: "Romance", kind: "mood" },
  { id: "melancholy", name: "Melancholy", kind: "mood" },
  { id: "workout", name: "Workout", kind: "mood" },
];

export function findGenre(id: string): GenreDef | undefined {
  return genreDefs.find((g) => g.id === id);
}
