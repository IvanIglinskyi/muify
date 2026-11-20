// Sleep timer + playback speed helpers (pure: no React, no DOM) — unit-tested.

export type SleepTimer =
  /** Stop `minutes` after it was set (wall-clock, also while paused). */
  | { kind: "minutes"; minutes: number; endsAt: number }
  /** Stop when the current track ends. */
  | { kind: "end-of-track" };

export const SLEEP_MINUTES = [15, 30, 45, 60] as const;
/** The volume fades out over the last this-many milliseconds. */
export const SLEEP_FADE_MS = 10_000;

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5] as const;
export const MIN_RATE = 0.75;
export const MAX_RATE = 1.5;

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate * 100) / 100));
}

export function startSleepTimer(minutes: number, now: number): SleepTimer {
  return { kind: "minutes", minutes, endsAt: now + minutes * 60_000 };
}

/**
 * Milliseconds until the timer stops playback. For "end of track" that is the rest of the track
 * at the current speed. `null` = no timer, or the length of the track isn't known.
 */
export function sleepRemainingMs(
  timer: SleepTimer | null,
  now: number,
  track: { position: number; duration: number; rate?: number }
): number | null {
  if (!timer) return null;
  if (timer.kind === "minutes") return Math.max(0, timer.endsAt - now);
  if (!(track.duration > 0)) return null;
  const rate = track.rate && track.rate > 0 ? track.rate : 1;
  return Math.max(0, ((track.duration - track.position) * 1000) / rate);
}

/** Volume multiplier 1 → 0 over the last SLEEP_FADE_MS (1 without a timer). */
export function sleepFadeFactor(remainingMs: number | null, fadeMs = SLEEP_FADE_MS): number {
  if (remainingMs === null) return 1;
  if (remainingMs >= fadeMs) return 1;
  return Math.max(0, remainingMs / fadeMs);
}

/** A minutes timer that has run out (end-of-track timers end with the track instead). */
export function sleepExpired(timer: SleepTimer | null, now: number): boolean {
  return timer?.kind === "minutes" && now >= timer.endsAt;
}

/** 754000 → "12:34", 3600000 → "1:00:00" (rounded up: "0:01" until the very end). */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
