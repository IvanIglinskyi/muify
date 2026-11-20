import { Pause, Play } from "lucide-react";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import { ArtistLink, artistPath } from "./ArtistLink";
import { Cover } from "./Cover";
import { HeartButton } from "./common";
import { Link } from "react-router-dom";

/** "Because you liked <artist>" — a horizontal row of track tiles (signed-in listeners with enough data). */
export function BecauseYouLiked() {
  const { because, tracks, toggleTrackLike } = useLibrary();
  const { current, isPlaying, playTrack, togglePlay } = usePlayer();
  if (!because) return null;
  const list = because.trackIds.map((id) => tracks[id]).filter(Boolean);
  if (list.length === 0) return null;
  const ids = list.map((t) => t.id);
  const { artist } = because;

  return (
    <section className="because" aria-labelledby="because-title">
      <div className="section-header">
        <h2 id="because-title" className="section-title">
          Because you liked{" "}
          {artist.id ? (
            <Link to={artistPath(artist.id)} className="because-artist">
              {artist.name}
            </Link>
          ) : (
            <span className="because-artist">{artist.name}</span>
          )}
        </h2>
      </div>
      <ul className="track-tiles">
        {list.map((t) => {
          const isCurrent = current?.id === t.id;
          const playing = isCurrent && isPlaying;
          return (
            <li key={t.id} className={`track-tile${isCurrent ? " is-current" : ""}`}>
              <span className="track-tile-art">
                <Cover seed={t.id} src={t.coverUrl} />
                <button
                  type="button"
                  className="play-circle track-tile-play"
                  onClick={() => (isCurrent ? togglePlay() : playTrack(t.id, ids))}
                  aria-label={`${playing ? "Pause" : "Play"} ${t.title} by ${t.artist}`}
                >
                  {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                </button>
                <HeartButton className="track-tile-like" liked={t.liked} label={t.title} size={18} onToggle={() => toggleTrackLike(t.id)} />
              </span>
              <span className="track-title" title={t.title}>
                {t.title}
              </span>
              <ArtistLink className="track-artist" name={t.artist} id={t.artistId} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
