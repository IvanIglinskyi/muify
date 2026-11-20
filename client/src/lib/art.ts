// Seeded generative artwork parameters, so every album/track gets a distinct but stable
// cover in the orange / teal / purple palette (no copyrighted images are used).

const PALETTES: [string, string, string][] = [
  ["#0e3b3c", "#2f7a73", "#ff9a1f"],
  ["#1d0f33", "#7b2fa0", "#ff5f9e"],
  ["#2a160c", "#b8560f", "#ffc067"],
  ["#0b2836", "#1d8a8f", "#f2c14e"],
  ["#2b1236", "#9c3fc0", "#ff9a1f"],
  ["#12182e", "#3b5bdb", "#e6497f"],
  ["#1a2a24", "#4f8f6a", "#ffb05c"],
  ["#311015", "#c2384f", "#ffd27a"],
];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string): () => number {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Blob {
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
}

export interface Streak {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
  opacity: number;
}

export interface Artwork {
  palette: [string, string, string];
  angle: number;
  blobs: Blob[];
  streaks: Streak[];
}

export function artworkFor(seed: string): Artwork {
  const rand = rng(seed);
  const palette = PALETTES[hash(seed) % PALETTES.length];
  const colorOrder = [2, 0, 1, 2, 0];
  const blobs: Blob[] = colorOrder.map((ci) => ({
    cx: rand() * 100,
    cy: rand() * 100,
    r: 12 + rand() * 28,
    color: palette[ci],
    opacity: 0.55 + rand() * 0.45,
  }));
  const streaks: Streak[] = Array.from({ length: 5 }, () => {
    const y = rand() * 100;
    return {
      x1: -10,
      y1: y,
      x2: 110,
      y2: y + (rand() - 0.5) * 60,
      width: 0.4 + rand() * 2.2,
      color: rand() > 0.5 ? "#ffffff" : palette[2],
      opacity: 0.08 + rand() * 0.25,
    };
  });
  return { palette, angle: Math.floor(rand() * 360), blobs, streaks };
}
