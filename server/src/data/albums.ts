import type { Album } from "../types.js";

export const albumOfTheDayId = "a-heaven";

export const albums: Album[] = [
  {
    id: "a-heaven",
    title: "Heaven",
    artist: "Anthony",
    year: 2024,
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
    trackCount: 9,
    duration: 36 * 60,
    liked: false,
    trackIds: ["t14", "t5"],
  },
];

export const weekAlbumIds = ["a-slow-dance", "a-rain", "a-family-time", "a-getting-young"];

export function findAlbum(id: string): Album | undefined {
  return albums.find((a) => a.id === id);
}
