import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import type { Album } from "../types";
import { Cover } from "./Cover";
import { HeartButton, KebabMenu, Logo } from "./common";

interface AlbumCardProps {
  album: Album;
  className?: string;
  /** Show a heart toggle in the bottom-right corner. */
  showLike?: boolean;
}

/** Full-bleed album card (Albums of the Week style); clicking plays the album. */
export function AlbumCard({ album: a, className, showLike }: AlbumCardProps) {
  const { toggleAlbumLike } = useLibrary();
  const { current, isPlaying, playTrack } = usePlayer();
  const playing = isPlaying && !!current && a.trackIds.includes(current.id);
  const play = () => a.trackIds.length && playTrack(a.trackIds[0], a.trackIds);

  return (
    <li
      className={`album-card${playing ? " is-playing" : ""}${showLike ? " has-like" : ""}${className ? ` ${className}` : ""}`}
    >
      <Cover seed={a.id} />
      <button type="button" className="album-card-hit" onClick={play} aria-label={`Play album ${a.title} by ${a.artist}`} />
      <Logo className="logo-xs" />
      <KebabMenu
        className="album-kebab"
        label={`More options for ${a.title}`}
        items={[
          { label: "Play album", onSelect: play },
          {
            label: a.liked ? "Remove from favourites" : "Add to favourites",
            onSelect: () => toggleAlbumLike(a.id),
          },
        ]}
      />
      <div className="album-card-text">
        <h3>{a.title}</h3>
        <p>
          {a.artist} - {a.year}
        </p>
      </div>
      {showLike && (
        <HeartButton className="album-like" liked={a.liked} label={a.title} onToggle={() => toggleAlbumLike(a.id)} />
      )}
    </li>
  );
}
