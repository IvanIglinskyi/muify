import type { Playlist } from "../types.js";

export const playlists: Playlist[] = [
  { id: "p-favourites", name: "Favourites", icon: "heart", trackIds: [] },
  { id: "p-gym", name: "Gym mix", trackIds: ["t1", "t4", "t12"] },
  { id: "p-pre-party", name: "Pre-party", trackIds: ["t2", "t5", "t14"] },
  { id: "p-reading", name: "Reading music", trackIds: ["t6", "t9", "t13"] },
  { id: "p-meditation", name: "Meditation", trackIds: ["t10", "t11"] },
  { id: "p-walk", name: "For a Walk mix", trackIds: ["t3", "t7", "t8", "t15"] },
];

// Base counters for the statistics block; likes are added on top of the live liked count.
export const statsBase = {
  totalHours: 1450,
  likesFromOtherContent: 417,
  tracks: 2523,
};
