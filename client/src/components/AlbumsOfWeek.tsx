import { useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { useLibrary } from "../store/LibraryContext";
import { AlbumCard } from "./AlbumCard";
import { SectionHeader } from "./common";

export function AlbumsOfWeek() {
  const t = useT();
  const { weekAlbums } = useLibrary();
  const navigate = useNavigate();

  return (
    <section className="albums-week" aria-labelledby="aow-title">
      <SectionHeader title={<span id="aow-title">{t("aow.title")}</span>} action={t("common.seeAll")} onAction={() => navigate("/albums/week")} />
      <ul className="albums-grid">
        {weekAlbums.map((a) => (
          <AlbumCard key={a.id} album={a} />
        ))}
      </ul>
    </section>
  );
}
