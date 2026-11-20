// Playlist reorder / description / public sharing endpoints in Firebase mode (fake RTDB).
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { setFirebaseServicesForTesting } from "../src/firebase.js";
import { resetUserStoreForTesting } from "../src/userStore.js";
import { createFakeFirebase, sleep } from "./fakeFirebase.js";

const fb = createFakeFirebase();
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const OWNER = fb.token("owner1", "owner@example.com");
const OTHER = fb.token("other1", "other@example.com");

let id = "";

beforeAll(async () => {
  setFirebaseServicesForTesting(fb.services);
  resetUserStoreForTesting();
  await request(app).patch("/api/me").set(auth(OWNER)).send({ displayName: "Olga" });
  const pl = await request(app).post("/api/playlists").set(auth(OWNER)).send({ name: "Road trip", trackIds: ["t1", "t2", "t3"] });
  id = pl.body.id;
});

describe("PUT /api/playlists/:id/tracks (reorder)", () => {
  it("reorders and persists the new order", async () => {
    const r = await request(app).put(`/api/playlists/${id}/tracks`).set(auth(OWNER)).send({ trackIds: ["t3", "t1", "t2"] });
    expect(r.status).toBe(200);
    expect(r.body.trackIds).toEqual(["t3", "t1", "t2"]);
    await sleep(600);
    // RTDB hands arrays back as {"0": …, "1": …} objects.
    expect(Object.values((fb.getAt(`users/owner1/playlists/${id}`) as { trackIds: Record<string, string> }).trackIds)).toEqual(["t3", "t1", "t2"]);
  });

  it("rejects lists that are not a permutation (409) and malformed bodies (400)", async () => {
    const missing = await request(app).put(`/api/playlists/${id}/tracks`).set(auth(OWNER)).send({ trackIds: ["t3", "t1"] });
    expect(missing.status).toBe(409);
    const extra = await request(app).put(`/api/playlists/${id}/tracks`).set(auth(OWNER)).send({ trackIds: ["t3", "t1", "t2", "t4"] });
    expect(extra.status).toBe(409);
    const dup = await request(app).put(`/api/playlists/${id}/tracks`).set(auth(OWNER)).send({ trackIds: ["t3", "t3", "t1"] });
    expect(dup.status).toBe(409);
    const bad = await request(app).put(`/api/playlists/${id}/tracks`).set(auth(OWNER)).send({ trackIds: "t1" });
    expect(bad.status).toBe(400);
    const badId = await request(app).put(`/api/playlists/${id}/tracks`).set(auth(OWNER)).send({ trackIds: ["../x"] });
    expect(badId.status).toBe(400);
  });

  it("refuses built-in playlists (403) and other users (404)", async () => {
    expect((await request(app).put("/api/playlists/p-gym/tracks").set(auth(OWNER)).send({ trackIds: [] })).status).toBe(403);
    expect((await request(app).put(`/api/playlists/${id}/tracks`).set(auth(OTHER)).send({ trackIds: ["t3", "t1", "t2"] })).status).toBe(404);
  });
});

