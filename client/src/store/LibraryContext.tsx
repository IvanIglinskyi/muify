import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../api";
import { tt, type MessageKey } from "../i18n/core";
import { failedText } from "../lib/errors";
import { playlistName } from "../lib/names";
import { useAuth } from "./AuthContext";
import type { Album, AlbumWithTracks, Artist, FollowedArtist, PlaybackState, Playlist, Recommendations, Stats, Track } from "../types";

export const FAVOURITES_ID = "p-favourites";

/** Recommendations are refetched this long after the last like/unlike (bursts of likes = one request). */
export const RECS_REFRESH_DEBOUNCE_MS = 1500;

interface LibraryState {
  loading: boolean;
  error: string | null;
  /** Non-error feedback ("Added to …"), shown in a short-lived toast. */
  info: string | null;
  /** Single source of truth for tracks, so likes stay in sync everywhere. */
  tracks: Record<string, Track>;
  /** Single source of truth for albums (insertion-ordered). */
  albums: Record<string, Album>;
  albumOfTheDayId: string | null;
  weekAlbumIds: string[];
  recentIds: string[];
  dailyMixIds: string[];
  /** Daily Mix built from the listener's taste (false: the generic mix). */
  mixPersonalised: boolean;
  /** Artist names the personal mix is based on. */
  mixBasedOn: string[];
  /** "Because you liked <artist>" row (null when there isn't enough data). */
  because: { artist: { id: string | null; name: string }; trackIds: string[] } | null;
  playlists: Playlist[];
  /** The listener's own totals (null for guests / while loading). */
  stats: Stats | null;
  lastPlayback: PlaybackState | null;
  /** Identity (`useAuth().identityKey`) `lastPlayback` belongs to. */
  lastPlaybackFor: string | null;
  /** Bumped whenever the play history changes (pages showing history/stats refetch). */
  historyVersion: number;
  /** Followed artists, most recent first (empty for guests). */
  follows: FollowedArtist[];
  /** Bumped when likes change (recommendations are refetched, debounced). */
  tasteVersion: number;
}

interface LibraryApi extends Omit<LibraryState, "albumOfTheDayId" | "weekAlbumIds" | "tasteVersion"> {
  albumOfTheDay: Album | null;
  weekAlbums: Album[];
  /** Liked albums, live. */
  likedAlbums: Album[];
  /** Liked track ids in like order (mirrors the Favourites playlist), live. */
  likedTrackIds: string[];
  /** Playlists the listener created (editable). */
  userPlaylists: Playlist[];
  toggleTrackLike: (id: string) => void;
  toggleAlbumLike: (id: string) => void;
  loadPlaylistTracks: (id: string) => Promise<string[]>;
  /** Adds tracks fetched elsewhere (Explore, search…) to the shared index; returns their ids. */
  mergeTracks: (list: Track[]) => string[];
  /** Adds albums (and their tracks) to the shared index; returns their ids. */
  mergeAlbums: (list: AlbumWithTracks[]) => string[];
  createPlaylist: (name: string, trackIds?: string[]) => Promise<Playlist | null>;
  renamePlaylist: (id: string, name: string) => Promise<boolean>;
  deletePlaylist: (id: string) => Promise<boolean>;
  addToPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  /** Changes the description of a user playlist ("" clears it). */
  setPlaylistDescription: (id: string, description: string) => Promise<boolean>;
  /** New track order of a user playlist (optimistic; rolled back on failure). */
  reorderPlaylist: (id: string, trackIds: string[]) => Promise<void>;
  /** Turns the public read-only link on/off. Returns the updated playlist or null. */
  setPlaylistShared: (id: string, shared: boolean) => Promise<Playlist | null>;
  isFollowing: (artistId: string) => boolean;
  /** Follows / unfollows (optimistic). Guests get the sign-in nudge. */
  toggleFollow: (artist: Pick<Artist, "id" | "name" | "imageUrl" | "source">) => Promise<void>;
  /** Called by the player after a play was reported: refreshes Recent Plays & history views. */
  historyChanged: () => void;
  clearHistory: () => Promise<boolean>;
  dismissError: () => void;
  dismissInfo: () => void;
  /** Shows a message in the error toast (e.g. playback errors). Already localised text. */
  notify: (message: string) => void;
  /** Shows a short confirmation toast. Already localised text. */
  notifyInfo: (message: string) => void;
}

