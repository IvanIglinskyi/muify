import { ArrowLeft, Disc3 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { AlbumCard } from "../components/AlbumCard";
import { useT } from "../i18n";
import { errorText } from "../lib/errors";
import { useLibrary } from "../store/LibraryContext";
import { EmptyState } from "./LibraryPage";
import { matchesQuery, useDocumentTitle, useShell } from "./shell";

/** /albums/week — "See All" for Albums of the Week. */
export function WeekAlbumsPage() {
  const t = useT();
  useDocumentTitle(t("week.title"));
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
      .catch((e: Error) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [reloadKey, mergeAlbums]);

  const list = (ids ?? []).map((id) => albums[id]).filter(Boolean);
  const visible = list.filter((a) => matchesQuery(query, a.title, a.artist));

  return (
    <div className="page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> {t("common.home")}
      </Link>
      <div className="page-head">
        <h1 className="page-title">{t("week.title")}</h1>
        <p className="page-sub">{ids ? t("week.count", { count: list.length }) : " "}</p>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <span>{t("week.loadError", { error })}</span>
          <button type="button" className="link-btn" onClick={() => setReloadKey((k) => k + 1)}>
            {t("common.retry")}
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
        <EmptyState icon={<Disc3 size={28} />} title={query.trim() ? t("week.noMatch", { q: query.trim() }) : t("week.none")} />
      ) : null}
    </div>
  );
}
