import { Pause, Play } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import type { Album } from "../types";
import { ArtistLink } from "./ArtistLink";
import { Cover } from "./Cover";
import { HeartButton, KebabMenu, Logo } from "./common";

interface AlbumCardProps {
  album: Album;
  className?: string;
  /** Show a heart toggle in the bottom-right corner. */
  showLike?: boolean;
}

export const albumPath = (id: string) => `/album/${encodeURIComponent(id)}`;

/** Full-bleed album card (Albums of the Week style): the card opens the album page, the round button plays it. */
export function AlbumCard({ album: a, className, showLike }: AlbumCardProps) {
  const t = useT();
  const { toggleAlbumLike } = useLibrary();
  const { current, isPlaying, playTrack, togglePlay } = usePlayer();
  const navigate = useNavigate();
  const fromHere = !!current && a.trackIds.includes(current.id);
  const playing = isPlaying && fromHere;
  const play = () => {
    if (fromHere) togglePlay();
    else if (a.trackIds.length) playTrack(a.trackIds[0], a.trackIds);
  };

  return (
    <li
      className={`album-card${playing ? " is-playing" : ""}${showLike ? " has-like" : ""}${className ? ` ${className}` : ""}`}
    >
      <Cover seed={a.id} src={a.coverUrl} />
      <Link to={albumPath(a.id)} className="album-card-hit" aria-label={t("albumCard.open", { title: a.title, artist: a.artist })} />
      <Logo className="logo-xs" />
      <KebabMenu
        className="album-kebab"
        label={t("table.moreOptions", { title: a.title })}
        items={[
          { label: t("menu.openAlbum"), onSelect: () => navigate(albumPath(a.id)) },
          ...(a.artistId ? [{ label: t("menu.goToArtist"), onSelect: () => navigate(`/artist/${encodeURIComponent(a.artistId!)}`) }] : []),
          { label: playing ? t("common.pause") : t("menu.playAlbum"), onSelect: play, disabled: a.trackIds.length === 0 },
          {
            label: a.liked ? t("menu.removeFavourite") : t("menu.addFavourite"),
            onSelect: () => toggleAlbumLike(a.id),
          },
        ]}
      />
      <div className="album-card-text">
        <h3>{a.title}</h3>
        <p>
          <ArtistLink name={a.artist} id={a.artistId} />
          {a.year ? ` - ${a.year}` : ""}
        </p>
      </div>
      <button
        type="button"
        className="play-circle album-card-play"
        onClick={play}
        disabled={a.trackIds.length === 0}
        aria-label={playing ? t("albumCard.pause", { title: a.title }) : t("albumCard.play", { title: a.title, artist: a.artist })}
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </button>
      {showLike && (
        <HeartButton className="album-like" liked={a.liked} label={a.title} onToggle={() => toggleAlbumLike(a.id)} />
      )}
    </li>
  );
}
