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

interface LibraryState {
  loading: boolean;
  error: string | null;
  /** Single source of truth for tracks, so likes stay in sync everywhere. */
  tracks: Record<string, Track>;
  recentIds: string[];
  dailyMixIds: string[];
  albumOfTheDay: Album | null;
  weekAlbums: Album[];
  playlists: Playlist[];
  stats: Stats | null;
  lastPlayback: PlaybackState | null;
}

interface LibraryApi extends LibraryState {
  toggleTrackLike: (id: string) => void;
  toggleAlbumLike: (id: string) => void;
  loadPlaylistTracks: (id: string) => Promise<string[]>;
  dismissError: () => void;
}

const LibraryContext = createContext<LibraryApi | null>(null);

const initialState: LibraryState = {
  loading: true,
  error: null,
  tracks: {},
  recentIds: [],
  dailyMixIds: [],
  albumOfTheDay: null,
  weekAlbums: [],
  playlists: [],
  stats: null,
  lastPlayback: null,
};

function indexTracks(list: Track[], into: Record<string, Track> = {}): Record<string, Track> {
  const next = { ...into };
  for (const t of list) next[t.id] = t;
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
    ])
      .then(([day, week, playlists, recent, mix, stats, last]) => {
        if (cancelled) return;
        const all = [...day.tracks, ...week.flatMap((a) => a.tracks), ...recent, ...mix, last.track];
        setState({
          loading: false,
          error: null,
          tracks: indexTracks(all),
          recentIds: recent.map((t) => t.id),
          dailyMixIds: mix.map((t) => t.id),
          albumOfTheDay: stripTracks(day),
          weekAlbums: week.map(stripTracks),
          playlists,
          stats,
          lastPlayback: last,
        });
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
          p.id === "p-favourites"
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
      const flip = (a: Album) => (a.id === id ? { ...a, liked } : a);
      const current =
        s.albumOfTheDay?.id === id ? s.albumOfTheDay : s.weekAlbums.find((a) => a.id === id);
      if (!current || current.liked === liked) return s;
      return {
        ...s,
        albumOfTheDay: s.albumOfTheDay ? flip(s.albumOfTheDay) : null,
        weekAlbums: s.weekAlbums.map(flip),
        stats: s.stats ? { ...s.stats, likes: s.stats.likes + (liked ? 1 : -1) } : s.stats,
      };
    });
  }, []);

  const toggleAlbumLike = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const album = s.albumOfTheDay?.id === id ? s.albumOfTheDay : s.weekAlbums.find((a) => a.id === id);
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

  const loadPlaylistTracks = useCallback(async (id: string) => {
    const list = await api.getPlaylistTracks(id);
    // Keep locally known like state (it may be ahead of an in-flight PATCH).
    setState((s) => ({
      ...s,
      tracks: indexTracks(
        list.filter((t) => !s.tracks[t.id]),
        s.tracks
      ),
    }));
    return list.map((t) => t.id);
  }, []);

  const dismissError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  const value = useMemo<LibraryApi>(
    () => ({ ...state, toggleTrackLike, toggleAlbumLike, loadPlaylistTracks, dismissError }),
    [state, toggleTrackLike, toggleAlbumLike, loadPlaylistTracks, dismissError]
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryApi {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside <LibraryProvider>");
  return ctx;
}
