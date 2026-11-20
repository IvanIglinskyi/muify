import { GripVertical } from "lucide-react";
import { KeyboardEvent, PointerEvent, ReactNode, useRef, useState } from "react";
import { useT } from "../i18n";
import { formatTime } from "../lib/format";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import type { Track } from "../types";
import { ArtistLink } from "./ArtistLink";
import { Cover } from "./Cover";
import { HeartButton, KebabMenu, type MenuItem } from "./common";
import { useTrackMenu } from "./useTrackMenu";

export { attributionItems } from "./useTrackMenu";

export interface TrackReorder {
  /** Move the track at `from` to index `to` (indexes into `tracks`). */
  onMove: (from: number, to: number) => void;
}

interface TrackTableProps {
  tracks: Track[];
  /** Queue used when a row is played; defaults to the visible list. */
  queue?: string[];
  /** Adds a leading "#" chart-position column. */
  showRank?: boolean;
  /** Shown in a full-width row when `tracks` is empty (omit to render nothing). */
  empty?: ReactNode;
  caption?: string;
  /** Playlist being shown (enables "Remove from this playlist" for user playlists). */
  playlistId?: string;
  /** Optional extra column shown before Time (e.g. "Plays", "Last played"). */
  extraColumn?: { header: string; render: (t: Track, index: number) => ReactNode };
  /** Hide the album column (e.g. on the album page). */
  hideAlbum?: boolean;
  /** Drag handle (mouse, touch, pen; arrow keys) + "Move up / down" menu entries (user playlists). */
  reorder?: TrackReorder;
}

/** Edge zone (px) where dragging near the top/bottom of the window scrolls it. */
const AUTOSCROLL_ZONE = 64;

