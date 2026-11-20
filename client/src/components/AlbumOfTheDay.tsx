import { Pause, Play } from "lucide-react";
import { formatLongDuration } from "../lib/format";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import { Cover } from "./Cover";
import { HeartButton, Logo } from "./common";

/** Smooth sine-like ribbon built from cubic segments. */
function wavePath(width: number, midY: number, amp: number, half: number): string {
  let prevY = midY + amp;
  let d = `M ${-half} ${prevY}`;
  for (let x = -half; x < width + half; x += half) {
    const y = prevY > midY ? midY - amp : midY + amp;
    const cx = x + half * 0.5;
    d += ` C ${cx} ${prevY}, ${cx} ${y}, ${x + half} ${y}`;
    prevY = y;
  }
  return d;
}

export function AlbumOfTheDay() {
  const { albumOfTheDay: album, toggleAlbumLike } = useLibrary();
  const { current, isPlaying, playTrack, togglePlay } = usePlayer();

  if (!album) return <div className="card album-day skeleton" aria-busy="true" />;

  const isThisPlaying = !!current && album.trackIds.includes(current.id) && isPlaying;
  const onPlay = () => {
    if (current && album.trackIds.includes(current.id)) togglePlay();
    else if (album.trackIds.length) playTrack(album.trackIds[0], album.trackIds);
  };

  return (
    <section className="card album-day" aria-labelledby="aotd-title">
      <Cover seed={`${album.id}-bg`} src={album.coverUrl} className="album-day-bg" dim />
      <svg className="ribbon" viewBox="0 0 560 420" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="ribbonGrad" x1="0" x2="1">
            <stop offset="0" stopColor="#c47a12" />
            <stop offset="0.5" stopColor="#e08a17" />
            <stop offset="1" stopColor="#b56d10" />
          </linearGradient>
        </defs>
        <path d={wavePath(560, 205, 80, 105)} stroke="url(#ribbonGrad)" strokeWidth="44" fill="none" strokeLinecap="round" />
      </svg>

      <div className="album-day-head">
        <div>
          <h2 id="aotd-title" className="album-day-heading">Album of the day</h2>
          <p className="meta">
            {album.trackCount} Tracks&nbsp;&nbsp;{formatLongDuration(album.duration)}
          </p>
        </div>
        <Logo className="logo-sm" />
      </div>

      <div className="album-day-cover">
        <Cover seed={album.id} src={album.coverUrl} />
        <button
          type="button"
          className="play-circle"
          onClick={onPlay}
          aria-label={isThisPlaying ? `Pause ${album.title}` : `Play ${album.title}`}
        >
          {isThisPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </button>
      </div>

      <div className="album-day-foot">
        <div>
          <h3 className="album-day-title">{album.title}</h3>
          <p className="meta">
            {album.artist} - {album.year}
          </p>
        </div>
        <HeartButton liked={album.liked} label={album.title} size={24} onToggle={() => toggleAlbumLike(album.id)} />
      </div>
    </section>
  );
}
