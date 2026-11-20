import { useNavigate } from "react-router-dom";
import { useLibrary } from "../store/LibraryContext";
import { AlbumCard } from "./AlbumCard";
import { SectionHeader } from "./common";

export function AlbumsOfWeek() {
  const { weekAlbums } = useLibrary();
  const navigate = useNavigate();

  return (
    <section className="albums-week" aria-labelledby="aow-title">
      <SectionHeader title={<span id="aow-title">Albums of the Week</span>} action="See All" onAction={() => navigate("/albums/week")} />
      <ul className="albums-grid">
        {weekAlbums.map((a) => (
          <AlbumCard key={a.id} album={a} />
        ))}
      </ul>
    </section>
  );
}