/** Track list in the Daily Mix style: cover + title/artist, album, time, like, kebab. */
export function TrackTable({ tracks, queue, showRank, empty, caption, playlistId, extraColumn, hideAlbum, reorder }: TrackTableProps) {
  const t = useT();
  const { toggleTrackLike } = useLibrary();
  const { current, isPlaying, playTrack, togglePlay } = usePlayer();
  const menuFor = useTrackMenu();
  const tableRef = useRef<HTMLTableElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  /** Drag in progress (a ref: pointer events can outrun re-renders). */
  const dragRef = useRef<{ from: number; over: number | null; pointerId: number } | null>(null);
  const ids = queue ?? tracks.map((x) => x.id);
  const columns = 4 + (showRank ? 1 : 0) + (hideAlbum ? 0 : 1) + (extraColumn ? 1 : 0) + (reorder ? 1 : 0);

  /** Keyboard-accessible alternative to dragging (in the row's ⋮ menu). */
  const moveItems = (index: number, count: number, onMove: TrackReorder["onMove"]): MenuItem[] => [
    { label: t("table.moveUp"), disabled: index === 0, onSelect: () => onMove(index, index - 1) },
    { label: t("table.moveDown"), disabled: index === count - 1, onSelect: () => onMove(index, index + 1) },
    { label: t("table.moveTop"), disabled: index === 0, onSelect: () => onMove(index, 0) },
    { label: t("table.moveBottom"), disabled: index === count - 1, onSelect: () => onMove(index, count - 1) },
  ];

  const endDrag = () => {
    dragRef.current = null;
    setDragFrom(null);
    setDragOver(null);
  };

  /** Row index under a viewport point (only rows of this table count). */
  const rowAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    const row = el?.closest<HTMLTableRowElement>("tr[data-index]");
    if (!row || !tableRef.current?.contains(row)) return null;
    const i = Number(row.dataset.index);
    return Number.isInteger(i) ? i : null;
  };

  const handleProps = (i: number, title: string) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (!reorder || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.preventDefault(); // no text selection / no native drag
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragRef.current = { from: i, over: i, pointerId: e.pointerId };
      setDragFrom(i);
      setDragOver(i);
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const over = rowAt(e.clientX, e.clientY);
      if (over !== null && over !== d.over) {
        d.over = over;
        setDragOver(over);
      }
      if (e.clientY < AUTOSCROLL_ZONE) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - AUTOSCROLL_ZONE) window.scrollBy(0, 12);
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const over = rowAt(e.clientX, e.clientY) ?? d.over;
      endDrag();
      if (reorder && over !== null && over !== d.from) reorder.onMove(d.from, over);
    },
    onPointerCancel: endDrag,
    onLostPointerCapture: () => dragRef.current && endDrag(),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (!reorder) return;
      // Arrow keys on the focused handle move the row (the global ↑/↓ volume shortcut stays out of it).
      const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? tracks.length - 1 : null;
      if (to === null) return;
      e.preventDefault();
      if (to < 0 || to >= tracks.length || to === i) return;
      reorder.onMove(i, to);
      const target = to;
      window.requestAnimationFrame(() => tableRef.current?.querySelector<HTMLButtonElement>(`tr[data-index="${target}"] .drag-handle`)?.focus());
    },
    "aria-label": t("table.dragHandleLabel", { title }),
    title: t("table.dragHandle"),
  });

  return (
    <table ref={tableRef} className={`mix-table${showRank ? " has-rank" : ""}${extraColumn ? " has-extra" : ""}${reorder ? " has-drag" : ""}${dragFrom !== null ? " is-dragging-table" : ""}`}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead>
        <tr>
          {reorder && (
            <th scope="col" className="col-drag">
              <span className="sr-only">{t("table.reorder")}</span>
            </th>
          )}
          {showRank && (
            <th scope="col" className="col-rank">
              #
            </th>
          )}
          <th scope="col" className="col-title">{t("table.title")}</th>
          {!hideAlbum && <th scope="col" className="col-album">{t("table.album")}</th>}
          {extraColumn && <th scope="col" className="col-extra">{extraColumn.header}</th>}
          <th scope="col" className="col-time">{t("table.time")}</th>
          <th scope="col" className="col-like"><span className="sr-only">{t("table.like")}</span></th>
          <th scope="col" className="col-more"><span className="sr-only">{t("table.options")}</span></th>
        </tr>
      </thead>
      <tbody>
        {tracks.map((tr, i) => {
          const isCurrent = current?.id === tr.id;
          const cls = [
            isCurrent ? "is-current" : null,
            dragFrom === i ? "is-dragging" : null,
            dragOver === i && dragFrom !== null && dragFrom !== i ? (dragFrom < i ? "drop-below" : "drop-above") : null,
          ]
            .filter(Boolean)
            .join(" ");
          const menu = menuFor(tr, { queue: ids, playlistId });
          return (
            <tr key={tr.id} className={cls || undefined} data-index={i}>
              {reorder && (
                <td className="col-drag">
                  <button type="button" className="drag-handle" {...handleProps(i, tr.title)}>
                    <GripVertical size={16} aria-hidden="true" />
                  </button>
                </td>
              )}
              {showRank && <td className="col-rank">{i + 1}</td>}
              <td>
                {/* The play button stretches over the whole cell; the artist link sits above it. */}
                <div className="mix-track">
                  <span className="thumb">
                    <Cover seed={tr.id} src={tr.coverUrl} />
                    {isCurrent && isPlaying && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
                  </span>
                  <span className="track-text">
                    <button
                      type="button"
                      className="mix-track-play"
                      onClick={() => (isCurrent ? togglePlay() : playTrack(tr.id, ids))}
                      aria-label={t(isCurrent && isPlaying ? "table.pauseTrack" : "table.playTrack", { title: tr.title, artist: tr.artist })}
                    >
                      <span className="track-title">{tr.title}</span>
                    </button>
                    <ArtistLink className="track-artist" name={tr.artist} id={tr.artistId} />
                  </span>
                </div>
              </td>
              {!hideAlbum && (
                <td className="col-album" title={tr.album}>
                  <span className="ellipsis">{tr.album}</span>
                </td>
              )}
              {extraColumn && <td className="col-extra">{extraColumn.render(tr, i)}</td>}
              <td className="col-time">
                {formatTime(tr.duration)}
                {t("table.timeSuffix")}
              </td>
              <td>
                <HeartButton liked={tr.liked} label={tr.title} onToggle={() => toggleTrackLike(tr.id)} />
              </td>
              <td>
                <KebabMenu
                  label={t("table.moreOptions", { title: tr.title })}
                  items={reorder ? [...moveItems(i, tracks.length, reorder.onMove), ...menu] : menu}
                />
              </td>
            </tr>
          );
        })}
        {tracks.length === 0 && empty && (
          <tr>
            <td colSpan={columns} className="empty">
              {empty}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
