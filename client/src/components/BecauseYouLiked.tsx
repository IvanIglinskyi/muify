import { Pause, Play } from "lucide-react";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import { ArtistLink, artistPath } from "./ArtistLink";
import { Cover } from "./Cover";
import { HeartButton } from "./common";
import { Link } from "react-router-dom";
import { Trans, useT } from "../i18n";

/** "Because you liked <artist>" — a horizontal row of track tiles (signed-in listeners with enough data). */
export function BecauseYouLiked() {
  const t = useT();
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
          <Trans
            k="because.title"
            values={{
              artist: artist.id ? (
                <Link to={artistPath(artist.id)} className="because-artist">
                  {artist.name}
                </Link>
              ) : (
                <span className="because-artist">{artist.name}</span>
              ),
            }}
          />
        </h2>
      </div>
      <ul className="track-tiles">
        {list.map((tr) => {
          const isCurrent = current?.id === tr.id;
          const playing = isCurrent && isPlaying;
          return (
            <li key={tr.id} className={`track-tile${isCurrent ? " is-current" : ""}`}>
              <span className="track-tile-art">
                <Cover seed={tr.id} src={tr.coverUrl} />
                <button
                  type="button"
                  className="play-circle track-tile-play"
                  onClick={() => (isCurrent ? togglePlay() : playTrack(tr.id, ids))}
                  aria-label={t(playing ? "table.pauseTrack" : "table.playTrack", { title: tr.title, artist: tr.artist })}
                >
                  {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                </button>
                <HeartButton className="track-tile-like" liked={tr.liked} label={tr.title} size={18} onToggle={() => toggleTrackLike(tr.id)} />
              </span>
              <span className="track-title" title={tr.title}>
                {tr.title}
              </span>
              <ArtistLink className="track-artist" name={tr.artist} id={tr.artistId} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
