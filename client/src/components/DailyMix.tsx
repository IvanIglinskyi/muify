import { useState } from "react";
import { formatTime } from "../lib/format";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import { Cover } from "./Cover";
import { HeartButton, KebabMenu, SectionHeader } from "./common";

export function DailyMix({ query }: { query: string }) {
  const { dailyMixIds, tracks, toggleTrackLike, loading } = useLibrary();
  const { current, isPlaying, playTrack, togglePlay } = usePlayer();
  const [expanded, setExpanded] = useState(false);

  const q = query.trim().toLowerCase();
  const list = dailyMixIds
    .map((id) => tracks[id])
    .filter(Boolean)
    .filter((t) => !q || `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q));
  const queue = list.map((t) => t.id);

  return (
    <section className="card daily-mix" aria-labelledby="daily-mix-title">
      <SectionHeader
        title={<span id="daily-mix-title">Daily Mix</span>}
        action={expanded ? "Collapse" : "Explore All"}
        onAction={() => setExpanded((e) => !e)}
      />
      <div className={`mix-scroll${expanded ? " is-expanded" : ""}`}>
        <table className="mix-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col" className="col-album">Album</th>
              <th scope="col" className="col-time">Time</th>
              <th scope="col"><span className="sr-only">Like</span></th>
              <th scope="col"><span className="sr-only">Options</span></th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => {
              const isCurrent = current?.id === t.id;
              return (
                <tr key={t.id} className={isCurrent ? "is-current" : undefined}>
                  <td>
                    <button
                      type="button"
                      className="mix-track"
                      onClick={() => (isCurrent ? togglePlay() : playTrack(t.id, queue))}
                      aria-label={`${isCurrent && isPlaying ? "Pause" : "Play"} ${t.title} by ${t.artist}`}
                    >
                      <span className="thumb">
                        <Cover seed={t.id} />
                        {isCurrent && isPlaying && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
                      </span>
                      <span className="track-text">
                        <span className="track-title">{t.title}</span>
                        <span className="track-artist">{t.artist}</span>
                      </span>
                    </button>
                  </td>
                  <td className="col-album" title={t.album}>
                    <span className="ellipsis">{t.album}</span>
                  </td>
                  <td className="col-time">{formatTime(t.duration)}m</td>
                  <td>
                    <HeartButton liked={t.liked} label={t.title} onToggle={() => toggleTrackLike(t.id)} />
                  </td>
                  <td>
                    <KebabMenu
                      label={`More options for ${t.title}`}
                      items={[
                        { label: "Play", onSelect: () => playTrack(t.id, queue) },
                        { label: t.liked ? "Remove from favourites" : "Add to favourites", onSelect: () => toggleTrackLike(t.id) },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No tracks match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
