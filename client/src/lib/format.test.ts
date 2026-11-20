import { describe, expect, it } from "vitest";
import { formatHoursMinutes, formatListening, formatLongDuration, formatNumber, formatRelative, formatTime } from "./format";

describe("formatTime", () => {
  it("formats m:ss and clamps negatives", () => {
    expect(formatTime(223)).toBe("3:43");
    expect(formatTime(5.9)).toBe("0:05");
    expect(formatTime(-3)).toBe("0:00");
    expect(formatTime(3600)).toBe("60:00");
  });
});

describe("formatHoursMinutes (Home Total Time tile)", () => {
  it("formats hours and minutes", () => {
    expect(formatHoursMinutes(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
    expect(formatHoursMinutes(3 * 3600 + 20 * 60 + 59)).toBe("3 h 20 min");
    expect(formatHoursMinutes(2 * 3600)).toBe("2 h");
    expect(formatHoursMinutes(25 * 60)).toBe("25 min");
    expect(formatHoursMinutes(1450 * 3600)).toBe("1,450 h");
  });

  it("handles tiny and invalid values", () => {
    expect(formatHoursMinutes(0)).toBe("0 min");
    expect(formatHoursMinutes(30)).toBe("<1 min");
    expect(formatHoursMinutes(-10)).toBe("0 min");
    expect(formatHoursMinutes(Number.NaN)).toBe("0 min");
  });
});

describe("other helpers", () => {
  it("formatLongDuration matches the mockup style", () => {
    expect(formatLongDuration(3 * 3600 + 57 * 60)).toBe("3hours 57minutes");
    expect(formatLongDuration(600)).toBe("10minutes");
  });

  it("formatListening", () => {
    expect(formatListening(3725)).toBe("1h 2m");
    expect(formatListening(95)).toBe("1m 35s");
    expect(formatListening(0)).toBe("0s");
  });

  it("formatNumber uses thousands separators", () => {
    expect(formatNumber(2523)).toBe("2,523");
  });

  it("formatRelative", () => {
    const now = Date.parse("2026-01-10T12:00:00Z");
    expect(formatRelative("2026-01-10T11:59:50Z", now)).toBe("just now");
    expect(formatRelative("2026-01-10T11:55:00Z", now)).toBe("5 minutes ago");
    expect(formatRelative("2026-01-09T12:00:00Z", now)).toBe("yesterday");
    expect(formatRelative("not a date", now)).toBe("");
  });
});
