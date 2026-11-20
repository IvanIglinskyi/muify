import { describe, expect, it } from "vitest";
import { genreMappings, genresFromMusicInfo } from "../src/jamendo/genres.js";
import {
  jamendoAlbumIdOf,
  jamendoArtistIdOf,
  jamendoTrackIdOf,
  mapAlbum,
  mapArtist,
  mapTrack,
  scrubClientId,
} from "../src/jamendo/map.js";
import type { JamendoAlbum, JamendoArtist, JamendoTrack } from "../src/jamendo/types.js";
import { genreDefs } from "../src/data/genres.js";

const CLIENT = "secretclient42";

const rawTrack: JamendoTrack = {
  id: "1532771",
  name: " Night Drive ",
  duration: "245",
  artist_id: "7872",
  artist_name: "Some Artist",
  album_name: "Highway",
  album_id: "185006",
  license_ccurl: "http://creativecommons.org/licenses/by-nc-sa/3.0/",
  position: 2,
  releasedate: "2019-05-01",
  album_image: "https://usercontent.jamendo.com?type=album&id=185006&width=300",
  audio: `https://prod-1.storage.jamendo.com/?trackid=1532771&format=mp31&from=app-${CLIENT}`,
  shareurl: "https://www.jamendo.com/track/1532771",
  image: `https://usercontent.jamendo.com?type=album&id=185006&width=300&from=${CLIENT}`,
  musicinfo: { vocalinstrumental: "instrumental", acousticelectric: "electric", speed: "high", tags: { genres: ["Electronic", "house"], vartags: ["energetic"], instruments: [] } },
};

describe("Jamendo id helpers", () => {
  it("round-trips prefixed ids", () => {
    expect(jamendoTrackIdOf("j123")).toBe("123");
    expect(jamendoAlbumIdOf("ja123")).toBe("123");
    expect(jamendoArtistIdOf("jr123")).toBe("123");
    expect(jamendoTrackIdOf("ja123")).toBeNull();
    expect(jamendoTrackIdOf("jr123")).toBeNull();
    expect(jamendoAlbumIdOf("jr123")).toBeNull();
    expect(jamendoArtistIdOf("sa-anthony")).toBeNull();
    expect(jamendoArtistIdOf("jr12345678901234")).toBeNull(); // too long
  });
});

describe("mapTrack", () => {
  const { track, upstreamAudio } = mapTrack(rawTrack, ["party"], CLIENT);

  it("maps fields and ids", () => {
    expect(track).toMatchObject({
      id: "j1532771",
      title: "Night Drive",
      artist: "Some Artist",
      album: "Highway",
      duration: 245,
      source: "jamendo",
      albumId: "ja185006",
      artistId: "jr7872",
      jamendoId: "1532771",
      audioUrl: "/api/tracks/j1532771/stream",
      licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/3.0/",
    });
  });

  it("keeps the client id out of everything sent to browsers", () => {
    expect(upstreamAudio).toContain(CLIENT); // server-side only
    expect(JSON.stringify(track)).not.toContain(CLIENT);
  });

  it("derives genres from musicinfo plus the query genre", () => {
    expect(track.genres).toEqual(expect.arrayContaining(["party", "electronic", "energy"]));
  });

  it("tolerates missing / odd fields", () => {
    const { track: t } = mapTrack({ ...rawTrack, name: "", artist_name: "", album_id: "0", artist_id: "0", duration: "x", audio: "" });
    expect(t.title).toBe("Untitled");
    expect(t.artist).toBe("Unknown artist");
    expect(t.albumId).toBeUndefined();
    expect(t.artistId).toBeUndefined();
    expect(t.duration).toBe(0);
    expect(t.audioUrl).toBeUndefined();
  });
});

describe("mapAlbum / mapArtist", () => {
  const rawAlbum: JamendoAlbum = {
    id: "185006",
    name: "Highway",
    releasedate: "2019-05-01",
    artist_id: "7872",
    artist_name: "Some Artist",
    image: "https://usercontent.jamendo.com?type=album&id=185006&width=500",
    tracks: [
      { id: "2", position: "2", name: "B", duration: "100", license_ccurl: "", audio: "https://x.test/2" },
      { id: "1", position: "1", name: "A", duration: "50", license_ccurl: "", audio: "https://x.test/1" },
    ],
  };

  it("sorts tracks by position, sums durations, carries the artist id", () => {
    const { album, tracks } = mapAlbum(rawAlbum, ["rock"]);
    expect(album).toMatchObject({ id: "ja185006", year: 2019, trackCount: 2, duration: 150, trackIds: ["j1", "j2"], artistId: "jr7872", genres: ["rock"] });
    expect(tracks.map((t) => t.track.artistId)).toEqual(["jr7872", "jr7872"]);
    expect(tracks[0].track.albumId).toBe("ja185006");
  });

  it("maps an artist and scrubs the client id", () => {
    const raw: JamendoArtist = {
      id: "7872",
      name: "Some Artist",
      website: "http://example.org/band",
      joindate: "2011-12-29",
      image: `https://usercontent.jamendo.com?type=artist&id=7872&width=300&cid=${CLIENT}`,
      shareurl: "https://www.jamendo.com/artist/7872",
    };
    const a = mapArtist(raw, CLIENT);
    expect(a).toMatchObject({ id: "jr7872", name: "Some Artist", source: "jamendo", joinDate: "2011-12-29", website: "http://example.org/band", shareUrl: "https://www.jamendo.com/artist/7872" });
    expect(JSON.stringify(a)).not.toContain(CLIENT);
    expect(mapArtist({ id: "1", name: "", joindate: "yesterday" }).joinDate).toBeUndefined();
  });

  it("scrubClientId leaves other URLs alone", () => {
    expect(scrubClientId("https://a.test/x?q=1", CLIENT)).toBe("https://a.test/x?q=1");
    expect(scrubClientId(`https://a.test/x?id=${CLIENT}&q=1`, CLIENT)).toBe("https://a.test/x?q=1");
  });
});

describe("genre mapping", () => {
  it("has a Jamendo query for every genre/mood tile", () => {
    for (const g of genreDefs) expect(genreMappings[g.id], g.id).toBeDefined();
  });

  it("maps musicinfo tags and filters to our ids", () => {
    expect(genresFromMusicInfo(undefined)).toEqual([]);
    expect(genresFromMusicInfo({ tags: { genres: ["HipHop"], vartags: ["sad"] } })).toEqual(expect.arrayContaining(["hip-hop", "melancholy"]));
    expect(genresFromMusicInfo({ acousticelectric: "acoustic", tags: {} })).toContain("acoustic");
    expect(genresFromMusicInfo({ speed: "veryhigh", tags: {} })).toContain("energy");
    expect(genresFromMusicInfo({ speed: "low", tags: { genres: ["classical"] } })).toEqual(["focus"]);
  });
});
