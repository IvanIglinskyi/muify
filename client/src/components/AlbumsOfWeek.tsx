import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import { Cover } from "./Cover";
import { KebabMenu, Logo, SectionHeader } from "./common";

export function AlbumsOfWeek() {
  const { weekAlbums, toggleAlbumLike } = useLibrary();
  const { current, isPlaying, playTrack } = usePlayer();

  return (
    <section className="albums-week" aria-labelledby="aow-title">
      <SectionHeader title={<span id="aow-title">Albums of the Week</span>} action="See All" />
      <ul className="albums-grid">
        {weekAlbums.map((a) => {
          const playing = isPlaying && !!current && a.trackIds.includes(current.id);
          const play = () => a.trackIds.length && playTrack(a.trackIds[0], a.trackIds);
          return (
            <li key={a.id} className={`album-card${playing ? " is-playing" : ""}`}>
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
