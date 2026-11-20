// Jamendo mode against a local fake Jamendo API (JAMENDO_API_BASE): artist pages, personalised
// recommendations, request caching and fallbacks. Local (no-Firebase) user mode.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { clearRecommendationCache } from "../src/catalog.js";
import { setFirebaseServicesForTesting } from "../src/firebase.js";
import { resetUserStoreForTesting, userStore } from "../src/userStore.js";

const CLIENT = "fakeclientid99";
const dir = mkdtempSync(path.join(tmpdir(), "muify-jam-"));
const requests: URL[] = [];
let failAll = false;

function track(id: number, artistId: number, tags: string[]) {
  return {
    id: String(id),
    name: `Track ${id}`,
    duration: 180,
    artist_id: String(artistId),
    artist_name: `Artist ${artistId}`,
    album_name: `Album of ${artistId}`,
    album_id: String(artistId * 10),
    license_ccurl: "http://creativecommons.org/licenses/by/3.0/",
    position: 1,
    releasedate: "2020-01-01",
    album_image: `https://img.test/a${artistId}?from=${CLIENT}`,
    audio: `https://audio.test/${id}?from=app-${CLIENT}`,
    shareurl: `https://www.jamendo.com/track/${id}`,
    image: `https://img.test/t${id}`,
    musicinfo: { tags: { genres: tags, vartags: [], instruments: [] } },
  };
}

// Artist 7 makes jazz; artists 20-39 make assorted music; artist 8 exists only in mixes.
const byArtist = (a: number) => Array.from({ length: 6 }, (_, i) => track(a * 100 + i, a, a === 7 ? ["jazz"] : ["pop"]));
const popular = Array.from({ length: 20 }, (_, i) => track(5000 + i, 20 + i, i % 2 ? ["rock"] : ["jazz"]));
const jazzy = Array.from({ length: 15 }, (_, i) => track(6000 + i, 40 + i, ["jazz"]));

function album(artistId: number, n: number) {
  return {
    id: String(artistId * 10 + n),
    name: `Album ${n} of ${artistId}`,
    releasedate: `202${n}-01-01`,
    artist_id: String(artistId),
    artist_name: `Artist ${artistId}`,
    image: `https://img.test/al${artistId}${n}`,
    tracks: [{ id: String(artistId * 1000 + n), position: 1, name: "Song", duration: "120", license_ccurl: "", audio: "https://audio.test/x" }],
  };
}

const server: Server = createServer((req, res) => {
  const url = new URL(req.url!, "http://fake");
  requests.push(url);
  const send = (results: unknown[]) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ headers: { status: "success", code: 0, error_message: "", warnings: "", results_count: results.length }, results }));
  };
  if (url.searchParams.get("client_id") !== CLIENT) return send([]);
  if (failAll) {
    res.statusCode = 500;
    return res.end("down");
  }
  const p = url.pathname.replace(/\/+$/, "");
  const q = url.searchParams;
  if (p === "/artists") {
    const id = q.get("id");
    return send(id === "7" ? [{ id: "7", name: "Artist 7", joindate: "2012-02-02", image: `https://img.test/ar7?x=${CLIENT}`, shareurl: "https://www.jamendo.com/artist/7", website: "" }] : []);
  }
  if (p === "/tracks") {
    if (q.get("id")) return send([...popular, ...jazzy, ...byArtist(7)].filter((t) => t.id === q.get("id")));
    if (q.get("artist_id")) return send(q.get("artist_id")!.split(" ").flatMap((a) => byArtist(Number(a))));
    if (q.get("fuzzytags")) return send(jazzy);
    return send([...popular, track(7777, 8, ["pop"])]);
  }
  if (p === "/albums/tracks") {
    if (q.get("artist_id") === "7") return send([album(7, 1), album(7, 2)]);
    return send([album(1, 1), album(2, 1), album(3, 1), album(4, 1), album(5, 1), album(6, 1)]);
  }
  send([]);
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.JAMENDO_CLIENT_ID = CLIENT;
  process.env.JAMENDO_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.MUIFY_DATA_DIR = dir;
  setFirebaseServicesForTesting(null);
  resetUserStoreForTesting();
});

