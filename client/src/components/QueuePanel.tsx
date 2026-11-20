import { Shuffle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { formatTime } from "../lib/format";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import type { Track } from "../types";
import { Cover } from "./Cover";
import { KebabMenu } from "./common";
import { useTrackMenu } from "./useTrackMenu";

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
}

function QueueRow({ track, current, onJump, onRemove }: { track: Track; current?: boolean; onJump?: () => void; onRemove?: () => void }) {
  const menuFor = useTrackMenu();
  const { isPlaying } = usePlayer();
  const body = (
    <>
      <span className="thumb">
        <Cover seed={track.id} src={track.coverUrl} />
        {current && isPlaying && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
      </span>
      <span className="track-text">
        <span className="track-title">{track.title}</span>
        <span className="track-artist">{track.artist}</span>
      </span>
      <span className="queue-time">{formatTime(track.duration)}</span>
    </>
  );
  return (
    <li className={`queue-row${current ? " is-current" : ""}`}>
      {current ? (
        <div className="queue-main">{body}</div>
      ) : (
        <button type="button" className="queue-main" onClick={onJump} aria-label={`Play ${track.title} by ${track.artist} now`}>
          {body}
        </button>
      )}
      {onRemove && (
        <button type="button" className="icon-btn" aria-label={`Remove ${track.title} from queue`} title="Remove from queue" onClick={onRemove}>
          <X size={16} />
        </button>
      )}
      <KebabMenu label={`More options for ${track.title}`} items={menuFor(track, { hidePlayback: true })} />
    </li>
  );
}

/** Side panel with "Now playing" + "Up next" (the current queue). Escape closes it. */
export function QueuePanel({ open, onClose }: QueuePanelProps) {
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

  return (
    <aside className="queue-panel" aria-labelledby="queue-title">
      <div className="queue-head">
        <h2 id="queue-title" className="section-title" tabIndex={-1} ref={headingRef}>
          Queue
        </h2>
        <button type="button" className="icon-btn" aria-label="Close queue" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <section aria-labelledby="queue-now">
        <h3 id="queue-now" className="queue-subtitle">
          Now playing
        </h3>
        {current ? (
          <ul className="queue-list">
            <QueueRow track={current} current />
          </ul>
        ) : (
          <p className="empty-inline">Nothing is playing.</p>
        )}
      </section>

      <section aria-labelledby="queue-next" className="queue-next">
        <div className="queue-subhead">
          <h3 id="queue-next" className="queue-subtitle">
            Up next <span className="tab-count">{upNext.length}</span>
          </h3>
          {upNext.length > 0 && (
            <button type="button" className="link-btn" onClick={clearUpNext}>
              Clear
            </button>
          )}
        </div>
        {shuffle && upNext.length > 1 && (
          <p className="queue-note">
            <Shuffle size={13} aria-hidden="true" /> Shuffle is on — these play in random order.
          </p>
        )}
        {upNext.length ? (
          <ol className="queue-list">
            {upNext.map((t) => (
              <QueueRow
                key={t.id}
                track={t}
                onJump={() => playTrack(t.id)}
                onRemove={() => removeFromQueue(t.id)}
              />
            ))}
          </ol>
        ) : (
          <p className="empty-inline">Nothing queued. Use “Play next” or “Add to queue” in a track’s menu.</p>
        )}
      </section>
    </aside>
  );
}
