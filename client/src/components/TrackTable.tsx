import { ReactNode } from "react";
import { formatTime } from "../lib/format";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import type { Track } from "../types";
import { Cover } from "./Cover";
import { HeartButton, KebabMenu } from "./common";
import { useTrackMenu } from "./useTrackMenu";

export { attributionItems } from "./useTrackMenu";

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
}

/** Track list in the Daily Mix style: cover + title/artist, album, time, like, kebab. */
export function TrackTable({ tracks, queue, showRank, empty, caption, playlistId, extraColumn, hideAlbum }: TrackTableProps) {
  const { toggleTrackLike } = useLibrary();
  const { current, isPlaying, playTrack, togglePlay } = usePlayer();
  const menuFor = useTrackMenu();
  const ids = queue ?? tracks.map((t) => t.id);
  const columns = 4 + (showRank ? 1 : 0) + (hideAlbum ? 0 : 1) + (extraColumn ? 1 : 0);

  return (
    <table className={`mix-table${showRank ? " has-rank" : ""}${extraColumn ? " has-extra" : ""}`}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead>
        <tr>
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
          return (
            <tr key={t.id} className={isCurrent ? "is-current" : undefined}>
              {showRank && <td className="col-rank">{i + 1}</td>}
              <td>
                <button
                  type="button"
                  className="mix-track"
                  onClick={() => (isCurrent ? togglePlay() : playTrack(t.id, ids))}
                  aria-label={`${isCurrent && isPlaying ? "Pause" : "Play"} ${t.title} by ${t.artist}`}
                >
                  <span className="thumb">
                    <Cover seed={t.id} src={t.coverUrl} />
                    {isCurrent && isPlaying && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
                  </span>
                  <span className="track-text">
                    <span className="track-title">{t.title}</span>
                    <span className="track-artist">{t.artist}</span>
                  </span>
                </button>
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
                <KebabMenu label={`More options for ${t.title}`} items={menuFor(t, { queue: ids, playlistId })} />
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
