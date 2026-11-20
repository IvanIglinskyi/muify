import { MicVocal, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "../i18n";
import { useLyrics } from "../lib/lyrics";
import { usePlayer } from "../store/PlayerContext";
import { ArtistLink } from "./ArtistLink";

/** Side panel with the lyrics of the current track (Jamendo include=lyrics). Escape closes it. */
export function LyricsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { current } = usePlayer();
  const lyrics = useLyrics(current, open);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!open) return;
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside className="queue-panel lyrics-panel" aria-labelledby="lyrics-title">
      <div className="queue-head">
        <h2 id="lyrics-title" className="section-title" tabIndex={-1} ref={headingRef}>
          <MicVocal size={18} aria-hidden="true" /> {t("lyrics.title")}
        </h2>
        <button type="button" className="icon-btn" aria-label={t("lyrics.close")} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {!current ? (
        <p className="empty-inline">{t("lyrics.nothing")}</p>
      ) : (
        <>
          <div className="lyrics-track">
            <strong>{current.title}</strong>
            <ArtistLink className="track-artist" name={current.artist} id={current.artistId} />
          </div>
          {lyrics.status === "loading" && (
            <p className="empty-inline" aria-busy="true">
              {t("lyrics.loading")}
            </p>
          )}
          {lyrics.status === "error" && (
            <p className="inline-error" role="alert">
              {t("lyrics.error")}
            </p>
          )}
          {lyrics.status === "none" && <p className="empty-inline">{t("lyrics.none")}</p>}
          {lyrics.status === "ready" && (
            <>
              {/* Plain text from the API (never HTML); the original language of the song. */}
              <div className="lyrics-text" lang="" tabIndex={0} role="region" aria-label={`${t("lyrics.title")}: ${current.title}`}>
                {lyrics.text}
              </div>
              <p className="settings-hint">{t("lyrics.source")}</p>
            </>
          )}
        </>
      )}
    </aside>
  );
}
