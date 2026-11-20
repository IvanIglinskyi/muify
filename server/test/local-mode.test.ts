// Local mode (no Firebase) + seed catalogue (no Jamendo): stats, artists, recommendations and
// public links all work without accounts. State goes to a temp JSON file.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { clearRecommendationCache, seedArtistId } from "../src/catalog.js";
import { setFirebaseServicesForTesting } from "../src/firebase.js";
import { resetUserStoreForTesting, userStore } from "../src/userStore.js";
import { sleep } from "./fakeFirebase.js";

const dir = mkdtempSync(path.join(tmpdir(), "muify-test-"));

beforeAll(() => {
  process.env.MUIFY_DATA_DIR = dir;
  setFirebaseServicesForTesting(null); // force local mode
  resetUserStoreForTesting();
});

afterAll(async () => {
  await userStore().flushAll();
  rmSync(dir, { recursive: true, force: true });
});

describe("local mode basics", () => {
  it("runs in local mode on the seed catalogue", async () => {
    const r = await request(app).get("/api/status");
    expect(r.body).toMatchObject({ source: "seed", auth: { mode: "local" } });
  });
});

describe("GET /api/stats", () => {
  it("starts from the real (demo-seeded) likes and no listening", async () => {
    const r = await request(app).get("/api/stats");
    expect(r.status).toBe(200);
    // The local demo user starts with the seed's demo likes; nothing has been played yet.
    expect(r.body.totalSeconds).toBe(0);
    expect(r.body.tracks).toBe(0);
    expect(r.body.plays).toBe(0);
    expect(r.body.likes).toBeGreaterThan(0);
    expect(r.body.likes).toBeLessThan(50); // no mock base numbers any more
  });

  it("follows history and likes", async () => {
    const before = (await request(app).get("/api/stats")).body;
    await request(app).post("/api/history").send({ trackId: "t11", seconds: 120 });
    await request(app).post("/api/history").send({ trackId: "t11", seconds: 60 });
    await request(app).post("/api/history").send({ trackId: "t12", seconds: 5000 }); // clamped to the track length
    await request(app).patch("/api/albums/a-slow-dance/like").send({ liked: true });
    const after = (await request(app).get("/api/stats")).body;
    expect(after).toEqual({ totalSeconds: 120 + 60 + 199 + 5, likes: before.likes + 1, tracks: 2, plays: 3 });
  });
});

describe("GET /api/artists/:id (seed)", () => {
  it("derives the artist page from the seed data", async () => {
    const id = seedArtistId("Anthony");
    expect(id).toBe("sa-anthony");
    const r = await request(app).get(`/api/artists/${id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id, name: "Anthony", source: "seed" });
    expect(r.body.topTracks.map((t: { id: string }) => t.id)).toEqual(["t9", "t10"]); // by plays
    expect(r.body.albums.map((a: { id: string }) => a.id)).toContain("a-heaven");
    expect(r.body.albums[0].tracks.length).toBeGreaterThan(0);
  });

  it("puts artistId on tracks and albums", async () => {
    const day = await request(app).get("/api/albums/day");
    expect(day.body.artistId).toBe("sa-anthony");
    expect(day.body.tracks[0].artistId).toMatch(/^sa-/);
    expect(seedArtistId("Rook & Ivy")).toBe("sa-rook-ivy");
  });

  it("404s unknown artists and 400s malformed ids", async () => {
    expect((await request(app).get("/api/artists/sa-nobody-here")).status).toBe(404);
    expect((await request(app).get("/api/artists/jr123")).status).toBe(404); // no Jamendo configured, never seen
    expect((await request(app).get("/api/artists/..%2Fetc")).status).toBe(400);
    expect((await request(app).get("/api/artists/SA-UPPER")).status).toBe(400);
  });
});

describe("GET /api/recommendations (seed)", () => {
  it("personalises the Daily Mix from likes and plays, deterministically", async () => {
    clearRecommendationCache();
    // Strong signal: likes for Coral Static (electronic / party).
    for (const id of ["t16", "t17"]) await request(app).patch(`/api/tracks/${id}/like`).send({ liked: true });
    const r1 = (await request(app).get("/api/recommendations")).body;
    expect(r1.dailyMix.personalised).toBe(true);
    expect(r1.dailyMix.tracks.length).toBeGreaterThanOrEqual(6);
    expect(r1.dailyMix.basedOn.length).toBeGreaterThan(0);
    // Recently played tracks are left out.
    const ids = r1.dailyMix.tracks.map((t: { id: string }) => t.id);
    expect(ids).not.toContain("t11");
    expect(ids).not.toContain("t12");
    clearRecommendationCache();
    const r2 = (await request(app).get("/api/recommendations")).body;
    expect(r2.dailyMix.tracks.map((t: { id: string }) => t.id)).toEqual(ids);
    // /api/tracks/daily-mix serves the same personal mix.
    const mix = (await request(app).get("/api/tracks/daily-mix")).body;
    expect(mix.map((t: { id: string }) => t.id)).toEqual(ids);
  });

  it("adds a 'Because you liked' row when there is enough data", async () => {
    const r = (await request(app).get("/api/recommendations")).body;
    expect(r.becauseYouLiked).not.toBeNull();
    expect(r.becauseYouLiked.tracks.length).toBeGreaterThanOrEqual(4);
    expect(r.becauseYouLiked.tracks.some((t: { liked: boolean }) => t.liked)).toBe(false);
  });
});

describe("public links in local mode", () => {
  it("shares, opens and unshares a playlist; the JSON file keeps the share id", async () => {
    const pl = await request(app).post("/api/playlists").send({ name: "Local mix", trackIds: ["t1", "t2"] });
    const on = await request(app).put(`/api/playlists/${pl.body.id}/share`);
    expect(on.body.shareId).toBeTruthy();
    const view = await request(app).get(`/api/shared/${on.body.shareId}`);
    expect(view.status).toBe(200);
    expect(view.body.trackIds).toEqual(["t1", "t2"]);
    await userStore().flushAll();
    await sleep(50);
    const file = JSON.parse(readFileSync(path.join(dir, "user-state.json"), "utf8"));
    expect(file.playlists.find((p: { id: string }) => p.id === pl.body.id).shareId).toBe(on.body.shareId);
    await request(app).delete(`/api/playlists/${pl.body.id}/share`);
    expect((await request(app).get(`/api/shared/${on.body.shareId}`)).status).toBe(404);
  });
});
