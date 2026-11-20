import {
  ExternalLink,
  Gauge,
  ListMusic,
  LoaderCircle,
  MicVocal,
  Moon,
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
import { useEffect, useState } from "react";
import { useT, type TFunction } from "../i18n";
import { formatNumber, formatTime } from "../lib/format";
import { licenseLabel } from "../lib/license";
import { useLyrics } from "../lib/lyrics";
import { formatRemaining, PLAYBACK_RATES, SLEEP_MINUTES, sleepRemainingMs, type SleepTimer } from "../lib/sleepTimer";
import { useLibrary } from "../store/LibraryContext";
import { usePlaybackPosition, usePlayer } from "../store/PlayerContext";
import { ArtistLink } from "./ArtistLink";
import { Cover } from "./Cover";
import { HeartButton, Popover, RangeSlider } from "./common";

function Progress() {
  const t = useT();
  const position = usePlaybackPosition();
  const { seek, duration } = usePlayer();
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
        label={t("player.seek")}
        valueText={t("player.seekValue", { pos: formatTime(pos), total: formatTime(duration) })}
      />
      <span className="time">{formatTime(duration)}</span>
    </div>
  );
}

/** Milliseconds left on the sleep timer (re-renders every second / with the position). */
function useSleepRemaining(timer: SleepTimer | null): number | null {
  const position = usePlaybackPosition();
  const { duration, rate } = usePlayer();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer]);
  return sleepRemainingMs(timer, now, { position, duration, rate });
}

const rateText = (t: TFunction, r: number) => t("player.speedValue", { rate: formatNumber(r) });

