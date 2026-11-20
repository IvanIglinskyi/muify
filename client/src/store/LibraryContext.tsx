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
}

interface LibraryApi extends Omit<LibraryState, "albumOfTheDayId" | "weekAlbumIds"> {
  albumOfTheDay: Album | null;
  weekAlbums: Album[];
  /** Liked albums, live. */
  likedAlbums: Album[];
  /** Liked track ids in like order (mirrors the Favourites playlist), live. */
  likedTrackIds: string[];
  toggleTrackLike: (id: string) => void;
  toggleAlbumLike: (id: string) => void;
  loadPlaylistTracks: (id: string) => Promise<string[]>;
  /** Adds tracks fetched elsewhere (Explore, search…) to the shared index; returns their ids. */
  mergeTracks: (list: Track[]) => string[];
  /** Adds albums (and their tracks) to the shared index; returns their ids. */
  mergeAlbums: (list: AlbumWithTracks[]) => string[];
  dismissError: () => void;
  /** Shows a message in the app toast (e.g. playback errors). */
  notify: (message: string) => void;
}

const LibraryContext = createContext<LibraryApi | null>(null);

const initialState: LibraryState = {
  loading: true,
  error: null,
  tracks: {},
  albums: {},
  albumOfTheDayId: null,
  weekAlbumIds: [],
  recentIds: [],
  dailyMixIds: [],
  playlists: [],
  stats: null,
  lastPlayback: null,
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
        const allTracks = [...allAlbums.flatMap((a) => a.tracks), ...recent, ...mix, ...likedTracks, last.track];
        // Merge (not replace): a page such as Explore may already have added items to the index.
        setState((s) => ({
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

  const toggleTrackLike = useCallback(
    (id: string) => {
      const track = stateRef.current.tracks[id];
      if (!track) return;
      const liked = !track.liked;
      applyTrackLike(id, liked); // optimistic
      api.likeTrack(id, liked).catch((e: Error) => {
        applyTrackLike(id, !liked); // roll back
        setState((s) => ({ ...s, error: `Could not update like: ${e.message}` }));
      });
    },
    [applyTrackLike]
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
        setState((st) => ({ ...st, error: `Could not update like: ${e.message}` }));
      });
    },
    [applyAlbumLike]
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

  const dismissError = useCallback(() => setState((s) => ({ ...s, error: null })), []);
  const notify = useCallback((message: string) => setState((s) => ({ ...s, error: message })), []);

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
      toggleTrackLike,
      toggleAlbumLike,
      loadPlaylistTracks,
      mergeTracks,
      mergeAlbums,
      dismissError,
      notify,
    };
  }, [state, toggleTrackLike, toggleAlbumLike, loadPlaylistTracks, mergeTracks, mergeAlbums, dismissError, notify]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryApi {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside <LibraryProvider>");
  return ctx;
}
