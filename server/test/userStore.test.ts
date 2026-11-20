// RTDB key encoding, patch merging and per-user isolation of the Firebase store (fake RTDB).
import { beforeAll, describe, expect, it } from "vitest";
import { setFirebaseServicesForTesting } from "../src/firebase.js";
import { decodeKey, encodeKey, mergePatch, resetUserStoreForTesting, userStore } from "../src/userStore.js";
import { createFakeFirebase, FORBIDDEN_KEY, sleep } from "./fakeFirebase.js";

describe("encodeKey / decodeKey", () => {
  it("removes every character RTDB forbids and round-trips", () => {
    const weird = ["a.b", "$x", "#1", "[a]", "a/b", "100%", "j123", "u-1a2b", "tab\there", "%2E", "ünï©ødé", ""];
    for (const k of weird) {
      const enc = encodeKey(k);
      expect(FORBIDDEN_KEY.test(enc), k).toBe(false);
      expect(enc).not.toBe("");
      expect(decodeKey(enc)).toBe(k);
    }
  });

  it("leaves ordinary ids unchanged", () => {
    expect(encodeKey("j123")).toBe("j123");
    expect(encodeKey("u-1a2b_C")).toBe("u-1a2b_C");
  });
});

describe("mergePatch", () => {
  it("never produces overlapping paths", () => {
    const p = new Map<string, unknown>();
    mergePatch(p, "player/position", 1);
    mergePatch(p, "player", { trackId: "t1", position: 2 });
    expect([...p.keys()]).toEqual(["player"]);
    mergePatch(p, "player/position", 3);
    expect(p.get("player")).toEqual({ trackId: "t1", position: 3 });
    mergePatch(p, "likes/tracks/t1", 5);
    mergePatch(p, "likes/tracks/t1", null);
    expect(p.get("likes/tracks/t1")).toBeNull();
  });
});

describe("Firebase store per-user isolation", () => {
  const fb = createFakeFirebase();

  beforeAll(() => {
    setFirebaseServicesForTesting(fb.services);
    resetUserStoreForTesting();
  });

  it("keeps each user's state under users/{encoded uid}", async () => {
    const store = userStore();
    expect(store.kind).toBe("firebase");
    const a = await store.get("user.with/odd#chars");
    const b = await store.get("plainB");
    a.setTrackLike("j1.5", true);
    a.savePlaylist({ id: "u-1", name: "A list", trackIds: ["t1"], createdAt: "2024-01-01", updatedAt: "2024-01-01", description: "hi" });
    b.setTrackLike("t2", true);
    await sleep(600);
    await store.flushAll();

    const encA = encodeKey("user.with/odd#chars");
    const treeA = fb.getAt(`users/${encA}`) as Record<string, any>;
    expect(Object.keys(treeA.likes.tracks)).toEqual([encodeKey("j1.5")]);
    expect(treeA.playlists["u-1"]).toMatchObject({ name: "A list", description: "hi" });
    expect(treeA.playlists["u-1"].shareId).toBeUndefined();
    const treeB = fb.getAt("users/plainB") as Record<string, any>;
    expect(Object.keys(treeB.likes.tracks)).toEqual(["t2"]);
    expect(treeB.playlists).toBeUndefined();
    expect(b.state.likedTracks.has("j1.5")).toBe(false);
  });

  it("reloads state (decoded keys) after the in-memory copy is gone", async () => {
    resetUserStoreForTesting();
    const a = await userStore().get("user.with/odd#chars");
    expect([...a.state.likedTracks.keys()]).toEqual(["j1.5"]);
    expect(a.state.playlists[0]).toMatchObject({ id: "u-1", description: "hi" });
  });

  it("resolves public links only while the playlist carries the share id", async () => {
    const store = userStore();
    const doc = await store.get("plainB");
    doc.savePlaylist({ id: "u-9", name: "B", trackIds: [], createdAt: "x", updatedAt: "x", shareId: "Share_ID_123" });
    await store.putShare("Share_ID_123", "plainB", "u-9");
    expect((await store.resolveShare("Share_ID_123"))?.playlist.id).toBe("u-9");
    expect(await store.resolveShare("Unknown_1234")).toBeNull();
    delete doc.state.playlists[0].shareId;
    expect(await store.resolveShare("Share_ID_123")).toBeNull();
    await store.removeShare("Share_ID_123");
    expect(fb.getAt("sharedPlaylists/Share_ID_123")).toBeNull();
  });
});