/** Speed + sleep timer popover (opens upwards from the player bar). */
function PlaybackOptions() {
  const t = useT();
  const { rate, setRate, sleepTimer, setSleepTimer } = usePlayer();
  const remaining = useSleepRemaining(sleepTimer);
  const sleepText =
    sleepTimer?.kind === "end-of-track"
      ? t("sleep.badgeEnd")
      : remaining !== null
        ? formatRemaining(remaining)
        : null;
  const sleepLabel = sleepTimer?.kind === "end-of-track" ? t("sleep.endOfTrack") : sleepText;
  const state = [rate !== 1 ? rateText(t, rate) : null, sleepLabel ? `${t("sleep.title")}: ${sleepLabel}` : null].filter(Boolean).join(", ");

  // (The status line below and the badge on the button announce the change — no toast over the panel.)
  const chooseSleep = (v: number | "end-of-track" | null) => setSleepTimer(v);

  return (
    <Popover
      className="player-options"
      label={state ? t("player.optionsActive", { state }) : t("player.options")}
      icon={
        <span className={`options-icon${sleepTimer || rate !== 1 ? " is-on" : ""}`}>
          {sleepTimer ? <Moon size={19} /> : <Gauge size={19} />}
          {sleepText ? <span className="options-badge">{sleepText}</span> : rate !== 1 ? <span className="options-badge">{rateText(t, rate)}</span> : null}
        </span>
      }
    >
      {() => (
        <div className="options-panel">
          <h2 className="popover-title" id="speed-title">
            {t("player.speed")}
          </h2>
          <div className="chip-group" role="radiogroup" aria-labelledby="speed-title">
            {PLAYBACK_RATES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={rate === r} className={`chip${rate === r ? " is-on" : ""}`} onClick={() => setRate(r)}>
                {r === 1 ? t("player.speedNormal") : rateText(t, r)}
              </button>
            ))}
          </div>
          <h2 className="popover-title" id="sleep-title">
            <Moon size={13} aria-hidden="true" /> {t("sleep.title")}
          </h2>
          <div className="chip-group" role="radiogroup" aria-labelledby="sleep-title">
            <button type="button" role="radio" aria-checked={!sleepTimer} className={`chip${!sleepTimer ? " is-on" : ""}`} onClick={() => sleepTimer && chooseSleep(null)}>
              {t("sleep.off")}
            </button>
            {SLEEP_MINUTES.map((m) => {
              const on = sleepTimer?.kind === "minutes" && sleepTimer.minutes === m;
              return (
                <button key={m} type="button" role="radio" aria-checked={on} className={`chip${on ? " is-on" : ""}`} onClick={() => chooseSleep(m)}>
                  {t("sleep.minutes", { m })}
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={sleepTimer?.kind === "end-of-track"}
              className={`chip${sleepTimer?.kind === "end-of-track" ? " is-on" : ""}`}
              onClick={() => chooseSleep("end-of-track")}
            >
              {t("sleep.endOfTrack")}
            </button>
          </div>
          <p className="settings-hint sleep-status" role="status">
            {sleepTimer?.kind === "end-of-track"
              ? t("sleep.remainingEnd")
              : sleepTimer && remaining !== null
                ? t("sleep.remaining", { time: formatRemaining(remaining) })
                : ""}
          </p>
        </div>
      )}
    </Popover>
  );
}

interface PlayerBarProps {
  queueOpen: boolean;
  onToggleQueue: () => void;
  lyricsOpen: boolean;
  onToggleLyrics: () => void;
}

export function PlayerBar({ queueOpen, onToggleQueue, lyricsOpen, onToggleLyrics }: PlayerBarProps) {
  const t = useT();
  const { toggleTrackLike } = useLibrary();
  const p = usePlayer();
  const track = p.current;
  const lyrics = useLyrics(track);
  const hasLyrics = lyrics.status === "ready";
  const effectiveVolume = p.muted ? 0 : p.volume;
  const VolIcon = effectiveVolume === 0 ? VolumeX : effectiveVolume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = p.repeat === "one" ? Repeat1 : Repeat;

  // The lyrics panel closes itself when the next track has none.
  useEffect(() => {
    if (lyricsOpen && lyrics.status === "none") onToggleLyrics();
  }, [lyricsOpen, lyrics.status, onToggleLyrics]);

  return (
    <footer className="player" aria-label={t("player.label")}>
      <div className="player-track">
        <span className="player-cover">{track ? <Cover seed={track.id} src={track.coverUrl} /> : null}</span>
        <div className="player-text">
          <span className="player-title">{track?.title ?? t("player.nothing")}</span>
          {track ? (
            <ArtistLink className="player-artist" name={track.artist} id={track.artistId} />
          ) : (
            <span className="player-artist">—</span>
          )}
          {track && (track.licenseUrl || track.shareUrl) && (
            <span className="player-credit">
              {track.licenseUrl && (
                <a
                  href={track.licenseUrl}
                  target="_blank"
                  rel="noopener noreferrer license"
                  title={t("license.tooltip", { license: licenseLabel(track.licenseUrl) })}
                >
                  {licenseLabel(track.licenseUrl, { short: true })}
                </a>
              )}
              {track.shareUrl && (
                <a
                  href={track.shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("player.openJamendo", { title: track.title, artist: track.artist })}
                >
                  {t("common.jamendo")} <ExternalLink size={10} aria-hidden="true" />
                </a>
              )}
            </span>
          )}
        </div>
        {track && (
          <HeartButton liked={track.liked} label={track.title} size={22} onToggle={() => toggleTrackLike(track.id)} />
        )}
      </div>

      <div className="player-controls">
        <button
          type="button"
          className={`icon-btn toggle${p.shuffle ? " is-on" : ""}`}
          aria-label={t("player.shuffle")}
          aria-pressed={p.shuffle}
          onClick={p.toggleShuffle}
        >
          <Shuffle size={20} />
        </button>
        <button type="button" className="icon-btn" aria-label={t("player.prev")} onClick={p.prev} disabled={!track}>
          <SkipBack size={20} fill="currentColor" />
        </button>
        <button
          type="button"
          className="play-main"
          aria-label={p.isPlaying ? (p.buffering ? t("player.pauseLoading") : t("player.pause")) : t("player.play")}
          aria-busy={p.isPlaying && p.buffering}
          onClick={p.togglePlay}
          disabled={!track}
        >
          {p.isPlaying && p.buffering ? (
            <LoaderCircle size={22} className="spin" aria-hidden="true" />
          ) : p.isPlaying ? (
            <Pause size={22} fill="currentColor" />
          ) : (
            <Play size={22} fill="currentColor" />
          )}
        </button>
        <button type="button" className="icon-btn" aria-label={t("player.next")} onClick={p.next} disabled={!track}>
          <SkipForward size={20} fill="currentColor" />
        </button>
        <button
          type="button"
          className={`icon-btn toggle${p.repeat !== "off" ? " is-on" : ""}`}
          aria-label={t(`player.repeat.${p.repeat}`)}
          onClick={p.cycleRepeat}
        >
          <RepeatIcon size={20} />
        </button>
        <button
          type="button"
          className={`icon-btn queue-btn${queueOpen ? " is-on" : ""}`}
          aria-label={t("player.queue")}
          title={t("player.queue")}
          aria-expanded={queueOpen}
          onClick={onToggleQueue}
        >
          <ListMusic size={20} />
        </button>
      </div>

      <Progress />

      <div className="player-extras">
        {hasLyrics && (
          <button
            type="button"
            className={`icon-btn lyrics-btn${lyricsOpen ? " is-on" : ""}`}
            aria-label={t("player.lyricsOpen")}
            title={t("player.lyrics")}
            aria-expanded={lyricsOpen}
            onClick={onToggleLyrics}
          >
            <MicVocal size={20} />
          </button>
        )}
        <PlaybackOptions />
      </div>

      <div className="player-volume">
        <button type="button" className="icon-btn" aria-label={p.muted ? t("player.unmute") : t("player.mute")} onClick={p.toggleMute}>
          <VolIcon size={20} />
        </button>
        <RangeSlider
          className="volume-range"
          value={Math.round(effectiveVolume * 100)}
          max={100}
          onChange={(v) => p.setVolume(v / 100)}
          label={t("player.volume")}
          valueText={`${Math.round(effectiveVolume * 100)}%`}
        />
      </div>
    </footer>
  );
}
