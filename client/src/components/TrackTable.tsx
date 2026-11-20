import { GripVertical } from "lucide-react";
import { DragEvent, ReactNode, useRef, useState } from "react";
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
  /** Drag-and-drop reordering + "Move up / down" menu entries (user playlists). */
  reorder?: TrackReorder;
}

/** Keyboard-accessible alternative to drag-and-drop (in the row's ⋮ menu). */
function moveItems(index: number, count: number, onMove: TrackReorder["onMove"]): MenuItem[] {
  return [
    { label: "Move up", disabled: index === 0, onSelect: () => onMove(index, index - 1) },
    { label: "Move down", disabled: index === count - 1, onSelect: () => onMove(index, index + 1) },
    { label: "Move to top", disabled: index === 0, onSelect: () => onMove(index, 0) },
    { label: "Move to bottom", disabled: index === count - 1, onSelect: () => onMove(index, count - 1) },
  ];
}

/** Track list in the Daily Mix style: cover + title/artist, album, time, like, kebab. */
export function TrackTable({ tracks, queue, showRank, empty, caption, playlistId, extraColumn, hideAlbum, reorder }: TrackTableProps) {
  const { toggleTrackLike } = useLibrary();
  const { current, isPlaying, playTrack, togglePlay } = usePlayer();
  const menuFor = useTrackMenu();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  /** Source row of the drag in progress (a ref: drag events can outrun re-renders). */
  const dragFromRef = useRef<number | null>(null);
  const ids = queue ?? tracks.map((t) => t.id);
  const columns = 4 + (showRank ? 1 : 0) + (hideAlbum ? 0 : 1) + (extraColumn ? 1 : 0) + (reorder ? 1 : 0);

  const endDrag = () => {
    dragFromRef.current = null;
    setDragFrom(null);
    setDragOver(null);
  };

  const dragProps = (i: number) =>
    reorder
      ? {
          draggable: true,
          onDragStart: (e: DragEvent<HTMLTableRowElement>) => {
            dragFromRef.current = i;
            setDragFrom(i);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", tracks[i].id);
          },
          onDragOver: (e: DragEvent<HTMLTableRowElement>) => {
            if (dragFromRef.current === null) return; // not one of our rows (e.g. a file)
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOver(i);
          },
          onDrop: (e: DragEvent<HTMLTableRowElement>) => {
            const from = dragFromRef.current;
            if (from === null) return;
            e.preventDefault();
            if (from !== i) reorder.onMove(from, i);
            endDrag();
          },
          onDragEnd: endDrag,
        }
      : {};

  return (
    <table className={`mix-table${showRank ? " has-rank" : ""}${extraColumn ? " has-extra" : ""}${reorder ? " has-drag" : ""}`}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead>
        <tr>
          {reorder && (
            <th scope="col" className="col-drag">
              <span className="sr-only">Reorder</span>
            </th>
          )}
          {showRank && (
            <th scope="col" className="col-rank">
              #
            </th>
          )}
          <th scope="col" className="col-title">Title</th>
          {!hideAlbum && <th scope="col" className="col-album">Album</th>}
          {extraColumn && <th scope="col" className="col-extra">{extraColumn.header}</th>}
          <th scope="col" className="col-time">Time</th>
          <th scope="col" className="col-like"><span className="sr-only">Like</span></th>
          <th scope="col" className="col-more"><span className="sr-only">Options</span></th>
        </tr>
      </thead>
      <tbody>
        {tracks.map((t, i) => {
          const isCurrent = current?.id === t.id;
          const cls = [
            isCurrent ? "is-current" : null,
            dragFrom === i ? "is-dragging" : null,
            dragOver === i && dragFrom !== null && dragFrom !== i ? (dragFrom < i ? "drop-below" : "drop-above") : null,
          ]
            .filter(Boolean)
            .join(" ");
          const menu = menuFor(t, { queue: ids, playlistId });
          return (
            <tr key={t.id} className={cls || undefined} {...dragProps(i)}>
              {reorder && (
                <td className="col-drag">
                  <span className="drag-handle" title="Drag to reorder (or use ⋮ → Move up / down)" aria-hidden="true">
                    <GripVertical size={16} />
                  </span>
                </td>
              )}
              {showRank && <td className="col-rank">{i + 1}</td>}
              <td>
                {/* The play button stretches over the whole cell; the artist link sits above it. */}
                <div className="mix-track">
                  <span className="thumb">
                    <Cover seed={t.id} src={t.coverUrl} />
                    {isCurrent && isPlaying && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
                  </span>
                  <span className="track-text">
                    <button
                      type="button"
                      className="mix-track-play"
                      onClick={() => (isCurrent ? togglePlay() : playTrack(t.id, ids))}
                      aria-label={`${isCurrent && isPlaying ? "Pause" : "Play"} ${t.title} by ${t.artist}`}
                    >
                      <span className="track-title">{t.title}</span>
                    </button>
                    <ArtistLink className="track-artist" name={t.artist} id={t.artistId} />
                  </span>
                </div>
              </td>
              {!hideAlbum && (
                <td className="col-album" title={t.album}>
                  <span className="ellipsis">{t.album}</span>
                </td>
              )}
              {extraColumn && <td className="col-extra">{extraColumn.render(t, i)}</td>}
              <td className="col-time">{formatTime(t.duration)}m</td>
              <td>
                <HeartButton liked={t.liked} label={t.title} onToggle={() => toggleTrackLike(t.id)} />
              </td>
              <td>
                <KebabMenu
                  label={`More options for ${t.title}`}
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
