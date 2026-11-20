import { useLibrary } from "../store/LibraryContext";
import { AlbumCard } from "./AlbumCard";
import { SectionHeader } from "./common";

export function AlbumsOfWeek() {
  const { weekAlbums } = useLibrary();

  return (
    <section className="albums-week" aria-labelledby="aow-title">
      <SectionHeader title={<span id="aow-title">Albums of the Week</span>} action="See All" />
      <ul className="albums-grid">
        {weekAlbums.map((a) => (
          <AlbumCard key={a.id} album={a} />
        ))}
      </ul>
    </section>
  );
}
