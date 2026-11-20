import {
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatTime } from "../lib/format";
import { useLibrary } from "../store/LibraryContext";
import { usePlaybackPosition, usePlayer } from "../store/PlayerContext";
import { Cover } from "./Cover";
import { HeartButton, RangeSlider } from "./common";

function Progress({ duration }: { duration: number }) {
  const position = usePlaybackPosition();
  const { seek } = usePlayer();
  const pos = Math.min(position, duration);
  return (
    <div className="progress">
      <span className="time">{formatTime(pos)}</span>
      <RangeSlider
        className="progress-range"
        value={pos}
        max={duration}
        step={1}
        onChange={seek}
        label="Seek"
        valueText={`${formatTime(pos)} of ${formatTime(duration)}`}
      />
      <span className="time">{formatTime(duration)}</span>
    </div>
  );
}

export function PlayerBar() {
  const { toggleTrackLike } = useLibrary();
  const p = usePlayer();
  const track = p.current;
  const effectiveVolume = p.muted ? 0 : p.volume;
  const VolIcon = effectiveVolume === 0 ? VolumeX : effectiveVolume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = p.repeat === "one" ? Repeat1 : Repeat;

  return (
    <footer className="player" aria-label="Player">
      <div className="player-track">
        <span className="player-cover">{track ? <Cover seed={track.id} /> : null}</span>
        <div className="player-text">
          <span className="player-title">{track?.title ?? "Nothing playing"}</span>
          <span className="player-artist">{track?.artist ?? "—"}</span>
        </div>
        {track && (
          <HeartButton liked={track.liked} label={track.title} size={22} onToggle={() => toggleTrackLike(track.id)} />
        )}
      </div>

      <div className="player-controls">
        <button
          type="button"
          className={`icon-btn toggle${p.shuffle ? " is-on" : ""}`}
          aria-label="Shuffle"
          aria-pressed={p.shuffle}
          onClick={p.toggleShuffle}
        >
          <Shuffle size={20} />
        </button>
        <button type="button" className="icon-btn" aria-label="Previous track" onClick={p.prev} disabled={!track}>
          <SkipBack size={20} fill="currentColor" />
        </button>
        <button
          type="button"
          className="play-main"
          aria-label={p.isPlaying ? "Pause" : "Play"}
          onClick={p.togglePlay}
          disabled={!track}
        >
          {p.isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </button>
        <button type="button" className="icon-btn" aria-label="Next track" onClick={p.next} disabled={!track}>
          <SkipForward size={20} fill="currentColor" />
        </button>
        <button
          type="button"
          className={`icon-btn toggle${p.repeat !== "off" ? " is-on" : ""}`}
          aria-label={`Repeat: ${p.repeat}`}
          onClick={p.cycleRepeat}
        >
          <RepeatIcon size={20} />
        </button>
      </div>

      <Progress duration={track?.duration ?? 0} />

      <div className="player-volume">
        <button type="button" className="icon-btn" aria-label={p.muted ? "Unmute" : "Mute"} onClick={p.toggleMute}>
          <VolIcon size={20} />
        </button>
        <RangeSlider
          className="volume-range"
          value={Math.round(effectiveVolume * 100)}
          max={100}
          onChange={(v) => p.setVolume(v / 100)}
          label="Volume"
          valueText={`${Math.round(effectiveVolume * 100)}%`}
        />
      </div>
    </footer>
  );
}
