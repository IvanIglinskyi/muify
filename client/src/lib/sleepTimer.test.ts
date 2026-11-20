import { describe, expect, it } from "vitest";
import {
  clampRate,
  formatRemaining,
  SLEEP_FADE_MS,
  sleepExpired,
  sleepFadeFactor,
  sleepRemainingMs,
  startSleepTimer,
} from "./sleepTimer";

const NOW = 1_000_000;

describe("sleep timer", () => {
  it("minutes timers run on wall-clock time", () => {
    const t = startSleepTimer(15, NOW);
    expect(t).toEqual({ kind: "minutes", minutes: 15, endsAt: NOW + 15 * 60_000 });
    expect(sleepRemainingMs(t, NOW, { position: 0, duration: 0 })).toBe(15 * 60_000);
    expect(sleepRemainingMs(t, NOW + 14 * 60_000, { position: 99, duration: 100 })).toBe(60_000);
    expect(sleepRemainingMs(t, NOW + 16 * 60_000, { position: 0, duration: 0 })).toBe(0);
    expect(sleepExpired(t, NOW + 15 * 60_000 - 1)).toBe(false);
    expect(sleepExpired(t, NOW + 15 * 60_000)).toBe(true);
  });

  it("end-of-track timers follow the track (and the playback speed)", () => {
    const t = { kind: "end-of-track" } as const;
    expect(sleepRemainingMs(t, NOW, { position: 170, duration: 200 })).toBe(30_000);
    expect(sleepRemainingMs(t, NOW, { position: 170, duration: 200, rate: 1.5 })).toBe(20_000);
    expect(sleepRemainingMs(t, NOW, { position: 250, duration: 200 })).toBe(0);
    expect(sleepRemainingMs(t, NOW, { position: 0, duration: 0 })).toBeNull();
    expect(sleepExpired(t, NOW + 10 ** 9)).toBe(false); // ends with the track, not by the clock
  });

  it("no timer → nothing to show, full volume", () => {
    expect(sleepRemainingMs(null, NOW, { position: 0, duration: 100 })).toBeNull();
    expect(sleepFadeFactor(null)).toBe(1);
    expect(sleepExpired(null, NOW)).toBe(false);
  });

  it("fades the volume out over the last 10 seconds", () => {
    expect(SLEEP_FADE_MS).toBe(10_000);
    expect(sleepFadeFactor(60_000)).toBe(1);
    expect(sleepFadeFactor(10_000)).toBe(1);
    expect(sleepFadeFactor(5_000)).toBe(0.5);
    expect(sleepFadeFactor(1_000)).toBeCloseTo(0.1);
    expect(sleepFadeFactor(0)).toBe(0);
    expect(sleepFadeFactor(-5)).toBe(0);
  });

  it("formats the remaining time", () => {
    expect(formatRemaining(754_000)).toBe("12:34");
    expect(formatRemaining(60 * 60_000)).toBe("1:00:00");
    expect(formatRemaining(400)).toBe("0:01");
    expect(formatRemaining(0)).toBe("0:00");
  });
});

describe("playback speed", () => {
  it("is clamped to 0.75–1.5", () => {
    expect(clampRate(1.25)).toBe(1.25);
    expect(clampRate(0.5)).toBe(0.75);
    expect(clampRate(3)).toBe(1.5);
    expect(clampRate(Number.NaN)).toBe(1);
  });
});
