// Local mode + seed catalogue: following artists, notifications, search, recent searches,
// lyrics, language preference, rate limiting and security headers.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { setFirebaseServicesForTesting } from "../src/firebase.js";
import { resetRateLimits } from "../src/security.js";
import { resetUserStoreForTesting, userStore } from "../src/userStore.js";
import { sleep } from "./fakeFirebase.js";

const dir = mkdtempSync(path.join(tmpdir(), "muify-social-"));

beforeAll(() => {
  process.env.MUIFY_DATA_DIR = dir;
  setFirebaseServicesForTesting(null); // local mode
  resetUserStoreForTesting();
});

afterAll(async () => {
  await userStore().flushAll();
  rmSync(dir, { recursive: true, force: true });
});

describe("follow artists", () => {
  it("follows, reports it on the artist page and lists it", async () => {
    expect((await request(app).get("/api/artists/sa-anthony")).body.following).toBe(false);
    const r = await request(app).put("/api/artists/sa-anthony/follow");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ following: true, artist: { id: "sa-anthony", name: "Anthony", source: "seed" } });
    expect((await request(app).get("/api/artists/sa-anthony")).body.following).toBe(true);
    // Idempotent: the original follow date is kept.
    const again = await request(app).put("/api/artists/sa-anthony/follow");
    expect(again.body.artist.followedAt).toBe(r.body.artist.followedAt);
    await request(app).put("/api/artists/sa-marko/follow");
    const list = await request(app).get("/api/me/follows");
    expect(list.body.map((a: { id: string }) => a.id)).toEqual(["sa-marko", "sa-anthony"]); // newest first
  });

  it("unfollows (idempotent) and validates ids", async () => {
    const r = await request(app).delete("/api/artists/sa-marko/follow");
    expect(r.body).toEqual({ following: false, artist: null });
    expect((await request(app).delete("/api/artists/sa-marko/follow")).status).toBe(200);
    expect((await request(app).get("/api/me/follows")).body.map((a: { id: string }) => a.id)).toEqual(["sa-anthony"]);
    expect((await request(app).put("/api/artists/sa-nobody-at-all/follow")).status).toBe(404);
    expect((await request(app).put("/api/artists/..%2Fx/follow")).status).toBe(400);
  });
});

describe("notifications", () => {
  it("welcomes and announces (demo) releases of followed seed artists", async () => {
    const r = await request(app).get("/api/notifications");
    expect(r.status).toBe(200);
    const kinds = r.body.items.map((n: { kind: string }) => n.kind);
    expect(kinds).toContain("welcome");
    const release = r.body.items.find((n: { kind: string }) => n.kind === "release");
    expect(release).toMatchObject({ artistId: "sa-anthony", artistName: "Anthony", demo: true, read: false });
    expect(release.albumId).toMatch(/^a-/);
    expect(r.body.unread).toBe(2);
    expect(r.body.checkedAt).toBeTruthy();
    expect(r.body.items[0].kind).toBe("release"); // newest first
  });

  it("does not look again (or duplicate) within the interval", async () => {
    const a = (await request(app).get("/api/notifications")).body;
    await sleep(5);
    const b = (await request(app).get("/api/notifications")).body;
    expect(b.checkedAt).toBe(a.checkedAt);
    expect(b.items).toHaveLength(a.items.length);
  });

  it("marks one or all as read", async () => {
    const one = await request(app).post("/api/notifications/read").send({ ids: ["welcome"] });
    expect(one.status).toBe(200);
    expect(one.body.unread).toBe(1);
    expect(one.body.items.find((n: { id: string }) => n.id === "welcome").read).toBe(true);
    const all = await request(app).post("/api/notifications/read").send({ all: true });
    expect(all.body.unread).toBe(0);
    expect((await request(app).post("/api/notifications/read").send({ ids: "welcome" })).status).toBe(400);
    expect((await request(app).post("/api/notifications/read").send({ ids: ["../x"] })).status).toBe(400);
    expect((await request(app).post("/api/notifications/read").send({})).status).toBe(400);
  });
});

