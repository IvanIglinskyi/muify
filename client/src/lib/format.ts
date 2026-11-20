// Number / duration / date formatting in the current UI language (see i18n/core.ts).
import { formatNumberIn, getLang, LOCALES, tt, type Lang } from "../i18n/core";

/** 223 -> "3:43" */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 14220 -> "3hours 57minutes" (the mockup's compact style) / "3 год 57 хв". */
export function formatLongDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h > 0 ? tt("duration.long.hm", { h, m }) : tt("duration.long.m", { m });
}

/** 3725 -> "1h 2m", 95 -> "1m 35s", 0 -> "0s" (listening time). */
export function formatListening(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return tt("duration.short.hm", { h, m });
  if (m > 0) return s % 60 && m < 10 ? tt("duration.short.ms", { m, s: s % 60 }) : tt("duration.short.m", { m });
  return tt("duration.short.s", { s });
}

/** Home "Total Time" tile: 12000 -> "3 h 20 min", 1500 -> "25 min", 30 -> "<1 min", 0 -> "0 min". */
export function formatHoursMinutes(totalSeconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  if (s === 0) return tt("duration.tile.m", { m: 0 });
  if (s < 60) return tt("duration.tile.lessThanMinute");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return tt("duration.tile.m", { m });
  if (m === 0) return tt("duration.tile.h", { h });
  return tt("duration.tile.hm", { h, m });
}

export function formatNumber(n: number, lang: Lang = getLang()): string {
  return formatNumberIn(lang, n);
}

const rtfs = new Map<Lang, Intl.RelativeTimeFormat>();
function rtf(lang: Lang) {
  let f = rtfs.get(lang);
  if (!f) {
    f = new Intl.RelativeTimeFormat(LOCALES[lang], { numeric: "auto" });
    rtfs.set(lang, f);
  }
  return f;
}

/** "12 Mar 2024" / "12 бер. 2024 р." */
export function formatDate(iso: string | number | Date, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(LOCALES[getLang()], opts);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(LOCALES[getLang()]) : "";
}

/** ISO date -> "just now", "5 minutes ago", "yesterday", or a date for older events. */
export function formatRelative(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const lang = getLang();
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return tt("time.justNow");
  if (abs < 3600) return rtf(lang).format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf(lang).format(Math.round(diff / 3600), "hour");
  if (abs < 7 * 86_400) return rtf(lang).format(Math.round(diff / 86_400), "day");
  return formatDate(t);
}

/** Short weekday of a YYYY-MM-DD date ("Mon" / "пн"). */
export function formatWeekday(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(LOCALES[getLang()], { weekday: "short" });
}
