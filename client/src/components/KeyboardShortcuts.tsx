import { Keyboard, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { tt, useT, type MessageKey } from "../i18n";
import { formatTime } from "../lib/format";
import { SEEK_STEP_S, SHORTCUTS, shortcutFor, VOLUME_STEP, type ShortcutAction } from "../lib/shortcuts";
import { useLibrary } from "../store/LibraryContext";
import { usePlaybackPosition, usePlayer } from "../store/PlayerContext";

const OPEN_EVENT = "muify:shortcuts-help";

/** Opens the shortcuts help dialog from anywhere (e.g. the Settings menu). */
export function openShortcutsHelp() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Focuses the header search box. */
function focusSearch() {
  const input = document.querySelector<HTMLInputElement>(".app-header .search input");
  input?.focus();
  input?.select();
}

/**
 * Global keyboard shortcuts (Space, ←/→, Shift+←/→, ↑/↓, M, L, /, ?) + a tiny on-screen
 * confirmation and the "?" help dialog. Mounted once in the app shell.
 */
export function KeyboardShortcuts() {
  const player = usePlayer();
  const position = usePlaybackPosition();
  const { toggleTrackLike, tracks } = useLibrary();
  const [helpOpen, setHelpOpen] = useState(false);
  const [osd, setOsd] = useState<string | null>(null);
  const osdTimer = useRef<number | undefined>(undefined);

  // Handlers read the latest player state through a ref (the listener is attached once).
  const latest = useRef({ player, position, toggleTrackLike, tracks });
  latest.current = { player, position, toggleTrackLike, tracks };

  const flash = useCallback((text: string) => {
    setOsd(text);
    window.clearTimeout(osdTimer.current);
    osdTimer.current = window.setTimeout(() => setOsd(null), 1200);
  }, []);

  useEffect(() => {
    const run = (action: ShortcutAction) => {
      const { player: p, position: pos, toggleTrackLike: like, tracks: index } = latest.current;
      const vol = p.muted ? 0 : p.volume;
      switch (action) {
        case "toggle-play":
          if (!p.current) return false;
          p.togglePlay();
          flash(tt(p.isPlaying ? "osd.paused" : "osd.playing"));
          return true;
        case "next":
          if (!p.current) return false;
          p.next();
          return true;
        case "prev":
          if (!p.current) return false;
          p.prev();
          return true;
        case "seek-forward":
        case "seek-back": {
          if (!p.current) return false;
          const delta = action === "seek-forward" ? SEEK_STEP_S : -SEEK_STEP_S;
          p.seekBy(delta);
          flash(`${formatTime(Math.max(0, Math.min(p.duration || Infinity, pos + delta)))} / ${formatTime(p.duration)}`);
          return true;
        }
        case "volume-up":
        case "volume-down": {
          const next = Math.min(1, Math.max(0, Math.round((vol + (action === "volume-up" ? VOLUME_STEP : -VOLUME_STEP)) * 100) / 100));
          p.setVolume(next);
          flash(tt("osd.volume", { percent: Math.round(next * 100) }));
          return true;
        }
        case "mute":
          p.toggleMute();
          flash(p.muted ? tt("osd.volume", { percent: Math.round(p.volume * 100) }) : tt("osd.muted"));
          return true;
        case "like": {
          if (!p.current) return false;
          const wasLiked = index[p.current.id]?.liked ?? p.current.liked;
          like(p.current.id);
          flash(tt(wasLiked ? "osd.unliked" : "osd.liked"));
          return true;
        }
        case "search":
          focusSearch();
          return true;
        case "help":
          setHelpOpen(true);
          return true;
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const action = shortcutFor(e, e.target instanceof Element ? e.target : document.activeElement);
      if (action && run(action)) e.preventDefault();
    };
    const onOpen = () => setHelpOpen(true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [flash]);

  useEffect(() => () => window.clearTimeout(osdTimer.current), []);

  return (
    <>
      <div className={`shortcut-osd${osd ? " is-visible" : ""}`} role="status" aria-live="polite">
        {osd}
      </div>
      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
    </>
  );
}

const isKey = (k: string): k is MessageKey => k.startsWith("shortcuts.");

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
    const back = opener.current;
    return () => {
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal shortcuts-modal"
      aria-labelledby="shortcuts-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop
      }}
    >
      <div className="modal-body">
        <div className="shortcuts-head">
          <h2 id="shortcuts-title" className="modal-title">
            <Keyboard size={18} aria-hidden="true" /> {t("shortcuts.title")}
          </h2>
          <button type="button" className="icon-btn" aria-label={t("shortcuts.close")} onClick={onClose} autoFocus>
            <X size={18} />
          </button>
        </div>
        <table className="shortcuts-table">
          <caption className="sr-only">{t("shortcuts.caption")}</caption>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.label}>
                <th scope="row">
                  {s.keys.map((k, i) => (
                    <span key={k}>
                      {i > 0 && <span aria-hidden="true"> + </span>}
                      <kbd>{isKey(k) ? t(k) : k}</kbd>
                    </span>
                  ))}
                </th>
                <td>{t(s.label)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="shortcuts-note">{t("shortcuts.note")}</p>
      </div>
    </dialog>
  );
}
