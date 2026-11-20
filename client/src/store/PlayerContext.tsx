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
import type { Track } from "../types";
import { useLibrary } from "./LibraryContext";

export type RepeatMode = "off" | "all" | "one";

interface PlayerApi {
  current: Track | null;
  queue: string[];
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Make `id` current, using `queue` as the list next/prev move through. */
  playTrack: (id: string, queue?: string[]) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
}

const PlayerContext = createContext<PlayerApi | null>(null);
// Position changes 4×/s; kept in its own context so only progress UI re-renders.
const PositionContext = createContext<number>(0);

const TICK_MS = 250;

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { tracks, lastPlayback } = useLibrary();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");

  const current = currentId ? tracks[currentId] ?? null : null;

  // Restore a "last played" track once the library has loaded.
  useEffect(() => {
    if (currentId || !lastPlayback) return;
    setCurrentId(lastPlayback.trackId);
    setQueue(lastPlayback.queue);
    setPosition(Math.min(lastPlayback.position, lastPlayback.track.duration - 1));
  }, [currentId, lastPlayback]);

  const stateRef = useRef({ currentId, queue, shuffle, repeat, position });
  stateRef.current = { currentId, queue, shuffle, repeat, position };

  const step = useCallback((dir: 1 | -1, auto: boolean) => {
    const { currentId: id, queue: q, shuffle: sh, repeat: rep } = stateRef.current;
    if (q.length === 0) return;
    const idx = Math.max(0, q.indexOf(id ?? ""));
    let nextIdx: number;
    if (sh && q.length > 1) {
      do nextIdx = Math.floor(Math.random() * q.length);
      while (nextIdx === idx);
    } else {
      nextIdx = idx + dir;
      if (nextIdx >= q.length || nextIdx < 0) {
        if (auto && rep === "off") {
          setIsPlaying(false);
          setPosition(0);
          return;
        }
        nextIdx = (nextIdx + q.length) % q.length;
      }
    }
    setCurrentId(q[nextIdx]);
    setPosition(0);
  }, []);

  // Simulated playback clock.
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => setPosition((p) => p + TICK_MS / 1000), TICK_MS);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  // End of track handling.
  useEffect(() => {
    if (!current || position < current.duration) return;
    if (repeat === "one") setPosition(0);
    else step(1, true);
  }, [position, current, repeat, step]);

  const playTrack = useCallback((id: string, list?: string[]) => {
    if (list && list.length) setQueue(list);
    else setQueue((q) => (q.includes(id) ? q : [id]));
    if (stateRef.current.currentId !== id) setPosition(0);
    setCurrentId(id);
    setIsPlaying(true);
  }, []);

  const togglePlay = useCallback(() => {
    if (!stateRef.current.currentId) return;
    setIsPlaying((p) => !p);
  }, []);

  const next = useCallback(() => step(1, false), [step]);
  const prev = useCallback(() => {
    if (stateRef.current.position > 3) setPosition(0);
    else step(-1, false);
  }, [step]);

  const seek = useCallback((s: number) => setPosition(Math.max(0, s)), []);
  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.min(1, Math.max(0, v)));
    setMuted(false);
  }, []);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);
  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);
  const cycleRepeat = useCallback(
    () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")),
    []
  );

  const value = useMemo<PlayerApi>(
    () => ({
      current,
      queue,
      isPlaying,
      volume,
      muted,
      shuffle,
      repeat,
      playTrack,
      togglePlay,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
    }),
    [current, queue, isPlaying, volume, muted, shuffle, repeat, playTrack, togglePlay, next, prev, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat]
  );

  return (
    <PlayerContext.Provider value={value}>
      <PositionContext.Provider value={position}>{children}</PositionContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return ctx;
}

export function usePlaybackPosition(): number {
  return useContext(PositionContext);
}