describe("PATCH /api/playlists/:id (description)", () => {
  it("sets, keeps line breaks, and clears the description", async () => {
    const set = await request(app).patch(`/api/playlists/${id}`).set(auth(OWNER)).send({ description: "  Songs for\r\nthe highway \u0007 " });
    expect(set.status).toBe(200);
    expect(set.body.description).toBe("Songs for\nthe highway");
    expect(set.body.name).toBe("Road trip");
    const both = await request(app).patch(`/api/playlists/${id}`).set(auth(OWNER)).send({ name: "Road  trip 2", description: "x" });
    expect(both.body).toMatchObject({ name: "Road trip 2", description: "x" });
    const cleared = await request(app).patch(`/api/playlists/${id}`).set(auth(OWNER)).send({ description: null });
    expect(cleared.body.description).toBe("");
    await sleep(600);
    expect(fb.getAt(`users/owner1/playlists/${id}/description`)).toBeNull();
  });

  it("validates input", async () => {
    expect((await request(app).patch(`/api/playlists/${id}`).set(auth(OWNER)).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/playlists/${id}`).set(auth(OWNER)).send({ description: 5 })).status).toBe(400);
    expect((await request(app).patch(`/api/playlists/${id}`).set(auth(OWNER)).send({ description: "x".repeat(301) })).status).toBe(400);
    expect((await request(app).patch(`/api/playlists/${id}`).set(auth(OWNER)).send({ name: "" })).status).toBe(400);
  });
});

describe("public sharing", () => {
  let shareId = "";

  it("turns a public link on (idempotent) and stores sharedPlaylists/{shareId} server-side", async () => {
    const on = await request(app).put(`/api/playlists/${id}/share`).set(auth(OWNER));
    expect(on.status).toBe(200);
    shareId = on.body.shareId;
    expect(shareId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    const again = await request(app).put(`/api/playlists/${id}/share`).set(auth(OWNER));
    expect(again.body.shareId).toBe(shareId);
    expect(fb.getAt(`sharedPlaylists/${shareId}`)).toMatchObject({ ownerUid: "owner1", playlistId: id });
  });

  it("lets anyone (guests too) open the read-only playlist", async () => {
    const guest = await request(app).get(`/api/shared/${shareId}`);
    expect(guest.status).toBe(200);
    expect(guest.body).toMatchObject({ name: "Road trip 2", ownerName: "Olga", ownedByYou: false, playlistId: null, trackIds: ["t3", "t1", "t2"] });
    expect(guest.body.tracks).toHaveLength(3);
    expect(JSON.stringify(guest.body)).not.toContain("owner@example.com");
    expect(JSON.stringify(guest.body)).not.toContain("owner1");
    const owner = await request(app).get(`/api/shared/${shareId}`).set(auth(OWNER));
    expect(owner.body).toMatchObject({ ownedByYou: true, playlistId: id });
  });

  it("does not let other users edit through the link", async () => {
    expect((await request(app).post(`/api/playlists/${id}/tracks`).set(auth(OTHER)).send({ trackId: "t9" })).status).toBe(404);
    expect((await request(app).delete(`/api/playlists/${id}/share`).set(auth(OTHER))).status).toBe(404);
  });

  it("answers 404 for unknown / malformed ids", async () => {
    expect((await request(app).get("/api/shared/AAAAAAAAAAAA")).status).toBe(404);
    expect((await request(app).get("/api/shared/x")).status).toBe(404);
    expect((await request(app).get("/api/shared/..%2Fusers")).status).toBe(404);
  });

  it("turns the link off: it then 404s and the index entry is gone", async () => {
    const off = await request(app).delete(`/api/playlists/${id}/share`).set(auth(OWNER));
    expect(off.status).toBe(200);
    expect(off.body.shareId).toBeNull();
    expect((await request(app).get(`/api/shared/${shareId}`)).status).toBe(404);
    expect(fb.getAt(`sharedPlaylists/${shareId}`)).toBeNull();
  });

  it("a stale index entry alone does not expose the playlist", async () => {
    await fb.services.db.update(`sharedPlaylists/STALEstale12`, { ownerUid: "owner1", playlistId: id, createdAt: "x" });
    expect((await request(app).get("/api/shared/STALEstale12")).status).toBe(404);
  });

  it("deleting a shared playlist removes its link", async () => {
    const on = await request(app).put(`/api/playlists/${id}/share`).set(auth(OWNER));
    const sid = on.body.shareId as string;
    expect((await request(app).delete(`/api/playlists/${id}`).set(auth(OWNER))).status).toBe(204);
    expect(fb.getAt(`sharedPlaylists/${sid}`)).toBeNull();
    expect((await request(app).get(`/api/shared/${sid}`)).status).toBe(404);
  });
});
