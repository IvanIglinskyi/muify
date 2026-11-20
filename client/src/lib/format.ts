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

/** 3725 -> "1h 2m", 95 -> "1m 35s", 0 -> "0m" (listening time). */
export function formatListening(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return s % 60 && m < 10 ? `${m}m ${s % 60}s` : `${m}m`;
  return `${s}s`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** ISO date -> "just now", "5 minutes ago", "yesterday", or a date for older plays. */
export function formatRelative(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(diff / 86_400), "day");
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