afterAll(async () => {
  await userStore().flushAll();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Jamendo artist page", () => {
  it("combines /artists, /tracks?artist_id and /albums/tracks?artist_id", async () => {
    const r = await request(app).get("/api/artists/jr7");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: "jr7", name: "Artist 7", source: "jamendo", joinDate: "2012-02-02", shareUrl: "https://www.jamendo.com/artist/7" });
    expect(r.body.topTracks).toHaveLength(6);
    expect(r.body.topTracks.every((t: { artistId: string }) => t.artistId === "jr7")).toBe(true);
    expect(r.body.albums.map((a: { id: string }) => a.id)).toEqual(["ja71", "ja72"]);
    expect(JSON.stringify(r.body)).not.toContain(CLIENT);
    const tracksCall = requests.find((u) => u.pathname.startsWith("/tracks") && u.searchParams.get("artist_id") === "7");
    expect(tracksCall?.searchParams.get("order")).toBe("popularity_total");
  });

  it("404s an artist Jamendo doesn't know", async () => {
    expect((await request(app).get("/api/artists/jr999")).status).toBe(404);
  });

  it("falls back to known tracks when Jamendo is down, else 502", async () => {
    await request(app).get("/api/tracks?sort=top"); // registers artist 8's track
    failAll = true;
    try {
      const known = await request(app).get("/api/artists/jr8");
      expect(known.status).toBe(200);
      expect(known.body.name).toBe("Artist 8");
      const unknown = await request(app).get("/api/artists/jr12345");
      expect(unknown.status).toBe(502);
      expect(JSON.stringify(unknown.body)).not.toContain(CLIENT);
    } finally {
      failAll = false;
    }
  });
});

describe("personalised recommendations (Jamendo)", () => {
  it("serves the generic mix while there is not enough data", async () => {
    clearRecommendationCache();
    const r = (await request(app).get("/api/recommendations")).body;
    expect(r.dailyMix.personalised).toBe(false);
    expect(r.becauseYouLiked).toBeNull();
  });

  it("builds the mix from liked artists and genres, cached per user", async () => {
    for (const id of ["j700", "j701", "j702"]) expect((await request(app).patch(`/api/tracks/${id}/like`).send({ liked: true })).status).toBe(200);
    clearRecommendationCache();
    const before = requests.length;
    const r = (await request(app).get("/api/recommendations")).body;
    expect(r.dailyMix.personalised).toBe(true);
    expect(r.dailyMix.basedOn).toContain("Artist 7");
    const artists = new Set(r.dailyMix.tracks.map((t: { artist: string }) => t.artist));
    expect(r.dailyMix.tracks.length).toBeGreaterThanOrEqual(6);
    expect(artists.size).toBeGreaterThan(1);
    // Queried by artist id and by tags.
    const calls = requests.slice(before);
    expect(calls.some((u) => u.searchParams.get("artist_id") === "7")).toBe(true);
    expect(calls.some((u) => (u.searchParams.get("fuzzytags") ?? "").includes("jazz"))).toBe(true);
    expect(r.becauseYouLiked?.artist).toEqual({ id: "jr7", name: "Artist 7" });
    expect(r.becauseYouLiked.tracks.every((t: { liked: boolean }) => !t.liked)).toBe(true);

    // Second request: served from the per-user cache, no new Jamendo calls.
    const n = requests.length;
    const again = (await request(app).get("/api/tracks/daily-mix")).body;
    expect(requests.length).toBe(n);
    expect(again.map((t: { id: string }) => t.id)).toEqual(r.dailyMix.tracks.map((t: { id: string }) => t.id));
  });
});