const LibraryContext = createContext<LibraryApi | null>(null);

const initialState: LibraryState = {
  loading: true,
  error: null,
  info: null,
  tracks: {},
  albums: {},
  albumOfTheDayId: null,
  weekAlbumIds: [],
  recentIds: [],
  dailyMixIds: [],
  mixPersonalised: false,
  mixBasedOn: [],
  because: null,
  playlists: [],
  stats: null,
  lastPlayback: null,
  lastPlaybackFor: null,
  historyVersion: 0,
  follows: [],
  tasteVersion: 0,
};

/**
 * Adds items to an index. Items already known locally are kept as-is: local like state can
 * be ahead of the server while a PATCH is in flight.
 */
function addNew<T extends { id: string }>(index: Record<string, T>, list: T[]): Record<string, T> {
  const fresh = list.filter((x) => !index[x.id]);
  if (fresh.length === 0) return index;
  const next = { ...index };
  for (const x of fresh) next[x.id] = x;
  return next;
}

/** Sets `liked` from `liked` for every indexed item (keeps object identity when unchanged). */
function relike<T extends { id: string; liked: boolean }>(index: Record<string, T>, liked: Set<string>): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [id, x] of Object.entries(index)) {
    const l = liked.has(id);
    if (x.liked !== l) changed = true;
    next[id] = x.liked === l ? x : { ...x, liked: l };
  }
  return changed ? next : index;
}

function stripTracks({ tracks: _t, ...album }: AlbumWithTracks): Album {
  return album;
}

