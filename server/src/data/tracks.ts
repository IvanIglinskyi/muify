import type { Track } from "../types.js";

// In-memory track catalogue (resets on server restart). All artists are fictional.
export const tracks: Track[] = [
  { id: "t1", title: "Let me free", artist: "MaDk", album: "Never Enough", duration: 223, liked: true, genres: ["electronic", "energy", "workout"], plays: 912_400 },
  { id: "t2", title: "Be Happy", artist: "Kathryn", album: "Surrender", duration: 323, liked: true, genres: ["pop", "party"], plays: 1_204_800 },
  { id: "t3", title: "Set me Again", artist: "Julie", album: "101", duration: 381, liked: false, genres: ["pop", "romance"], plays: 486_100 },
  { id: "t4", title: "I am trust", artist: "Tanya", album: "Killer of the Silence", duration: 134, liked: false, genres: ["rock", "energy", "workout"], plays: 377_950 },
  { id: "t5", title: "Skyfall", artist: "Dianne", album: "Monday Off", duration: 190, liked: true, genres: ["pop", "melancholy"], plays: 1_530_200 },
  { id: "t6", title: "Rest easy", artist: "Jane", album: "Never Enough", duration: 205, liked: false, genres: ["acoustic", "chill"], plays: 268_400 },
  { id: "t7", title: "Broke again", artist: "Eli", album: "Paper Moons", duration: 232, liked: false, genres: ["hip-hop", "melancholy"], plays: 742_300 },
  { id: "t8", title: "Golden Hour Drive", artist: "Nova Reyes", album: "Heaven", duration: 247, liked: false, genres: ["electronic", "chill"], plays: 655_000 },
  { id: "t9", title: "Above the Clouds", artist: "Anthony", album: "Heaven", duration: 278, liked: false, genres: ["electronic", "focus", "chill"], plays: 998_700 },
  { id: "t10", title: "Silver Lining", artist: "Anthony", album: "Heaven", duration: 214, liked: true, genres: ["acoustic", "focus"], plays: 563_900 },
  { id: "t11", title: "Slow Motion", artist: "Marko", album: "Slow dance", duration: 256, liked: false, genres: ["jazz", "romance"], plays: 311_200 },
  { id: "t12", title: "Petrichor", artist: "Pirlo", album: "Rain", duration: 199, liked: false, genres: ["lo-fi", "chill", "focus"], plays: 829_600 },
  { id: "t13", title: "Sunday Table", artist: "Harlow Finch", album: "Family time", duration: 241, liked: false, genres: ["acoustic", "chill"], plays: 204_750 },
  { id: "t14", title: "Forever Twenty", artist: "Juno Vale", album: "Getting young", duration: 186, liked: false, genres: ["pop", "party", "energy"], plays: 1_087_300 },
  { id: "t15", title: "Midnight Bloom", artist: "Kathryn", album: "Surrender", duration: 228, liked: false, genres: ["jazz", "romance", "melancholy"], plays: 433_800 },

  // New releases
  { id: "t16", title: "Tidal Pulse", artist: "Coral Static", album: "Neon Tides", duration: 212, liked: false, genres: ["electronic", "party", "energy"], plays: 1_412_000 },
  { id: "t17", title: "Glass Arcade", artist: "Coral Static", album: "Neon Tides", duration: 239, liked: false, genres: ["electronic", "party"], plays: 873_500 },
  { id: "t18", title: "Afterglow Run", artist: "Coral Static", album: "Neon Tides", duration: 201, liked: false, genres: ["electronic", "workout", "energy"], plays: 690_250 },
  { id: "t19", title: "Lantern Song", artist: "Mira Solenne", album: "Paper Lanterns", duration: 244, liked: false, genres: ["acoustic", "chill", "romance"], plays: 515_400 },
  { id: "t20", title: "Quiet Harbour", artist: "Mira Solenne", album: "Paper Lanterns", duration: 263, liked: false, genres: ["acoustic", "chill", "focus"], plays: 402_900 },
  { id: "t21", title: "Ink & Ember", artist: "Mira Solenne", album: "Paper Lanterns", duration: 218, liked: false, genres: ["acoustic", "melancholy"], plays: 287_600 },
  { id: "t22", title: "Block Bloom", artist: "Rook & Ivy", album: "Concrete Garden", duration: 196, liked: false, genres: ["hip-hop", "energy", "workout"], plays: 1_356_900 },
  { id: "t23", title: "Steel Petals", artist: "Rook & Ivy", album: "Concrete Garden", duration: 207, liked: false, genres: ["hip-hop", "party"], plays: 964_100 },
  { id: "t24", title: "Ninety Floors", artist: "Rook & Ivy", album: "Concrete Garden", duration: 228, liked: false, genres: ["hip-hop", "melancholy"], plays: 611_700 },
  { id: "t25", title: "Blue Hour", artist: "Velvet Static Trio", album: "Blue Hour Sessions", duration: 312, liked: false, genres: ["jazz", "chill", "romance"], plays: 345_800 },
  { id: "t26", title: "Smoke Rings", artist: "Velvet Static Trio", album: "Blue Hour Sessions", duration: 287, liked: false, genres: ["jazz", "focus"], plays: 219_300 },
  { id: "t27", title: "Late Tram", artist: "Velvet Static Trio", album: "Blue Hour Sessions", duration: 254, liked: false, genres: ["jazz", "melancholy", "chill"], plays: 198_450 },
  { id: "t28", title: "Static Hearts", artist: "Lumen Drive", album: "Static Hearts", duration: 231, liked: false, genres: ["rock", "energy"], plays: 1_118_600 },
  { id: "t29", title: "Overpass", artist: "Lumen Drive", album: "Static Hearts", duration: 249, liked: false, genres: ["rock", "melancholy"], plays: 578_200 },
  { id: "t30", title: "Burn Slow", artist: "Lumen Drive", album: "Static Hearts", duration: 276, liked: false, genres: ["rock", "workout", "energy"], plays: 801_900 },
  { id: "t31", title: "Rainy Window", artist: "Pillow Theory", album: "Study Loops Vol. 3", duration: 168, liked: false, genres: ["lo-fi", "focus", "chill"], plays: 1_265_300 },
  { id: "t32", title: "Cold Coffee", artist: "Pillow Theory", album: "Study Loops Vol. 3", duration: 154, liked: false, genres: ["lo-fi", "focus"], plays: 934_700 },
  { id: "t33", title: "Notebook Margins", artist: "Pillow Theory", album: "Study Loops Vol. 3", duration: 177, liked: false, genres: ["lo-fi", "chill"], plays: 702_100 },
  { id: "t34", title: "Sugar Rush", artist: "Tessa Bloom", album: "Sugar Rush", duration: 189, liked: false, genres: ["pop", "party", "energy"], plays: 1_689_400 },
  { id: "t35", title: "Polaroid Kiss", artist: "Tessa Bloom", album: "Sugar Rush", duration: 203, liked: false, genres: ["pop", "romance"], plays: 1_021_500 },
  { id: "t36", title: "Dance It Off", artist: "Tessa Bloom", album: "Sugar Rush", duration: 197, liked: false, genres: ["pop", "party", "workout"], plays: 846_300 },
  { id: "t37", title: "Low Light", artist: "Sable Moore", album: "Low Light", duration: 258, liked: false, genres: ["acoustic", "melancholy", "romance"], plays: 377_100 },
  { id: "t38", title: "Letters Unsent", artist: "Sable Moore", album: "Low Light", duration: 241, liked: false, genres: ["acoustic", "melancholy"], plays: 254_900 },
  { id: "t39", title: "Northbound", artist: "Sable Moore", album: "Low Light", duration: 266, liked: false, genres: ["acoustic", "chill", "focus"], plays: 189_600 },
  { id: "t40", title: "Morning Ritual", artist: "Pillow Theory", album: "Study Loops Vol. 3", duration: 162, liked: false, genres: ["lo-fi", "chill", "focus"], plays: 588_800 },
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
