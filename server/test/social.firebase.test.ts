// Follows, notifications, recent searches and the language preference in Firebase mode (fake RTDB):
// stored under users/{uid}/…, with valid RTDB keys, and guests are refused (401).
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { setFirebaseServicesForTesting } from "../src/firebase.js";
import { resetUserStoreForTesting } from "../src/userStore.js";
import { createFakeFirebase, sleep } from "./fakeFirebase.js";

const fb = createFakeFirebase();
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const A = fb.token("userA", "a@example.com");
const B = fb.token("userB", "b@example.com");

beforeAll(() => {
  setFirebaseServicesForTesting(fb.services);
  resetUserStoreForTesting();
});

describe("guests", () => {
  it("can search but not follow, read notifications or keep searches", async () => {
    const s = await request(app).get("/api/search?q=rain");
    expect(s.status).toBe(200);
    expect(s.body.playlists).toEqual([]);
    expect((await request(app).get("/api/artists/sa-anthony")).body.following).toBe(false);
    for (const [method, path] of [
      ["put", "/api/artists/sa-anthony/follow"],
      ["get", "/api/me/follows"],
      ["get", "/api/notifications"],
      ["get", "/api/me/searches"],
    ] as const) {
      const r = await request(app)[method](path);
      expect(r.status, `${method} ${path}`).toBe(401);
      expect(r.body.code).toBe("auth-required");
    }
  });
});

describe("per-user state in Realtime Database", () => {
  it("stores follows, notifications, searches and language under users/{uid}", async () => {
    expect((await request(app).put("/api/artists/sa-anthony/follow").set(auth(A))).status).toBe(200);
    const n = await request(app).get("/api/notifications").set(auth(A));
    expect(n.body.unread).toBe(2);
    await request(app).post("/api/notifications/read").set(auth(A)).send({ ids: ["welcome"] });
    await request(app).post("/api/me/searches").set(auth(A)).send({ q: "night.drive $1 #a/b" });
    await request(app).patch("/api/me").set(auth(A)).send({ language: "uk" });
    await sleep(600);

    const tree = fb.getAt("users/userA") as Record<string, any>;
    expect(tree.follows["sa-anthony"]).toMatchObject({ name: "Anthony", source: "seed" });
    expect(typeof tree.follows["sa-anthony"].at).toBe("number");
    expect(tree.notifications.items.welcome).toMatchObject({ kind: "welcome", read: true });
    const releaseKey = Object.keys(tree.notifications.items).find((k) => k.startsWith("rel-"));
    expect(releaseKey).toBeTruthy();
    expect(tree.notifications.items[releaseKey!].id).toBeUndefined(); // the key is the id
    expect(typeof tree.notifications.checkedAt).toBe("number");
    expect(Object.values(tree.searches)).toEqual(["night.drive $1 #a/b"]); // values may contain anything
    expect(tree.profile.language).toBe("uk");
  });

  it("keeps users apart", async () => {
    expect((await request(app).get("/api/me/follows").set(auth(B))).body).toEqual([]);
    expect((await request(app).get("/api/artists/sa-anthony").set(auth(B))).body.following).toBe(false);
    expect((await request(app).get("/api/me/searches").set(auth(B))).body).toEqual([]);
    const nb = await request(app).get("/api/notifications").set(auth(B));
    expect(nb.body.items.map((x: { kind: string }) => x.kind)).toEqual(["welcome"]);
    expect((await request(app).get("/api/me").set(auth(B))).body.language).toBeNull();
  });

  it("reloads the state after a restart", async () => {
    resetUserStoreForTesting(); // fresh store: everything comes back from RTDB
    const follows = await request(app).get("/api/me/follows").set(auth(A));
    expect(follows.body.map((x: { id: string }) => x.id)).toEqual(["sa-anthony"]);
    const n = await request(app).get("/api/notifications").set(auth(A));
    expect(n.body.unread).toBe(1);
    expect(n.body.items.find((x: { id: string }) => x.id === "welcome").read).toBe(true);
    expect((await request(app).get("/api/me").set(auth(A))).body.language).toBe("uk");
  });

  it("the data export includes the new state", async () => {
    const r = await request(app).get("/api/me/export").set(auth(A));
    expect(r.body.followedArtists[0]).toMatchObject({ id: "sa-anthony", name: "Anthony" });
    expect(r.body.notifications.length).toBe(2);
    expect(r.body.recentSearches).toEqual(["night.drive $1 #a/b"]);
  });

  it("deleting the account removes it all", async () => {
    const fresh = fb.token("userA", "a@example.com");
    expect((await request(app).delete("/api/me").set(auth(fresh))).status).toBe(204);
    expect(fb.getAt("users/userA")).toBeNull();
  });
});
