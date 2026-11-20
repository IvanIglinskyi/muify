import { describe, expect, it } from "vitest";
import { buildProfile, hashString, MIN_SIGNALS, pickMix, profileSignature, recentlyPlayed, scoreTrack, seededShuffle } from "../src/recommend.js";
import type { Track } from "../src/types.js";

const t = (id: string, artist: string, genres: string[], artistId?: string): Track => ({
  id,
  title: id,
  artist,
  album: "x",
  duration: 200,
  liked: false,
  genres,
  plays: 0,
  source: "seed",
  artistId,
});

const catalogue = [
  t("a1", "Ann", ["jazz", "romance"], "sa-ann"),
  t("a2", "Ann", ["jazz"], "sa-ann"),
  t("a3", "Ann", ["jazz"], "sa-ann"),
  t("a4", "Ann", ["jazz"], "sa-ann"),
  t("b1", "Bob", ["rock"], "sa-bob"),
  t("c1", "Cy", ["jazz", "chill"], "sa-cy"),
  t("c2", "Cy", ["pop"], "sa-cy"),
  t("d1", "Di", ["pop"], "sa-di"),
];

describe("buildProfile", () => {
  it("weights liked artists and genres above plays", () => {
    const p = buildProfile({
      likedTracks: [catalogue[0]],
      likedAlbums: [],
      plays: [{ track: catalogue[4], seconds: 200 }],
    });
    expect(p.artists[0].name).toBe("Ann");
    expect(p.genres[0].id).toBe("jazz");
    expect(p.likedArtists.map((a) => a.name)).toEqual(["Ann"]);
    expect(p.signals).toBe(2);
    expect(p.signals).toBeLessThan(MIN_SIGNALS);
  });

  it("has a stable signature", () => {
    const input = { likedTracks: [catalogue[0], catalogue[5]], likedAlbums: [], plays: [] };
    expect(profileSignature(buildProfile(input))).toBe(profileSignature(buildProfile(input)));
  });
});

describe("pickMix", () => {
  const p = buildProfile({ likedTracks: [catalogue[0], catalogue[5]], likedAlbums: [], plays: [] });

  it("ranks matching tracks, excludes recent ones, caps per artist, is deterministic per seed", () => {
    const opts = { exclude: new Set(["c1"]), seed: hashString("user:20000"), size: 10, perArtist: 2 };
    const mix = pickMix(catalogue, p, opts);
    const ids = mix.map((x) => x.id);
    expect(ids).not.toContain("c1");
    expect(ids).not.toContain("b1"); // rock: no match at all
    expect(ids.filter((id) => id.startsWith("a"))).toHaveLength(2);
    expect(pickMix(catalogue, p, opts).map((x) => x.id)).toEqual(ids);
    expect(scoreTrack(catalogue[1], p)).toBeGreaterThan(scoreTrack(catalogue[6], p));
  });
});

describe("helpers", () => {
  it("seededShuffle is a deterministic permutation", () => {
    const list = Array.from({ length: 20 }, (_, i) => i);
    const a = seededShuffle(list, 42);
    expect(a).toEqual(seededShuffle(list, 42));
    expect([...a].sort((x, y) => x - y)).toEqual(list);
    expect(seededShuffle(list, 43)).not.toEqual(a);
  });

  it("hashString differs per user and day", () => {
    expect(hashString("u1:1")).not.toBe(hashString("u2:1"));
    expect(hashString("u1:1")).not.toBe(hashString("u1:2"));
  });

  it("recentlyPlayed returns the newest distinct ids", () => {
    const h = ["a", "b", "a", "c", "d"].map((trackId) => ({ trackId }));
    expect([...recentlyPlayed(h, 3)]).toEqual(["d", "c", "a"]);
  });
});
