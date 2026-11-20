import type { Track } from "../types.js";

// In-memory track catalogue (resets on server restart).
export const tracks: Track[] = [
  { id: "t1", title: "Let me free", artist: "MaDk", album: "Never Enough", duration: 223, liked: true },
  { id: "t2", title: "Be Happy", artist: "Kathryn", album: "Surrender", duration: 323, liked: true },
  { id: "t3", title: "Set me Again", artist: "Julie", album: "101", duration: 381, liked: false },
  { id: "t4", title: "I am trust", artist: "Tanya", album: "Killer of the Silence", duration: 134, liked: false },
  { id: "t5", title: "Skyfall", artist: "Dianne", album: "Monday Off", duration: 190, liked: true },
  { id: "t6", title: "Rest easy", artist: "Jane", album: "Never Enough", duration: 205, liked: false },
  { id: "t7", title: "Broke again", artist: "Eli", album: "Paper Moons", duration: 232, liked: false },
  { id: "t8", title: "Golden Hour Drive", artist: "Nova Reyes", album: "Heaven", duration: 247, liked: false },
  { id: "t9", title: "Above the Clouds", artist: "Anthony", album: "Heaven", duration: 278, liked: false },
  { id: "t10", title: "Silver Lining", artist: "Anthony", album: "Heaven", duration: 214, liked: true },
  { id: "t11", title: "Slow Motion", artist: "Marko", album: "Slow dance", duration: 256, liked: false },
  { id: "t12", title: "Petrichor", artist: "Pirlo", album: "Rain", duration: 199, liked: false },
  { id: "t13", title: "Sunday Table", artist: "Harlow Finch", album: "Family time", duration: 241, liked: false },
  { id: "t14", title: "Forever Twenty", artist: "Juno Vale", album: "Getting young", duration: 186, liked: false },
  { id: "t15", title: "Midnight Bloom", artist: "Kathryn", album: "Surrender", duration: 228, liked: false },
];

export function findTrack(id: string): Track | undefined {
  return tracks.find((t) => t.id === id);
}

export function tracksByIds(ids: string[]): Track[] {
  return ids.map(findTrack).filter((t): t is Track => Boolean(t));
}

export const recentTrackIds = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t15", "t9", "t12", "t13"];

/** Where the listener left off last session (restored into the player on load). */
export const lastPlayback = { trackId: "t7", position: 161, queue: recentTrackIds };

export const dailyMixTrackIds = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t11", "t12", "t15"];
