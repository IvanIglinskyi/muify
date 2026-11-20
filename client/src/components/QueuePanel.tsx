import { Shuffle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "../i18n";
import { formatTime } from "../lib/format";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import type { Track } from "../types";
import { ArtistLink } from "./ArtistLink";
import { Cover } from "./Cover";
import { KebabMenu } from "./common";
import { useTrackMenu } from "./useTrackMenu";

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * One queue entry. The play button covers the row; the artist name is its own link on top of it
 * (opening the artist page leaves the queue open on wide screens and closes it on phones).
 */
function QueueRow({ track, current, onJump, onRemove, onArtist }: { track: Track; current?: boolean; onJump?: () => void; onRemove?: () => void; onArtist: () => void }) {
  const t = useT();
  const menuFor = useTrackMenu();
  const { isPlaying } = usePlayer();
  return (
    <li className={`queue-row${current ? " is-current" : ""}`}>
      <div className="queue-main">
        <span className="thumb">
          <Cover seed={track.id} src={track.coverUrl} />
          {current && isPlaying && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
        </span>
        <span className="track-text">
          {current ? (
            <span className="track-title">{track.title}</span>
          ) : (
            <button type="button" className="queue-jump" onClick={onJump} aria-label={t("queue.playNow", { title: track.title, artist: track.artist })}>
              <span className="track-title">{track.title}</span>
            </button>
          )}
          <span onClickCapture={onArtist}>
            <ArtistLink className="track-artist" name={track.artist} id={track.artistId} />
          </span>
        </span>
        <span className="queue-time">{formatTime(track.duration)}</span>
      </div>
      {onRemove && (
        <button type="button" className="icon-btn" aria-label={t("queue.remove", { title: track.title })} title={t("queue.removeShort")} onClick={onRemove}>
          <X size={16} />
        </button>
      )}
      <KebabMenu label={t("table.moreOptions", { title: track.title })} items={menuFor(track, { hidePlayback: true })} />
    </li>
  );
}

/** Side panel with "Now playing" + "Up next" (the current queue). Escape closes it. */
export function QueuePanel({ open, onClose }: QueuePanelProps) {
  const t = useT();
  const { tracks } = useLibrary();
  const { current, queue, shuffle, playTrack, removeFromQueue, clearUpNext } = usePlayer();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!open) return;
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A modal dialog (e.g. "New playlist") handles its own Escape.
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const at = current ? queue.indexOf(current.id) : -1;
  const upNext = (at === -1 ? queue.filter((id) => id !== current?.id) : queue.slice(at + 1))
    .map((id) => tracks[id])
    .filter(Boolean);
  // The panel covers the whole screen on phones: get out of the way after following a link.
  const onArtist = () => {
    if (window.matchMedia?.("(max-width: 767px)").matches) onClose();
  };

  return (
    <aside className="queue-panel" aria-labelledby="queue-title">
      <div className="queue-head">
        <h2 id="queue-title" className="section-title" tabIndex={-1} ref={headingRef}>
          {t("queue.title")}
        </h2>
        <button type="button" className="icon-btn" aria-label={t("queue.close")} onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <section aria-labelledby="queue-now">
        <h3 id="queue-now" className="queue-subtitle">
          {t("queue.nowPlaying")}
        </h3>
        {current ? (
          <ul className="queue-list">
            <QueueRow track={current} current onArtist={onArtist} />
          </ul>
        ) : (
          <p className="empty-inline">{t("queue.nothing")}</p>
        )}
      </section>

      <section aria-labelledby="queue-next" className="queue-next">
        <div className="queue-subhead">
          <h3 id="queue-next" className="queue-subtitle">
            {t("queue.upNext")} <span className="tab-count">{upNext.length}</span>
          </h3>
          {upNext.length > 0 && (
            <button type="button" className="link-btn" onClick={clearUpNext}>
              {t("queue.clear")}
            </button>
          )}
        </div>
        {shuffle && upNext.length > 1 && (
          <p className="queue-note">
            <Shuffle size={13} aria-hidden="true" /> {t("queue.shuffleNote")}
          </p>
        )}
        {upNext.length ? (
          <ol className="queue-list">
            {upNext.map((tr) => (
              <QueueRow
                key={tr.id}
                track={tr}
                onJump={() => playTrack(tr.id)}
                onRemove={() => removeFromQueue(tr.id)}
                onArtist={onArtist}
              />
            ))}
          </ol>
        ) : (
          <p className="empty-inline">{t("queue.empty")}</p>
        )}
      </section>
    </aside>
  );
}
