// Firebase mode end-to-end through the HTTP API, against the in-memory fake (formerly
// scripts/auth-smoke.ts): auth middleware, per-user isolation, profile, export, deletion, revocation.
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { setFirebaseServicesForTesting } from "../src/firebase.js";
import { resetUserStoreForTesting, userStore } from "../src/userStore.js";
import { createFakeFirebase, sleep } from "./fakeFirebase.js";

const fb = createFakeFirebase();
const auth = (t?: string) => (t ? { authorization: `Bearer ${t}` } : {});

beforeAll(() => {
  setFirebaseServicesForTesting(fb.services);
  resetUserStoreForTesting();
});

describe("auth middleware", () => {
  it("reports firebase mode", async () => {
    const r = await request(app).get("/api/status");
    expect(r.body.auth.mode).toBe("firebase");
    expect(userStore().kind).toBe("firebase");
  });

  it("lets guests browse the catalogue without likes", async () => {
    const paths = ["/api/albums/day", "/api/albums/week", "/api/playlists", "/api/tracks/recent", "/api/tracks/daily-mix", "/api/player/last", "/api/genres", "/api/tracks?liked=true", "/api/recommendations"];
    const res = await Promise.all(paths.map((p) => request(app).get(p)));
    expect(res.map((r) => r.status)).toEqual(paths.map(() => 200));
    expect(JSON.stringify(res.map((r) => r.body))).not.toContain('"liked":true');
    expect(res[7].body).toEqual([]);
    expect(res[8].body.dailyMix.personalised).toBe(false);
    expect(res[8].body.becauseYouLiked).toBeNull();
  });

  it("answers 401 auth-required on user-state endpoints for guests", async () => {
    const calls = [
      request(app).patch("/api/tracks/t1/like").send({ liked: true }),
      request(app).post("/api/playlists").send({ name: "x" }),
      request(app).post("/api/history").send({ trackId: "t1", seconds: 12 }),
      request(app).post("/api/player/state").send({ trackId: "t1", position: 3 }),
      request(app).get("/api/history"),
      request(app).get("/api/stats"),
      request(app).get("/api/stats/listening"),
      request(app).get("/api/me"),
      request(app).put("/api/playlists/u-x/share"),
      request(app).put("/api/playlists/u-x/tracks").send({ trackIds: [] }),
    ];
    const res = await Promise.all(calls);
    for (const r of res) {
      expect(r.status).toBe(401);
      expect(r.body.code).toBe("auth-required");
      expect(r.headers["www-authenticate"]).toContain("Bearer");
    }
  });

  it("rejects malformed and invalid tokens with 401", async () => {
    const bad = await request(app).get("/api/history").set(auth("fake.not-json"));
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe("token-invalid");
    const garbage = await request(app).get("/api/history").set({ authorization: "Basic abc" });
    expect(garbage.status).toBe(401);
  });

  it("accepts a valid token (200)", async () => {
    const r = await request(app).get("/api/history").set(auth(fb.token("uidOk")));
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });
});

