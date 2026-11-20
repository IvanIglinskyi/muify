import type { Playlist } from "../types.js";

export const playlists: Playlist[] = [
  { id: "p-favourites", name: "Favourites", icon: "heart", kind: "favourites", trackIds: [] },
  { id: "p-gym", name: "Gym mix", kind: "builtin", trackIds: ["t1", "t4", "t12"] },
  { id: "p-pre-party", name: "Pre-party", kind: "builtin", trackIds: ["t2", "t5", "t14"] },
  { id: "p-reading", name: "Reading music", kind: "builtin", trackIds: ["t6", "t9", "t13"] },
  { id: "p-meditation", name: "Meditation", kind: "builtin", trackIds: ["t10", "t11"] },
  { id: "p-walk", name: "For a Walk mix", kind: "builtin", trackIds: ["t3", "t7", "t8", "t15"] },
];
