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

/** "audio": real stream via HTMLAudioElement; "simulated": timer for tracks without audio (demo catalogue). */
export type PlaybackMode = "audio" | "simulated";

interface PlayerApi {
  current: Track | null;
  queue: string[];
  isPlaying: boolean;
  /** Length of the current track in seconds (from the audio metadata once known). */
  duration: number;
  /** Waiting for audio data (initial load or rebuffering). */
  buffering: boolean;
  mode: PlaybackMode | null;
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
// Position changes ~4×/s; kept in its own context so only progress UI re-renders.
const PositionContext = createContext<number>(0);

/** Simulated clock step for tracks without audio. */
const TICK_MS = 250;

const validDuration = (d: number) => (Number.isFinite(d) && d > 0 ? d : null);

/**
 * Player state + playback engine. The provider sits above the router, and the audio element is
 * created once here (never rendered), so playback survives route changes.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const { tracks, lastPlayback, notify } = useLibrary();
  const [audio] = useState(() => {
    const a = new Audio();
    a.preload = "auto";
    return a;
  });

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [metaDuration, setMetaDuration] = useState<number | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");

  const current = currentId ? tracks[currentId] ?? null : null;
  const src = current?.audioUrl ?? null;
  const mode: PlaybackMode | null = current ? (src ? "audio" : "simulated") : null;
  const duration = (src ? metaDuration : null) ?? current?.duration ?? 0;

  // Restore a "last played" track once the library has loaded (paused).
  useEffect(() => {
    if (currentId || !lastPlayback) return;
    setCurrentId(lastPlayback.trackId);
    setQueue(lastPlayback.queue);
    setPosition(Math.max(0, Math.min(lastPlayback.position, lastPlayback.track.duration - 1)));
  }, [currentId, lastPlayback]);

  const stateRef = useRef({ currentId, current, queue, shuffle, repeat, position, isPlaying, src, duration });
  stateRef.current = { currentId, current, queue, shuffle, repeat, position, isPlaying, src, duration };

  /** Seek target to apply once the new source has metadata. */
  const pendingSeekRef = useRef<number | null>(null);
  /** Consecutive tracks that failed to play (stops auto-skipping through a dead queue). */
  const errorStreakRef = useRef(0);

  const playAudio = useCallback(() => {
    if (audio.error) {
      // A failed source stays failed: reload it (resuming where we were) before retrying.
      pendingSeekRef.current = stateRef.current.position > 0.5 ? stateRef.current.position : null;
      audio.load();
    }
    audio.play().catch((err: DOMException) => {
      // Autoplay blocked (no user gesture yet): reflect it in the UI.
      if (err.name === "NotAllowedError") setIsPlaying(false);
      // AbortError = source changed mid-load (expected); source errors arrive via the "error" event.
    });
  }, [audio]);

  /** Same track from the top (repeat-one, or a one-track queue with repeat-all). */
  const restart = useCallback(() => {
    setPosition(0);
    if (stateRef.current.src) {
      audio.currentTime = 0;
      if (stateRef.current.isPlaying) playAudio();
    }
  }, [audio, playAudio]);