describe("per-user state", () => {
  const A = fb.token("uidA", "a@example.com");
  const B = fb.token("uidB", "b@example.com");
  let playlistId = "";
  let entryId = "";

  it("stores A's likes, playlists, history and player in users/uidA", async () => {
    expect((await request(app).patch("/api/tracks/t3/like").set(auth(A)).send({ liked: true })).body.liked).toBe(true);
    const pl = await request(app).post("/api/playlists").set(auth(A)).send({ name: "A's mix", trackIds: ["t1", "t2"] });
    expect(pl.status).toBe(201);
    playlistId = pl.body.id;
    const add = await request(app).post(`/api/playlists/${playlistId}/tracks`).set(auth(A)).send({ trackId: "t5" });
    expect(add.body.trackIds).toEqual(["t1", "t2", "t5"]);
    const h1 = await request(app).post("/api/history").set(auth(A)).send({ trackId: "t3", seconds: 12 });
    expect(h1.status).toBe(201);
    entryId = h1.body.id;
    await sleep(700);

    fb.writes.length = 0;
    const h2 = await request(app).post("/api/history").set(auth(A)).send({ trackId: "t3", seconds: 40, entryId });
    expect(h2.status).toBe(200);
    expect(h2.body.seconds).toBe(40);
    expect((await request(app).post("/api/player/state").set(auth(A)).send({ trackId: "t3", position: 30, queue: ["t3", "t4"], volume: 0.5 })).status).toBe(204);
    await sleep(700);
    // A history ping + a player save are ONE small multi-path update.
    expect(fb.writes).toHaveLength(1);
    expect(fb.writes[0].bytes).toBeLessThan(600);
    expect(fb.writes[0].keys.every((k) => k === `history/${entryId}/s` || k.startsWith("player"))).toBe(true);

    const tree = fb.getAt("users/uidA") as Record<string, any>;
    expect(tree.likes.tracks.t3).toBeTypeOf("number");
    expect(tree.playlists[playlistId].name).toBe("A's mix");
    expect(tree.profile.email).toBe("a@example.com");
  });

  it("keeps B isolated from A", async () => {
    expect((await request(app).get("/api/tracks?liked=true").set(auth(B))).body).toEqual([]);
    const bPl = await request(app).get("/api/playlists").set(auth(B));
    expect(bPl.body.some((p: { id: string }) => p.id === playlistId)).toBe(false);
    expect((await request(app).get(`/api/playlists/${playlistId}`).set(auth(B))).status).toBe(404);
    expect((await request(app).delete(`/api/playlists/${playlistId}`).set(auth(B))).status).toBe(404);
    expect((await request(app).put(`/api/playlists/${playlistId}/share`).set(auth(B))).status).toBe(404);
    expect((await request(app).get("/api/history").set(auth(B))).body).toEqual([]);
    const upd = await request(app).post("/api/history").set(auth(B)).send({ trackId: "t3", seconds: 99, entryId });
    expect(upd.status).toBe(201);
    expect(upd.body.id).not.toBe(entryId);
    expect((await request(app).get("/api/player/last").set(auth(B))).body.saved).toBe(false);
    const aLast = await request(app).get("/api/player/last").set(auth(A));
    expect(aLast.body).toMatchObject({ saved: true, position: 30, volume: 0.5 });
  });

  it("computes the Home statistics from each user's own data", async () => {
    const a = await request(app).get("/api/stats").set(auth(A));
    expect(a.body).toEqual({ totalSeconds: 40, likes: 1, tracks: 1, plays: 1 });
    const b = await request(app).get("/api/stats").set(auth(B));
    expect(b.body).toEqual({ totalSeconds: 99, likes: 0, tracks: 1, plays: 1 });
  });

  it("validates and normalises profile edits", async () => {
    const me = await request(app).patch("/api/me").set(auth(A)).send({ displayName: "  Alice   A ", accentColor: "#9B6BFF", usePhoto: false });
    expect(me.body).toMatchObject({ displayName: "Alice A", accentColor: "#9b6bff" });
    expect((await request(app).patch("/api/me").set(auth(A)).send({ accentColor: "red" })).status).toBe(400);
  });

  it("exports A's data", async () => {
    const exp = await request(app).get("/api/me/export").set(auth(A));
    expect(exp.status).toBe(200);
    expect(exp.body.likedTracks.some((l: { id: string }) => l.id === "t3")).toBe(true);
    expect(exp.body.playlists).toHaveLength(1);
  });

  it("deletes the account only after a recent sign-in, including public links", async () => {
    const share = await request(app).put(`/api/playlists/${playlistId}/share`).set(auth(A));
    const shareId = share.body.shareId as string;
    expect(fb.getAt(`sharedPlaylists/${shareId}`)).toMatchObject({ ownerUid: "uidA", playlistId });

    const stale = fb.token("uidA", "a@example.com", { authTimeAgoS: 3600 });
    const delStale = await request(app).delete("/api/me").set(auth(stale));
    expect(delStale.status).toBe(403);
    expect(delStale.body.code).toBe("requires-recent-login");

    await request(app).patch("/api/tracks/t4/like").set(auth(A)).send({ liked: true }); // must not resurrect data
    expect((await request(app).delete("/api/me").set(auth(A))).status).toBe(204);
    await sleep(800);
    expect(fb.getAt("users/uidA")).toBeNull();
    expect(fb.getAt(`sharedPlaylists/${shareId}`)).toBeNull();
    expect(fb.authUsers.has("uidA")).toBe(false);
    expect((await request(app).get("/api/history").set(auth(A))).status).toBe(401);
    expect((await request(app).get(`/api/shared/${shareId}`)).status).toBe(404);
    expect(fb.getAt("users/uidB/history")).not.toBeNull();
  });

  it("rejects tokens after revoke-sessions", async () => {
    const B2 = fb.token("uidB", "b@example.com");
    expect((await request(app).get("/api/history").set(auth(B2))).status).toBe(200);
    expect((await request(app).post("/api/me/revoke-sessions").set(auth(B2))).status).toBe(204);
    const after = await request(app).get("/api/history").set(auth(B2));
    expect(after.status).toBe(401);
    expect(after.body.code).toBe("token-revoked");
  });
});
