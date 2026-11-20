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
import type { Album, AlbumWithTracks, PlaybackState, Playlist, Stats, Track } from "../types";

export const FAVOURITES_ID = "p-favourites";

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
  playlists: Playlist[];
  stats: Stats | null;
  lastPlayback: PlaybackState | null;
  /** Bumped whenever the play history changes (pages showing history/stats refetch). */
  historyVersion: number;
}

interface LibraryApi extends Omit<LibraryState, "albumOfTheDayId" | "weekAlbumIds"> {
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
  /** Called by the player after a play was reported: refreshes Recent Plays & history views. */
  historyChanged: () => void;
  clearHistory: () => Promise<boolean>;
  dismissError: () => void;
  dismissInfo: () => void;
  /** Shows a message in the error toast (e.g. playback errors). */
  notify: (message: string) => void;
  /** Shows a short confirmation toast. */
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
  playlists: [],
  stats: null,
  lastPlayback: null,
  historyVersion: 0,
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

function stripTracks({ tracks: _t, ...album }: AlbumWithTracks): Album {
  return album;
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LibraryState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getAlbumOfTheDay(),
      api.getWeekAlbums(),
      api.getPlaylists(),
      api.getRecentTracks(),
      api.getDailyMix(),
      api.getStats(),
      api.getLastPlayback(),
      api.getTracks({ liked: true }),
      api.getAlbums({ liked: true }),
    ])
      .then(([day, week, playlists, recent, mix, stats, last, likedTracks, likedAlbums]) => {
        if (cancelled) return;
        const allAlbums = [day, ...week, ...likedAlbums];
        const allTracks = [
          ...allAlbums.flatMap((a) => a.tracks),
          ...recent,
          ...mix,
          ...likedTracks,
          last.track,
          ...last.queueTracks,
        ];
        // Merge (not replace): a page such as Explore may already have added items to the index.
        setState((s) => ({
          ...s,
          loading: false,
          error: null,
          tracks: addNew(s.tracks, allTracks),
          albums: addNew(s.albums, allAlbums.map(stripTracks)),
          albumOfTheDayId: day.id,
          weekAlbumIds: week.map((a) => a.id),
          recentIds: recent.map((t) => t.id),
          dailyMixIds: mix.map((t) => t.id),
          playlists,
          stats,
          lastPlayback: last,
        }));
      })
      .catch((e: Error) => {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: e.message }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const notify = useCallback((message: string) => setState((s) => ({ ...s, error: message })), []);
  const notifyInfo = useCallback((message: string) => setState((s) => ({ ...s, info: message })), []);
  const fail = useCallback((what: string) => (e: Error) => notify(`${what}: ${e.message}`), [notify]);

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

  const setTrackLike = useCallback(
    (id: string, liked: boolean) => {
      const track = stateRef.current.tracks[id];
      if (!track || track.liked === liked) return Promise.resolve();
      applyTrackLike(id, liked); // optimistic
      return api.likeTrack(id, liked).then(
        () => undefined,
        (e: Error) => {
          applyTrackLike(id, !liked); // roll back
          notify(`Could not update like: ${e.message}`);
        }
      );
    },
    [applyTrackLike, notify]
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
      const liked = !album.liked;
      applyAlbumLike(id, liked);
      api.likeAlbum(id, liked).catch((e: Error) => {
        applyAlbumLike(id, !liked);
        notify(`Could not update like: ${e.message}`);
      });
    },
    [applyAlbumLike, notify]
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
      try {
        const p = await api.createPlaylist({ name, trackIds });
        setState((s) => ({ ...s, playlists: [...s.playlists, p] }));
        notifyInfo(trackIds.length ? `Created “${p.name}” and added the track` : `Created “${p.name}”`);
        return p;
      } catch (e) {
        fail("Could not create playlist")(e as Error);
        return null;
      }
    },
    [notifyInfo, fail]
  );

  const renamePlaylist = useCallback(
    async (id: string, name: string) => {
      try {
        putPlaylist(await api.renamePlaylist(id, name));
        return true;
      } catch (e) {
        fail("Could not rename playlist")(e as Error);
        return false;
      }
    },
    [putPlaylist, fail]
  );

  const deletePlaylist = useCallback(
    async (id: string) => {
      const name = stateRef.current.playlists.find((p) => p.id === id)?.name ?? "Playlist";
      try {
        await api.deletePlaylist(id);
        setState((s) => ({ ...s, playlists: s.playlists.filter((p) => p.id !== id) }));
        notifyInfo(`Deleted “${name}”`);
        return true;
      } catch (e) {
        fail("Could not delete playlist")(e as Error);
        return false;
      }
    },
    [notifyInfo, fail]
  );

  const addToPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      if (playlistId === FAVOURITES_ID) return setTrackLike(trackId, true);
      const p = stateRef.current.playlists.find((x) => x.id === playlistId);
      if (!p) return;
      if (p.trackIds.includes(trackId)) {
        notifyInfo(`Already in “${p.name}”`);
        return;
      }
      putPlaylist({ ...p, trackIds: [...p.trackIds, trackId] }); // optimistic
      try {
        putPlaylist(await api.addToPlaylist(playlistId, trackId));
        notifyInfo(`Added to “${p.name}”`);
      } catch (e) {
        const now = stateRef.current.playlists.find((x) => x.id === playlistId);
        if (now) putPlaylist({ ...now, trackIds: now.trackIds.filter((x) => x !== trackId) });
        fail("Could not add to playlist")(e as Error);
      }
    },
    [setTrackLike, putPlaylist, notifyInfo, fail]
  );

  const removeFromPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      if (playlistId === FAVOURITES_ID) return setTrackLike(trackId, false);
      const p = stateRef.current.playlists.find((x) => x.id === playlistId);
      if (!p) return;
      putPlaylist({ ...p, trackIds: p.trackIds.filter((x) => x !== trackId) }); // optimistic
      try {
        putPlaylist(await api.removeFromPlaylist(playlistId, trackId));
        notifyInfo(`Removed from “${p.name}”`);
      } catch (e) {
        putPlaylist(p);
        fail("Could not remove from playlist")(e as Error);
      }
    },
    [setTrackLike, putPlaylist, notifyInfo, fail]
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

  const historyChanged = useCallback(() => {
    setState((s) => ({ ...s, historyVersion: s.historyVersion + 1 }));
    refreshRecent();
  }, [refreshRecent]);

  const clearHistory = useCallback(async () => {
    try {
      const { cleared } = await api.clearHistory();
      historyChanged();
      notifyInfo(cleared ? `Cleared ${cleared} play${cleared === 1 ? "" : "s"} from history` : "History is already empty");
      return true;
    } catch (e) {
      fail("Could not clear history")(e as Error);
      return false;
    }
  }, [historyChanged, notifyInfo, fail]);

  const dismissError = useCallback(() => setState((s) => ({ ...s, error: null })), []);
  const dismissInfo = useCallback(() => setState((s) => ({ ...s, info: null })), []);

  const value = useMemo<LibraryApi>(() => {
    const { albumOfTheDayId, weekAlbumIds, ...rest } = state;
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