describe("GET /api/search (seed)", () => {
  it("validates q and type", async () => {
    expect((await request(app).get("/api/search")).status).toBe(400);
    expect((await request(app).get("/api/search?q=%20%20")).status).toBe(400);
    expect((await request(app).get(`/api/search?q=${"x".repeat(101)}`)).status).toBe(400);
    expect((await request(app).get("/api/search?q=rain&type=nope")).status).toBe(400);
  });

  it("searches tracks, albums, artists and own playlists", async () => {
    await request(app).post("/api/playlists").send({ name: "Rainy road", trackIds: ["t1"] });
    const r = await request(app).get("/api/search?q=rain");
    expect(r.status).toBe(200);
    expect(r.body.type).toBe("all");
    expect(r.body.albums.map((a: { id: string }) => a.id)).toContain("a-rain");
    expect(r.body.playlists.map((p: { name: string }) => p.name)).toEqual(["Rainy road"]);
    const artists = await request(app).get("/api/search?q=anth&type=artists");
    expect(artists.body.artists[0]).toMatchObject({ id: "sa-anthony", name: "Anthony", source: "seed" });
    expect(artists.body.tracks).toEqual([]);
    expect(artists.body.albums).toEqual([]);
    const tracks = await request(app).get("/api/search?q=anthony&type=tracks");
    expect(tracks.body.tracks.length).toBeGreaterThan(0);
    expect(tracks.body.artists).toEqual([]);
  });

  it("keeps recent searches (newest first, deduped, max 10) and clears them", async () => {
    await request(app).post("/api/me/searches").send({ q: "Rain" });
    await request(app).post("/api/me/searches").send({ q: "jazz" });
    const r = await request(app).post("/api/me/searches").send({ q: "  rain  " });
    expect(r.body).toEqual(["rain", "jazz"]);
    for (let i = 0; i < 12; i++) await request(app).post("/api/me/searches").send({ q: `q${i}` });
    const list = (await request(app).get("/api/me/searches")).body;
    expect(list).toHaveLength(10);
    expect(list[0]).toBe("q11");
    expect((await request(app).delete("/api/me/searches?q=q11")).body[0]).toBe("q10");
    expect((await request(app).delete("/api/me/searches")).body).toEqual([]);
    expect((await request(app).post("/api/me/searches").send({ q: "" })).status).toBe(400);
  });
});

describe("lyrics (seed)", () => {
  it("seed tracks have none; unknown tracks 404", async () => {
    expect((await request(app).get("/api/tracks/t1/lyrics")).body).toEqual({ trackId: "t1", lyrics: null });
    expect((await request(app).get("/api/tracks/j999999/lyrics")).status).toBe(404);
    expect((await request(app).get("/api/tracks/a.b/lyrics")).status).toBe(400);
  });
});

describe("language preference", () => {
  it("is stored in the profile", async () => {
    expect((await request(app).get("/api/me")).body.language).toBeNull();
    const r = await request(app).patch("/api/me").send({ language: "uk" });
    expect(r.status).toBe(200);
    expect(r.body.language).toBe("uk");
    expect((await request(app).patch("/api/me").send({ language: "de" })).status).toBe(400);
    expect((await request(app).get("/api/me")).body.language).toBe("uk");
  });

  it("persists follows, notifications, searches and language in the local file", async () => {
    await request(app).post("/api/me/searches").send({ q: "lofi" });
    await userStore().flushAll();
    await sleep(50);
    const file = JSON.parse(readFileSync(path.join(dir, "user-state.json"), "utf8"));
    expect(Object.keys(file.follows)).toEqual(["sa-anthony"]);
    expect(file.notifications.length).toBeGreaterThanOrEqual(2);
    expect(file.searches).toEqual(["lofi"]);
    expect(file.profile.language).toBe("uk");
  });
});

describe("hardening", () => {
  it("sends security headers with a Firebase-compatible CSP", async () => {
    const r = await request(app).get("/api/status");
    expect(r.headers["x-powered-by"]).toBeUndefined();
    const csp = r.headers["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' https://apis.google.com");
    expect(csp).toContain("https://*.firebaseapp.com");
    expect(csp).toContain("https://identitytoolkit.googleapis.com");
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://*.jamendo.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(r.headers["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("rejects oversized JSON bodies with 413", async () => {
    const r = await request(app).post("/api/me/searches").set("content-type", "application/json").send(JSON.stringify({ q: "x".repeat(200_000) }));
    expect(r.status).toBe(413);
  });

  it("rate-limits writes per client (429 + Retry-After), reads are not limited", async () => {
    process.env.RATE_LIMIT_WRITES = "3";
    resetRateLimits();
    try {
      for (let i = 0; i < 3; i++) expect((await request(app).post("/api/me/searches").send({ q: `r${i}` })).status).toBe(200);
      const blocked = await request(app).post("/api/me/searches").send({ q: "r4" });
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe("rate-limited");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
      expect((await request(app).get("/api/me/searches")).status).toBe(200);
    } finally {
      delete process.env.RATE_LIMIT_WRITES;
      resetRateLimits();
    }
  });

  it("limits account actions more strictly", async () => {
    process.env.RATE_LIMIT_ACCOUNT = "1";
    resetRateLimits();
    try {
      expect((await request(app).get("/api/me/export")).status).toBe(200);
      expect((await request(app).get("/api/me/export")).status).toBe(429);
      expect((await request(app).get("/api/me")).status).toBe(200); // plain reads unaffected
    } finally {
      delete process.env.RATE_LIMIT_ACCOUNT;
      resetRateLimits();
    }
  });
});
