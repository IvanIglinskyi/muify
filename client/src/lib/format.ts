/** 223 -> "3:43" */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 14220 -> "3hours 57minutes" (matches the mockup's compact style) */
export function formatLongDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}hours ${m}minutes` : `${m}minutes`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
