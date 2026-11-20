import { ArrowLeft, Disc3 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { AlbumCard } from "../components/AlbumCard";
import { useLibrary } from "../store/LibraryContext";
import { EmptyState } from "./LibraryPage";
import { matchesQuery, useDocumentTitle, useShell } from "./shell";

/** /albums/week — "See All" for Albums of the Week. */
export function WeekAlbumsPage() {
  useDocumentTitle("Albums of the Week");
  const { query } = useShell();
  const { albums, mergeAlbums } = useLibrary();
  const [ids, setIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .getWeekAlbums(true)
      .then((list) => {
        if (cancelled) return;
        setIds(mergeAlbums(list));
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [reloadKey, mergeAlbums]);

  const list = (ids ?? []).map((id) => albums[id]).filter(Boolean);
  const visible = list.filter((a) => matchesQuery(query, a.title, a.artist));

  return (
    <div className="page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> Home
      </Link>
      <div className="page-head">
        <h1 className="page-title">Albums of the Week</h1>
        <p className="page-sub">{ids ? `${list.length} albums popular this week` : " "}</p>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <span>Could not load albums: {error}</span>
          <button type="button" className="link-btn" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}
      {!ids && !error ? (
        <ul className="card-grid" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="album-card skeleton" />
          ))}
        </ul>
      ) : visible.length ? (
        <ul className="card-grid albums">
          {visible.map((a) => (
            <AlbumCard key={a.id} album={a} showLike />
          ))}
        </ul>
      ) : ids ? (
        <EmptyState icon={<Disc3 size={28} />} title={query.trim() ? `No albums match “${query.trim()}”` : "No albums this week"} />
      ) : null}
    </div>
  );
}
