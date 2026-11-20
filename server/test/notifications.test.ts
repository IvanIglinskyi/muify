// Pure new-release notification rules (no I/O).
import { describe, expect, it } from "vitest";
import {
  CHECK_INTERVAL_MS,
  dayOf,
  newestFirst,
  releaseNotifications,
  shouldCheck,
  welcomeNotification,
  type ReleaseCandidate,
} from "../src/notifications.js";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const DAY = 86_400_000;

const rel = (albumId: string, artistId: string, releaseDate: string, demo = false): ReleaseCandidate => ({
  albumId,
  albumTitle: `Album ${albumId}`,
  artistId,
  artistName: `Artist ${artistId}`,
  releaseDate,
  ...(demo ? { demo: true } : {}),
});

describe("shouldCheck", () => {
  it("never checks without follows", () => {
    expect(shouldCheck(null, [], NOW)).toBe(false);
  });
  it("checks the first time and then at most every interval", () => {
    expect(shouldCheck(null, [NOW - DAY], NOW)).toBe(true);
    expect(shouldCheck(NOW - 60_000, [NOW - DAY], NOW)).toBe(false);
    expect(shouldCheck(NOW - CHECK_INTERVAL_MS + 1000, [NOW - DAY], NOW)).toBe(false);
    expect(shouldCheck(NOW - CHECK_INTERVAL_MS, [NOW - DAY], NOW)).toBe(true);
  });
  it("checks again right after a new follow", () => {
    expect(shouldCheck(NOW - 60_000, [NOW - DAY, NOW - 1000], NOW)).toBe(true);
  });
});

describe("releaseNotifications", () => {
  const follows = new Map([
    ["jr1", { at: Date.parse("2026-11-10T18:30:00Z") }],
    ["jr2", { at: Date.parse("2026-11-19T08:00:00Z") }],
  ]);

  it("keeps releases of followed artists from the follow day on", () => {
    const out = releaseNotifications(
      follows,
      [
        rel("ja10", "jr1", "2026-11-09"), // before the follow
        rel("ja11", "jr1", "2026-11-10"), // same day counts
        rel("ja12", "jr1", "2026-11-18"),
        rel("ja20", "jr2", "2026-11-18"), // before jr2's follow
        rel("ja21", "jr2", "2026-11-20"),
        rel("ja30", "jr3", "2026-11-20"), // not followed
        rel("ja31", "jr1", "not-a-date"),
      ],
      new Set(),
      NOW
    );
    expect(out.map((n) => n.albumId)).toEqual(["ja11", "ja12", "ja21"]);
    expect(out.every((n) => n.kind === "release" && !n.read)).toBe(true);
    expect(out[0]).toMatchObject({ id: "rel-ja11", artistId: "jr1", artistName: "Artist jr1", albumTitle: "Album ja11", releaseDate: "2026-11-10" });
    // Distinct, increasing timestamps → stable newest-first order.
    expect(newestFirst(out).map((n) => n.albumId)).toEqual(["ja21", "ja12", "ja11"]);
  });

  it("skips releases already notified and duplicates in one batch", () => {
    const out = releaseNotifications(follows, [rel("ja12", "jr1", "2026-11-18"), rel("ja12", "jr1", "2026-11-18"), rel("ja11", "jr1", "2026-11-11")], new Set(["rel-ja11"]), NOW);
    expect(out.map((n) => n.id)).toEqual(["rel-ja12"]);
  });

  it("demo releases (seed catalogue) don't need a release date after the follow", () => {
    const out = releaseNotifications(new Map([["sa-x", { at: NOW }]]), [rel("a-x", "sa-x", "2024-01-01", true)], new Set(), NOW);
    expect(out).toHaveLength(1);
    expect(out[0].demo).toBe(true);
  });
});

describe("helpers", () => {
  it("dayOf is the UTC day", () => {
    expect(dayOf(Date.parse("2026-11-20T23:59:59Z"))).toBe("2026-11-20");
  });
  it("welcome notice", () => {
    expect(welcomeNotification(NOW)).toEqual({ id: "welcome", kind: "welcome", createdAt: new Date(NOW).toISOString(), read: false });
  });
});
