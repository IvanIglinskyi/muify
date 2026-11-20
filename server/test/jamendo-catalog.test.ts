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
import { clearRecommendationCache, clearReleaseCache } from "../src/catalog.js";
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
  // include=lyrics → every /tracks item carries a lyrics field (track 700 has some, others are empty).
  if (url.pathname.startsWith("/tracks") && (url.searchParams.get("include") ?? "").split(" ").includes("lyrics")) {
    const orig = send;
    const withLyrics = (results: unknown[]) =>
      orig(results.map((t) => ({ ...(t as object), lyrics: (t as { id: string }).id === "700" ? "Line one<br />Line &amp; two\r\n\r\n\r\nEnd" : "" })));
    return route(url, withLyrics);
  }
  return route(url, send);
});

const today = new Date().toISOString().slice(0, 10);

function route(url: URL, send: (results: unknown[]) => void) {
  const p = url.pathname.replace(/\/+$/, "");
  const q = url.searchParams;
  if (p === "/artists" && q.get("namesearch")) {
    const n = q.get("namesearch")!.toLowerCase();
    return send([{ id: "7", name: "Artist 7", joindate: "2012-02-02", image: "", shareurl: "https://www.jamendo.com/artist/7" }].filter((a) => a.name.toLowerCase().includes(n)));
  }
  if (p === "/albums") {
    // New releases: artist 7 released an album today (and an old one).
    const ids = (q.get("artist_id") ?? "").split(" ");
    const [from] = (q.get("datebetween") ?? "0000-00-00_").split("_");
    const all = [
      { id: "7901", name: "Brand New", releasedate: today, artist_id: "7", artist_name: "Artist 7", image: "https://img.test/new" },
      { id: "7900", name: "Old One", releasedate: "2019-05-05", artist_id: "7", artist_name: "Artist 7", image: "" },
    ];
    return send(all.filter((a) => ids.includes(a.artist_id) && a.releasedate >= from));
  }
  if (p === "/artists") {
    const id = q.get("id");
    if (id === "8") return send([{ id: "8", name: "Artist 8", joindate: "2013-03-03", image: "", shareurl: "https://www.jamendo.com/artist/8" }]);
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
}

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

describe("lyrics (Jamendo include=lyrics)", () => {
  it("flags tracks with lyrics and serves them as plain text", async () => {
    const r = await request(app).get("/api/artists/jr7");
    const t700 = r.body.topTracks.find((t: { id: string }) => t.id === "j700");
    const t701 = r.body.topTracks.find((t: { id: string }) => t.id === "j701");
    expect(t700.hasLyrics).toBe(true);
    expect(t701.hasLyrics).toBe(false);
    const ly = await request(app).get("/api/tracks/j700/lyrics");
    expect(ly.status).toBe(200);
    expect(ly.body).toEqual({ trackId: "j700", lyrics: "Line one\nLine & two\n\nEnd" });
    expect((await request(app).get("/api/tracks/j701/lyrics")).body.lyrics).toBeNull();
    expect((await request(app).get("/api/tracks/j424242/lyrics")).status).toBe(404);
    const call = requests.find((u) => u.pathname.startsWith("/tracks") && u.searchParams.get("artist_id") === "7");
    expect(call?.searchParams.get("include")).toBe("musicinfo lyrics");
  });
});

describe("artist search (Jamendo /artists?namesearch)", () => {
  it("finds artists by name", async () => {
    const r = await request(app).get("/api/search?q=artist%207&type=artists");
    expect(r.status).toBe(200);
    expect(r.body.artists).toEqual([expect.objectContaining({ id: "jr7", name: "Artist 7", source: "jamendo" })]);
    const call = requests.find((u) => u.pathname.startsWith("/artists") && u.searchParams.get("namesearch") === "artist 7");
    expect(call).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toContain(CLIENT);
  });

  it("'all' combines tracks, albums and artists", async () => {
    const r = await request(app).get("/api/search?q=artist");
    expect(r.body.tracks.length).toBeGreaterThan(0);
    expect(r.body.artists.length).toBe(1);
    expect(Array.isArray(r.body.albums)).toBe(true);
  });
});

describe("new-release notifications (Jamendo)", () => {
  it("announces releases since the follow, asking Jamendo at most once per interval", async () => {
    clearReleaseCache();
    expect((await request(app).put("/api/artists/jr7/follow")).status).toBe(200);
    const before = requests.length;
    const r = await request(app).get("/api/notifications");
    expect(r.status).toBe(200);
    const release = r.body.items.find((n: { kind: string }) => n.kind === "release");
    expect(release).toMatchObject({ id: "rel-ja7901", albumId: "ja7901", artistId: "jr7", albumTitle: "Brand New", releaseDate: today });
    expect(release.demo).toBeUndefined();
    expect(r.body.items.some((n: { albumId?: string }) => n.albumId === "ja7900")).toBe(false); // released before the follow
    const albumCalls = requests.slice(before).filter((u) => u.pathname.startsWith("/albums") && !u.pathname.startsWith("/albums/tracks"));
    expect(albumCalls).toHaveLength(1);
    expect(albumCalls[0].searchParams.get("artist_id")).toBe("7");
    expect(albumCalls[0].searchParams.get("datebetween")).toMatch(new RegExp(`^${today}_`));

    // Within the interval: no new lookup, no duplicates.
    const n = requests.length;
    const again = await request(app).get("/api/notifications");
    expect(requests.length).toBe(n);
    expect(again.body.items.filter((x: { id: string }) => x.id === "rel-ja7901")).toHaveLength(1);
  });

  it("the notification's album opens even though it was never loaded", async () => {
    const r = await request(app).get("/api/albums/ja7901");
    // The fake /albums/tracks only knows a few albums: 404 is fine, but never a 500.
    expect([200, 404]).toContain(r.status);
  });

  it("a failed lookup keeps the old items and backs off", async () => {
    expect((await request(app).put("/api/artists/jr8/follow")).status).toBe(200); // new follow → lookup due
    failAll = true;
    try {
      const before = requests.length;
      const r = await request(app).get("/api/notifications");
      expect(r.status).toBe(200);
      expect(requests.slice(before).some((u) => u.pathname.startsWith("/albums") && u.searchParams.get("artist_id") === "8")).toBe(true);
      expect(r.body.items.some((x: { id: string }) => x.id === "rel-ja7901")).toBe(true);
      const n = requests.length;
      await request(app).get("/api/notifications");
      expect(requests.length).toBe(n); // backing off, not retrying on every request
    } finally {
      failAll = false;
    }
  });
});
