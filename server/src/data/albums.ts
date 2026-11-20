import type { Album } from "../types.js";
import { tracksByIds } from "./tracks.js";

export const albumOfTheDayId = "a-heaven";

type AlbumDef = Omit<Album, "source">;
type NewAlbum = Omit<AlbumDef, "trackCount" | "duration" | "year">;

/** Albums whose track list is fully in the catalogue: counts are derived from the tracks. */
function release(a: NewAlbum): AlbumDef {
  const list = tracksByIds(a.trackIds);
  return {
    ...a,
    year: Number(a.releaseDate.slice(0, 4)),
    trackCount: list.length,
    duration: list.reduce((sum, t) => sum + t.duration, 0),
  };
}

const seedDefs: AlbumDef[] = [
  {
    id: "a-heaven",
    title: "Heaven",
    artist: "Anthony",
    year: 2024,
    releaseDate: "2024-03-08",
    genres: ["electronic", "acoustic", "chill", "focus"],
    trackCount: 29,
    duration: 3 * 3600 + 57 * 60,
    liked: false,
    trackIds: ["t9", "t8", "t10"],
  },
  {
    id: "a-slow-dance",
    title: "Slow dance",
    artist: "Marko",
    year: 2024,
    releaseDate: "2024-05-17",
    genres: ["jazz", "pop", "romance"],
    trackCount: 12,
    duration: 48 * 60,
    liked: false,
    trackIds: ["t11", "t3"],
  },
  {
    id: "a-rain",
    title: "Rain",
    artist: "Pirlo",
    year: 2024,
    releaseDate: "2024-09-27",
    genres: ["lo-fi", "acoustic", "chill", "focus"],
    trackCount: 10,
    duration: 41 * 60,
    liked: false,
    trackIds: ["t12", "t6"],
  },
  {
    id: "a-family-time",
    title: "Family time",
    artist: "Harlow Finch",
    year: 2024,
    releaseDate: "2024-11-22",
    genres: ["acoustic", "pop", "chill", "party"],
    trackCount: 14,
    duration: 55 * 60,
    liked: false,
    trackIds: ["t13", "t2"],
  },
  {
    id: "a-getting-young",
    title: "Getting young",
    artist: "Juno Vale",
    year: 2024,
    releaseDate: "2024-12-13",
    genres: ["pop", "party", "energy", "melancholy"],
    trackCount: 9,
    duration: 36 * 60,
    liked: false,
    trackIds: ["t14", "t5"],
  },

  // New releases (fictional artists)
  release({
    id: "a-neon-tides",
    title: "Neon Tides",
    artist: "Coral Static",
    releaseDate: "2026-11-14",
    genres: ["electronic", "party", "energy", "workout"],
    liked: false,
    trackIds: ["t16", "t17", "t18"],
  }),
  release({
    id: "a-paper-lanterns",
    title: "Paper Lanterns",
    artist: "Mira Solenne",
    releaseDate: "2026-11-07",
    genres: ["acoustic", "chill", "romance", "focus", "melancholy"],
    liked: false,
    trackIds: ["t19", "t20", "t21"],
  }),
  release({
    id: "a-concrete-garden",
    title: "Concrete Garden",
    artist: "Rook & Ivy",
    releaseDate: "2026-10-31",
    genres: ["hip-hop", "energy", "workout", "party", "melancholy"],
    liked: false,
    trackIds: ["t22", "t23", "t24"],
  }),
  release({
    id: "a-blue-hour",
    title: "Blue Hour Sessions",
    artist: "Velvet Static Trio",
    releaseDate: "2026-10-24",
    genres: ["jazz", "chill", "romance", "focus", "melancholy"],
    liked: false,
    trackIds: ["t25", "t26", "t27"],
  }),
  release({
    id: "a-static-hearts",
    title: "Static Hearts",
    artist: "Lumen Drive",
    releaseDate: "2026-10-17",
    genres: ["rock", "energy", "workout", "melancholy"],
    liked: false,
    trackIds: ["t28", "t29", "t30"],
  }),
  release({
    id: "a-study-loops",
    title: "Study Loops Vol. 3",
    artist: "Pillow Theory",
    releaseDate: "2026-10-03",
    genres: ["lo-fi", "focus", "chill"],
    liked: false,
    trackIds: ["t31", "t32", "t33", "t40"],
  }),
  release({
    id: "a-sugar-rush",
    title: "Sugar Rush",
    artist: "Tessa Bloom",
    releaseDate: "2026-09-19",
    genres: ["pop", "party", "energy", "romance", "workout"],
    liked: false,
    trackIds: ["t34", "t35", "t36"],
  }),
  release({
    id: "a-low-light",
    title: "Low Light",
    artist: "Sable Moore",
    releaseDate: "2026-09-05",
    genres: ["acoustic", "melancholy", "romance", "chill", "focus"],
    liked: false,
    trackIds: ["t37", "t38", "t39"],
  }),
];

/** Seed catalogue, used when Jamendo is not configured or unavailable. */
export const albums: Album[] = seedDefs.map((a) => ({ ...a, source: "seed" }));

export const weekAlbumIds = ["a-slow-dance", "a-rain", "a-family-time", "a-getting-young"];

export function findAlbum(id: string): Album | undefined {
  return albums.find((a) => a.id === id);
}
