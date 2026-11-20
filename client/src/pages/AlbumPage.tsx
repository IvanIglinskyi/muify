import { ArrowLeft, Disc3, ExternalLink, Shuffle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiRequestError, api } from "../api";
import { ArtistLink } from "../components/ArtistLink";
import { Cover } from "../components/Cover";
import { HeartButton } from "../components/common";
import { TrackTable } from "../components/TrackTable";
import { useT } from "../i18n";
import { errorText } from "../lib/errors";
import { formatLongDuration } from "../lib/format";
import { openExternal } from "../lib/license";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import { EmptyState, PlayAllButton } from "./LibraryPage";
import { matchesQuery, useDocumentTitle, useShell } from "./shell";

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** /album/:id — cover, meta, Play all / Shuffle, like, track list. */
export function AlbumPage() {
  const t = useT();
  const { id = "" } = useParams();
  const { query } = useShell();
  const { albums, tracks, mergeAlbums, toggleAlbumLike } = useLibrary();
  const { playTrack } = usePlayer();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const album = albums[id];
  useDocumentTitle(album ? `${album.title} · ${album.artist}` : t("album.title"));

  // Always fetch: the index may know the album but not all of its tracks.
  useEffect(() => {
    const ctrl = new AbortController();
    setStatus("loading");
    api
      .getAlbum(id, ctrl.signal)
      .then((a) => {
        mergeAlbums([a]);
        setStatus("ready");
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        if (e instanceof ApiRequestError && e.status === 404) setStatus("notfound");
        else {
          setError(errorText(e));
          setStatus("error");
        }
      });
    return () => ctrl.abort();
  }, [id, reloadKey, mergeAlbums]);

  const back = (
    <button type="button" className="back-link" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}>
      <ArrowLeft size={16} aria-hidden="true" /> {t("common.back")}
    </button>
  );

  if (!album) {
    if (status === "notfound") {
      return (
        <div className="page">
          {back}
          <EmptyState icon={<Disc3 size={28} />} title={t("album.notFound")}>
            <p>{t("album.notFoundText")}</p>
            <Link to="/explore" className="pill-btn">
              {t("common.exploreAlbums")}
            </Link>
          </EmptyState>
        </div>
      );
    }
    if (status === "error") {
      return (
        <div className="page">
          {back}
          <div className="inline-error" role="alert">
            <span>{t("album.loadError", { error: error ?? "" })}</span>
            <button type="button" className="link-btn" onClick={() => setReloadKey((k) => k + 1)}>
              {t("common.retry")}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="page" aria-busy="true">
        {back}
        <div className="card playlist-hero album-hero skeleton" />
      </div>
    );
  }

  const list = album.trackIds.map((tid) => tracks[tid]).filter(Boolean);
  const visible = list.filter((x) => matchesQuery(query, x.title, x.artist));
  const ids = list.map((x) => x.id);
  const shareUrl = album.shareUrl;

  return (
    <div className="page album-page">
      {back}
      <section className="card playlist-hero album-hero" aria-labelledby="album-title">
        <Cover seed={`${album.id}-bg`} src={album.coverUrl} className="album-hero-bg" dim />
        <span className="playlist-hero-art album-hero-art">
          <Cover seed={album.id} src={album.coverUrl} />
        </span>
        <div className="playlist-hero-text">
          <span className="eyebrow">
            <Disc3 size={14} aria-hidden="true" /> {t("album.eyebrow")}
          </span>
          <h1 id="album-title" className="playlist-hero-title">
            {album.title}
          </h1>
          <p className="album-hero-artist">
            <ArtistLink name={album.artist} id={album.artistId} />
            {album.year ? ` - ${album.year}` : ""}
          </p>
          <p className="meta">
            {t("common.tracksMeta", { count: album.trackCount })}&nbsp;&nbsp;{formatLongDuration(album.duration)}
            {list.length < album.trackCount && status === "ready" && (
              <span className="muted"> · {t("album.availableHere", { count: list.length })}</span>
            )}
          </p>
          <div className="hero-actions">
            <PlayAllButton ids={ids} name={album.title} />
            <button
              type="button"
              className="ghost-btn"
              disabled={ids.length === 0}
              onClick={() => {
                const order = shuffled(ids);
                playTrack(order[0], order);
              }}
              aria-label={t("album.shuffle", { title: album.title })}
            >
              <Shuffle size={15} aria-hidden="true" /> {t("common.shuffle")}
            </button>
            <HeartButton liked={album.liked} label={t("heart.albumLabel", { title: album.title })} size={22} onToggle={() => toggleAlbumLike(album.id)} />
            {shareUrl && (
              <button
                type="button"
                className="icon-btn"
                aria-label={t("album.openJamendo", { title: album.title })}
                title={t("common.openJamendo")}
                onClick={() => openExternal(shareUrl)}
              >
                <ExternalLink size={18} />
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="card chart-panel" aria-label={t("album.tracksCaption", { title: album.title })} aria-busy={status === "loading"}>
        {status === "error" && (
          <p className="inline-error" role="alert">
            {t("album.refreshError", { error: error ?? "" })}
          </p>
        )}
        <div className="chart-scroll">
          <TrackTable
            tracks={visible}
            queue={ids}
            showRank
            hideAlbum
            caption={t("album.tracksCaption", { title: album.title })}
            empty={
              status === "loading"
                ? undefined
                : list.length === 0
                  ? t("album.noTracks")
                  : t("common.noMatch", { q: query.trim() })
            }
          />
        </div>
      </section>
    </div>
  );
}