/** State fields derived from GET /api/recommendations. */
function recsState(recs: Recommendations) {
  const because = recs.becauseYouLiked;
  return {
    dailyMixIds: recs.dailyMix.tracks.map((t) => t.id),
    mixPersonalised: recs.dailyMix.personalised,
    mixBasedOn: recs.dailyMix.basedOn,
    because: because ? { artist: because.artist, trackIds: because.tracks.map((t) => t.id) } : null,
  };
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { identityKey, requireSignIn } = useAuth();
  const [state, setState] = useState<LibraryState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Identity the data on screen belongs to (likes etc. are re-applied when it changes). */
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (identityKey === null) return; // wait until we know who is listening
    let cancelled = false;
    const switching = loadedForRef.current !== null && loadedForRef.current !== identityKey;
    loadedForRef.current = identityKey;
    if (switching) {
      // Another listener (sign-in / sign-out): drop the previous user's data from the UI at once.
      setState((s) => ({
        ...s,
        loading: true,
        tracks: Object.fromEntries(Object.entries(s.tracks).map(([id, t]) => [id, t.liked ? { ...t, liked: false } : t])),
        albums: Object.fromEntries(Object.entries(s.albums).map(([id, a]) => [id, a.liked ? { ...a, liked: false } : a])),
        recentIds: [],
        because: null,
        playlists: s.playlists.filter((p) => p.kind !== "user").map((p) => (p.id === FAVOURITES_ID ? { ...p, trackIds: [] } : p)),
        stats: null,
        lastPlayback: null,
        lastPlaybackFor: null,
        historyVersion: s.historyVersion + 1,
        follows: [],
      }));
    }
    const member = identityKey !== "guest";
    Promise.all([
      api.getAlbumOfTheDay(),
      api.getWeekAlbums(),
      api.getPlaylists(),
      api.getRecentTracks(),
      api.getRecommendations(),
      member ? api.getStats() : Promise.resolve(null),
      api.getLastPlayback(),
      api.getTracks({ liked: true }),
      api.getAlbums({ liked: true }),
      member ? api.getFollows().catch(() => [] as FollowedArtist[]) : Promise.resolve([] as FollowedArtist[]),
    ])
      .then(([day, week, playlists, recent, recs, stats, last, likedTracks, likedAlbums, follows]) => {
        if (cancelled) return;
        const mix = recs.dailyMix.tracks;
        const because = recs.becauseYouLiked;
        const allAlbums = [day, ...week, ...likedAlbums];
        const allTracks = [
          ...allAlbums.flatMap((a) => a.tracks),
          ...recent,
          ...mix,
          ...(because?.tracks ?? []),
          ...likedTracks,
          last.track,
          ...last.queueTracks,
        ];
        // Merge (not replace): a page such as Explore may already have added items to the index.
        // Like flags of everything already indexed are re-derived for the current listener.
        const likedT = new Set(likedTracks.map((t) => t.id));
        const likedA = new Set(likedAlbums.map((a) => a.id));
        setState((s) => ({
          ...s,
          loading: false,
          error: null,
          tracks: addNew(relike(s.tracks, likedT), allTracks),
          albums: addNew(relike(s.albums, likedA), allAlbums.map(stripTracks)),
          albumOfTheDayId: day.id,
          weekAlbumIds: week.map((a) => a.id),
          recentIds: recent.map((t) => t.id),
          ...recsState(recs),
          playlists,
          stats,
          lastPlayback: last,
          lastPlaybackFor: identityKey,
          follows,
        }));
      })
      .catch((e: Error) => {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: failedText("lib.err.load", e) }));
      });
    return () => {
      cancelled = true;
    };
  }, [identityKey]);

  const notify = useCallback((message: string) => setState((s) => ({ ...s, error: message })), []);
  const notifyInfo = useCallback((message: string) => setState((s) => ({ ...s, info: message })), []);
  const fail = useCallback((what: MessageKey) => (e: unknown) => notify(failedText(what, e)), [notify]);

  // ---- Recommendations follow the listener's taste ----
  // Likes change the personal Daily Mix / "Because you liked" on the server (its per-user cache is
  // invalidated); refetch once the listener stops clicking hearts for a moment.
  const tasteVersion = state.tasteVersion;
  useEffect(() => {
    if (tasteVersion === 0) return;
    const forId = loadedForRef.current;
    const timer = window.setTimeout(() => {
      api
        .getRecommendations()
        .then((recs) => {
          if (loadedForRef.current !== forId) return;
          const list = [...recs.dailyMix.tracks, ...(recs.becauseYouLiked?.tracks ?? [])];
          setState((s) => ({ ...s, tracks: addNew(s.tracks, list), ...recsState(recs) }));
        })
        .catch(() => {
          /* keep the current mix */
        });
    }, RECS_REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [tasteVersion]);

  /** Applies a like flip locally (track + Favourites playlist + Likes stat). */
  const applyTrackLike = useCallback((id: string, liked: boolean) => {
    setState((s) => {
      const track = s.tracks[id];
      if (!track || track.liked === liked) return s;
      return {
        ...s,
        tracks: { ...s.tracks, [id]: { ...track, liked } },
        playlists: s.playlists.map((p) =>
          p.id === FAVOURITES_ID
            ? { ...p, trackIds: liked ? [...p.trackIds, id] : p.trackIds.filter((x) => x !== id) }
            : p
        ),
        stats: s.stats ? { ...s.stats, likes: s.stats.likes + (liked ? 1 : -1) } : s.stats,
      };
    });
  }, []);

  const bumpTaste = useCallback(() => setState((s) => ({ ...s, tasteVersion: s.tasteVersion + 1 })), []);

  const setTrackLike = useCallback(
    (id: string, liked: boolean) => {
      const track = stateRef.current.tracks[id];
      if (!track || track.liked === liked) return Promise.resolve();
      if (!requireSignIn("signin.what.favourites")) return Promise.resolve();
      applyTrackLike(id, liked); // optimistic
      return api.likeTrack(id, liked).then(
        () => bumpTaste(),
        (e: Error) => {
          applyTrackLike(id, !liked); // roll back
          fail("lib.err.like")(e);
        }
      );
    },
    [applyTrackLike, fail, requireSignIn, bumpTaste]
  );

  const toggleTrackLike = useCallback(
    (id: string) => {
      const track = stateRef.current.tracks[id];
      if (track) void setTrackLike(id, !track.liked);
    },
    [setTrackLike]
  );

  const applyAlbumLike = useCallback((id: string, liked: boolean) => {
    setState((s) => {
      const album = s.albums[id];
      if (!album || album.liked === liked) return s;
      return {
        ...s,
        albums: { ...s.albums, [id]: { ...album, liked } },
        stats: s.stats ? { ...s.stats, likes: s.stats.likes + (liked ? 1 : -1) } : s.stats,
      };
    });
  }, []);

  const toggleAlbumLike = useCallback(
    (id: string) => {
      const album = stateRef.current.albums[id];
      if (!album) return;
      if (!requireSignIn("signin.what.albums")) return;
      const liked = !album.liked;
      applyAlbumLike(id, liked);
      api.likeAlbum(id, liked).then(
        () => bumpTaste(),
        (e: Error) => {
          applyAlbumLike(id, !liked);
          fail("lib.err.like")(e);
        }
      );
    },
    [applyAlbumLike, fail, requireSignIn, bumpTaste]
  );

  const mergeTracks = useCallback((list: Track[]) => {
    setState((s) => {
      const tracks = addNew(s.tracks, list);
      return tracks === s.tracks ? s : { ...s, tracks };
    });
    return list.map((t) => t.id);
  }, []);

  const mergeAlbums = useCallback((list: AlbumWithTracks[]) => {
    setState((s) => {
      const tracks = addNew(s.tracks, list.flatMap((a) => a.tracks));
      const albums = addNew(s.albums, list.map(stripTracks));
      return tracks === s.tracks && albums === s.albums ? s : { ...s, tracks, albums };
    });
    return list.map((a) => a.id);
  }, []);

  const loadPlaylistTracks = useCallback(
    async (id: string) => mergeTracks(await api.getPlaylistTracks(id)),
    [mergeTracks]
  );

  // ---- User playlists ----

  const putPlaylist = useCallback((p: Playlist) => {
    setState((s) => ({ ...s, playlists: s.playlists.map((x) => (x.id === p.id ? p : x)) }));
  }, []);

  const createPlaylist = useCallback(
    async (name: string, trackIds: string[] = []) => {
      if (!requireSignIn("signin.what.playlists")) return null;
      try {
        const p = await api.createPlaylist({ name, trackIds });
        setState((s) => ({ ...s, playlists: [...s.playlists, p] }));
        notifyInfo(tt(trackIds.length ? "lib.createdWithTrack" : "lib.created", { name: p.name }));
        return p;
      } catch (e) {
        fail("lib.err.create")(e);
        return null;
      }
    },
    [notifyInfo, fail, requireSignIn]
  );

  const renamePlaylist = useCallback(
    async (id: string, name: string) => {
      try {
        putPlaylist(await api.renamePlaylist(id, name));
        return true;
      } catch (e) {
        fail("lib.err.rename")(e);
        return false;
      }
    },
    [putPlaylist, fail]
  );

  const deletePlaylist = useCallback(
    async (id: string) => {
      const p = stateRef.current.playlists.find((x) => x.id === id);
      const name = p ? playlistName(p) : tt("library.playlist");
      try {
        await api.deletePlaylist(id);
        setState((s) => ({ ...s, playlists: s.playlists.filter((x) => x.id !== id) }));
        notifyInfo(tt("lib.deleted", { name }));
        return true;
      } catch (e) {
        fail("lib.err.delete")(e);
        return false;
      }
    },
    [notifyInfo, fail]
  );

  const addToPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      if (playlistId === FAVOURITES_ID) return setTrackLike(trackId, true);
      if (!requireSignIn("signin.what.savePlaylists")) return;
      const p = stateRef.current.playlists.find((x) => x.id === playlistId);
      if (!p) return;
      if (p.trackIds.includes(trackId)) {
        notifyInfo(tt("lib.alreadyIn", { name: playlistName(p) }));
        return;
      }
      putPlaylist({ ...p, trackIds: [...p.trackIds, trackId] }); // optimistic
      try {
        putPlaylist(await api.addToPlaylist(playlistId, trackId));
        notifyInfo(tt("lib.addedTo", { name: playlistName(p) }));
      } catch (e) {
        const now = stateRef.current.playlists.find((x) => x.id === playlistId);
        if (now) putPlaylist({ ...now, trackIds: now.trackIds.filter((x) => x !== trackId) });
        fail("lib.err.add")(e);
      }
    },
    [setTrackLike, putPlaylist, notifyInfo, fail, requireSignIn]
  );

  const removeFromPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      if (playlistId === FAVOURITES_ID) return setTrackLike(trackId, false);
      const p = stateRef.current.playlists.find((x) => x.id === playlistId);
      if (!p) return;
      putPlaylist({ ...p, trackIds: p.trackIds.filter((x) => x !== trackId) }); // optimistic
      try {
        putPlaylist(await api.removeFromPlaylist(playlistId, trackId));
        notifyInfo(tt("lib.removedFrom", { name: playlistName(p) }));
      } catch (e) {
        putPlaylist(p);
        fail("lib.err.remove")(e);
      }
    },
    [setTrackLike, putPlaylist, notifyInfo, fail]
  );

  const setPlaylistDescription = useCallback(
    async (id: string, description: string) => {
      try {
        putPlaylist(await api.updatePlaylist(id, { description }));
        notifyInfo(tt(description ? "lib.descriptionSaved" : "lib.descriptionRemoved"));
        return true;
      } catch (e) {
        fail("lib.err.description")(e);
        return false;
      }
    },
    [putPlaylist, notifyInfo, fail]
  );

  const reorderPlaylist = useCallback(
    async (id: string, trackIds: string[]) => {
      const p = stateRef.current.playlists.find((x) => x.id === id);
      if (!p || p.kind !== "user") return;
      putPlaylist({ ...p, trackIds }); // optimistic
      try {
        putPlaylist(await api.reorderPlaylist(id, trackIds));
      } catch (e) {
        putPlaylist(p);
        fail("lib.err.reorder")(e);
      }
    },
    [putPlaylist, fail]
  );

  const setPlaylistShared = useCallback(
    async (id: string, shared: boolean) => {
      try {
        const p = await (shared ? api.sharePlaylist(id) : api.unsharePlaylist(id));
        putPlaylist(p);
        notifyInfo(tt(shared ? "lib.shareOn" : "lib.shareOff"));
        return p;
      } catch (e) {
        fail(shared ? "lib.err.shareOn" : "lib.err.shareOff")(e);
        return null;
      }
    },
    [putPlaylist, notifyInfo, fail]
  );

  // ---- Following artists ----

  const isFollowing = useCallback((artistId: string) => stateRef.current.follows.some((f) => f.id === artistId), []);

  const toggleFollow = useCallback(
    async (artist: Pick<Artist, "id" | "name" | "imageUrl" | "source">) => {
      if (!requireSignIn("signin.what.follow")) return;
      const before = stateRef.current.follows;
      const following = before.some((f) => f.id === artist.id);
      // Optimistic.
      setState((s) => ({
        ...s,
        follows: following
          ? s.follows.filter((f) => f.id !== artist.id)
          : [{ id: artist.id, name: artist.name, imageUrl: artist.imageUrl, source: artist.source, followedAt: new Date().toISOString() }, ...s.follows],
      }));
      try {
        if (following) {
          await api.unfollowArtist(artist.id);
          notifyInfo(tt("lib.unfollowed", { name: artist.name }));
        } else {
          const r = await api.followArtist(artist.id);
          const saved = r.artist;
          if (saved) setState((s) => ({ ...s, follows: s.follows.map((f) => (f.id === saved.id ? saved : f)) }));
          notifyInfo(tt("lib.followed", { name: artist.name }));
        }
      } catch (e) {
        setState((s) => ({ ...s, follows: before }));
        fail("lib.err.follow")(e);
      }
    },
    [requireSignIn, notifyInfo, fail]
  );

  // ---- History ----

  const refreshRecent = useCallback(() => {
    api
      .getRecentTracks()
      .then((recent) => {
        setState((s) => ({ ...s, tracks: addNew(s.tracks, recent), recentIds: recent.map((t) => t.id) }));
      })
      .catch(() => {
        /* keep the current list */
      });
  }, []);

  /** Re-reads the Home statistics (listening time / tracks change with every reported play). */
  const refreshStats = useCallback(() => {
    if (loadedForRef.current === "guest" || loadedForRef.current === null) return;
    const forId = loadedForRef.current;
    api
      .getStats()
      .then((stats) => {
        if (loadedForRef.current === forId) setState((s) => ({ ...s, stats }));
      })
      .catch(() => {
        /* keep the current numbers */
      });
  }, []);

  const historyChanged = useCallback(() => {
    setState((s) => ({ ...s, historyVersion: s.historyVersion + 1 }));
    refreshRecent();
    refreshStats();
  }, [refreshRecent, refreshStats]);

  const clearHistory = useCallback(async () => {
    if (!requireSignIn("signin.what.history")) return false;
    try {
      const { cleared } = await api.clearHistory();
      historyChanged();
      notifyInfo(cleared ? tt("lib.historyCleared", { count: cleared }) : tt("lib.historyEmpty"));
      return true;
    } catch (e) {
      fail("lib.err.clearHistory")(e);
      return false;
    }
  }, [historyChanged, notifyInfo, fail, requireSignIn]);

  const dismissError = useCallback(() => setState((s) => ({ ...s, error: null })), []);
  const dismissInfo = useCallback(() => setState((s) => ({ ...s, info: null })), []);

  const value = useMemo<LibraryApi>(() => {
    const { albumOfTheDayId, weekAlbumIds, tasteVersion: _v, ...rest } = state;
    const albumList = Object.values(state.albums);
    return {
      ...rest,
      albumOfTheDay: albumOfTheDayId ? state.albums[albumOfTheDayId] ?? null : null,
      weekAlbums: weekAlbumIds.map((id) => state.albums[id]).filter(Boolean),
      likedAlbums: albumList.filter((a) => a.liked),
      likedTrackIds:
        state.playlists.find((p) => p.id === FAVOURITES_ID)?.trackIds ??
        Object.values(state.tracks)
          .filter((t) => t.liked)
          .map((t) => t.id),
      userPlaylists: state.playlists.filter((p) => p.kind === "user"),
      toggleTrackLike,
      toggleAlbumLike,
      loadPlaylistTracks,
      mergeTracks,
      mergeAlbums,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addToPlaylist,
      removeFromPlaylist,
      setPlaylistDescription,
      reorderPlaylist,
      setPlaylistShared,
      isFollowing,
      toggleFollow,
      historyChanged,
      clearHistory,
      dismissError,
      dismissInfo,
      notify,
      notifyInfo,
    };
  }, [
    state,
    toggleTrackLike,
    toggleAlbumLike,
    loadPlaylistTracks,
    mergeTracks,
    mergeAlbums,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    setPlaylistDescription,
    reorderPlaylist,
    setPlaylistShared,
    isFollowing,
    toggleFollow,
    historyChanged,
    clearHistory,
    dismissError,
    dismissInfo,
    notify,
    notifyInfo,
  ]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryApi {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside <LibraryProvider>");
  return ctx;
}