  const step = useCallback(
    (dir: 1 | -1, auto: boolean) => {
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
            // End of the queue: stop and rewind.
            setIsPlaying(false);
            setPosition(0);
            if (stateRef.current.src) audio.currentTime = 0;
            return;
          }
          nextIdx = (nextIdx + q.length) % q.length;
        }
      }
      if (q[nextIdx] === id) {
        restart();
        return;
      }
      setCurrentId(q[nextIdx]);
      setPosition(0);
    },
    [audio, restart]
  );

  // ---- Real audio engine ----

  // Load the source when the track changes (or drop it for simulated tracks).
  useEffect(() => {
    setMetaDuration(null);
    pendingSeekRef.current = null;
    if (!src) {
      if (audio.hasAttribute("src")) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      setBuffering(false);
      return;
    }
    const start = stateRef.current.position;
    pendingSeekRef.current = start > 0.5 ? start : null;
    audio.src = src;
    setBuffering(stateRef.current.isPlaying);
  }, [audio, src]);

  // Play / pause follows `isPlaying` (runs after the load effect above).
  useEffect(() => {
    if (!src) return;
    if (isPlaying) playAudio();
    else audio.pause();
  }, [audio, src, isPlaying, playAudio]);

  useEffect(() => {
    audio.volume = volume;
    audio.muted = muted;
  }, [audio, volume, muted]);

  // Event handlers read the latest state through this ref.
  const handlersRef = useRef({ ended: () => {}, error: () => {} });
  handlersRef.current = {
    ended: () => {
      if (stateRef.current.repeat === "one") restart();
      else step(1, true);
    },
    error: () => {
      if (!audio.hasAttribute("src")) return;
      setBuffering(false);
      const { isPlaying: playing, current: track, queue: q } = stateRef.current;
      if (!playing) return; // preload failure: retried by playAudio() when the user presses play
      const name = track ? `“${track.title}”` : "this track";
      errorStreakRef.current += 1;
      if (q.length <= 1 || errorStreakRef.current >= q.length) {
        errorStreakRef.current = 0;
        setIsPlaying(false);
        notify(`Couldn't play ${name}. Check your connection and try again.`);
        return;
      }
      notify(`Couldn't play ${name} — skipped to the next track.`);
      step(1, true);
    },
  };

  useEffect(() => {
    const listeners: [string, () => void][] = [
      [
        "timeupdate",
        () => {
          if (pendingSeekRef.current === null) setPosition(audio.currentTime);
        },
      ],
      [
        "loadedmetadata",
        () => {
          const d = validDuration(audio.duration);
          if (d) setMetaDuration(d);
          const target = pendingSeekRef.current;
          pendingSeekRef.current = null;
          if (target !== null) audio.currentTime = d ? Math.min(target, d - 0.5) : target;
        },
      ],
      [
        "durationchange",
        () => {
          const d = validDuration(audio.duration);
          if (d) setMetaDuration(d);
        },
      ],
      ["waiting", () => setBuffering(true)],
      ["canplay", () => setBuffering(false)],
      [
        "playing",
        () => {
          setBuffering(false);
          errorStreakRef.current = 0;
        },
      ],
      ["pause", () => setBuffering(false)],
      ["ended", () => handlersRef.current.ended()],
      ["error", () => handlersRef.current.error()],
    ];
    for (const [type, fn] of listeners) audio.addEventListener(type, fn);
    return () => {
      for (const [type, fn] of listeners) audio.removeEventListener(type, fn);
    };
  }, [audio]);

  // Stop the stream if the provider ever unmounts.
  useEffect(
    () => () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
    [audio]
  );

  // ---- Simulated playback (tracks without audio) ----

  useEffect(() => {
    if (!isPlaying || src) return;
    const timer = window.setInterval(() => setPosition((p) => p + TICK_MS / 1000), TICK_MS);
    return () => window.clearInterval(timer);
  }, [isPlaying, src]);

  useEffect(() => {
    if (src || !current || position < current.duration) return;
    if (repeat === "one") setPosition(0);
    else step(1, true);
  }, [position, current, src, repeat, step]);

  // ---- Controls ----

  const playTrack = useCallback((id: string, list?: string[]) => {
    if (list && list.length) setQueue(list);
    else setQueue((q) => (q.includes(id) ? q : [id]));
    if (stateRef.current.currentId !== id) setPosition(0);
    errorStreakRef.current = 0;
    setCurrentId(id);
    setIsPlaying(true);
  }, []);

  const togglePlay = useCallback(() => {
    if (!stateRef.current.currentId) return;
    errorStreakRef.current = 0;
    setIsPlaying((p) => !p);
  }, []);

  const next = useCallback(() => step(1, false), [step]);

  const seek = useCallback(
    (s: number) => {
      const { src: hasAudio, duration: d } = stateRef.current;
      const t = Math.max(0, d > 0 ? Math.min(s, d) : s);
      setPosition(t);
      if (!hasAudio) return;
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) audio.currentTime = t;
      else pendingSeekRef.current = t;
    },
    [audio]
  );

  const prev = useCallback(() => {
    if (stateRef.current.position > 3) seek(0);
    else step(-1, false);
  }, [seek, step]);

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

  // ---- OS media controls (keyboard media keys, lock screen) ----
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork: current.coverUrl ? [{ src: current.coverUrl, sizes: "300x300", type: "image/jpeg" }] : [],
    });
  }, [current]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = current ? (isPlaying ? "playing" : "paused") : "none";
  }, [current, isPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => stateRef.current.currentId && setIsPlaying(true)],
      ["pause", () => setIsPlaying(false)],
      ["nexttrack", () => next()],
      ["previoustrack", () => prev()],
      ["seekto", (d) => d.seekTime !== undefined && seek(d.seekTime)],
    ];
    for (const [action, handler] of actions) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action not supported by this browser */
      }
    }
    return () => {
      for (const [action] of actions) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [next, prev, seek]);

  const value = useMemo<PlayerApi>(
    () => ({
      current,
      queue,
      isPlaying,
      duration,
      buffering,
      mode,
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
    [current, queue, isPlaying, duration, buffering, mode, volume, muted, shuffle, repeat, playTrack, togglePlay, next, prev, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat]
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
