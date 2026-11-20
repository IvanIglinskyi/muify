import { ArrowLeft, Disc3, ExternalLink, Mic2, Shuffle, UserCheck, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiRequestError, api } from "../api";
import { AlbumCard } from "../components/AlbumCard";
import { Cover } from "../components/Cover";
import { TrackTable } from "../components/TrackTable";
import { useT } from "../i18n";
import { errorText } from "../lib/errors";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import type { Artist } from "../types";
import { EmptyState, PlayAllButton } from "./LibraryPage";
import { matchesQuery, useDocumentTitle, useShell } from "./shell";

interface Loaded {
  artist: Artist;
  trackIds: string[];
  albumIds: string[];
}

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** /artist/:id — photo, name, top tracks (play all), albums, link to Jamendo. */
export function ArtistPage() {
  const t = useT();
  const { id = "" } = useParams();
  const { query } = useShell();
  const { tracks, albums, mergeTracks, mergeAlbums, toggleFollow, follows } = useLibrary();
  const { playTrack } = usePlayer();
  const navigate = useNavigate();
  const [data, setData] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useDocumentTitle(data?.artist.id === id ? data.artist.name : t("artist.title"));

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus("loading");
    api
      .getArtist(id, ctrl.signal)
      .then(({ topTracks, albums: list, following: _f, ...artist }) => {
        setData({ artist, trackIds: mergeTracks(topTracks), albumIds: mergeAlbums(list) });
        setStatus("ready");
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        if (e instanceof ApiRequestError && (e.status === 404 || e.status === 400)) setStatus("notfound");
        else {
          setError(errorText(e));
          setStatus("error");
        }
      });
    return () => ctrl.abort();
  }, [id, reloadKey, mergeTracks, mergeAlbums]);

  const back = (
    <button type="button" className="back-link" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}>
      <ArrowLeft size={16} aria-hidden="true" /> {t("common.back")}
    </button>
  );

  if (status === "notfound") {
    return (
      <div className="page">
        {back}
        <EmptyState icon={<Mic2 size={28} />} title={t("artist.notFound")}>
          <p>{t("artist.notFoundText")}</p>
          <Link to="/explore" className="pill-btn">
            {t("common.exploreMusic")}
          </Link>
        </EmptyState>
      </div>
    );
  }
  if (status === "error" && !data) {
    return (
      <div className="page">
        {back}
        <div className="inline-error" role="alert">
          <span>{t("artist.loadError", { error: error ?? "" })}</span>
          <button type="button" className="link-btn" onClick={() => setReloadKey((k) => k + 1)}>
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }
  if (!data || data.artist.id !== id) {
    return (
      <div className="page" aria-busy="true">
        {back}
        <div className="card playlist-hero album-hero skeleton" />
      </div>
    );
  }

  const { artist } = data;
  const top = data.trackIds.map((tid) => tracks[tid]).filter(Boolean);
  const visible = top.filter((x) => matchesQuery(query, x.title, x.album));
  const albumList = data.albumIds.map((aid) => albums[aid]).filter(Boolean);
  const ids = top.map((x) => x.id);
  const joined = artist.joinDate ? new Date(`${artist.joinDate}T12:00:00`).getFullYear() : null;
  const following = follows.some((f) => f.id === artist.id);

  return (
    <div className="page artist-page">
      {back}
      <section className="card playlist-hero album-hero artist-hero" aria-labelledby="artist-title">
        <Cover seed={`${artist.id}-bg`} src={artist.imageUrl} className="album-hero-bg" dim />
        <span className="playlist-hero-art album-hero-art artist-hero-art">
          <Cover seed={artist.id} src={artist.imageUrl} />
        </span>
        <div className="playlist-hero-text">
          <span className="eyebrow">
            <Mic2 size={14} aria-hidden="true" /> {t("artist.eyebrow")}
          </span>
          <h1 id="artist-title" className="playlist-hero-title">
            {artist.name}
          </h1>
          <p className="meta">
            {t("artist.topTracksCount", { count: top.length })}&nbsp;&nbsp;{t("common.albumsCount", { count: albumList.length })}
            {joined ? <span className="muted"> · {t("artist.since", { year: String(joined) })}</span> : null}
          </p>
          <div className="hero-actions">
            <button
              type="button"
              className={`follow-btn${following ? " is-on" : ""}`}
              aria-pressed={following}
              aria-label={following ? t("artist.unfollowLabel", { name: artist.name }) : t("artist.followLabel", { name: artist.name })}
              title={following ? undefined : t("artist.followHint")}
              onClick={() => void toggleFollow(artist)}
            >
              {following ? <UserCheck size={16} aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}
              {following ? t("artist.following") : t("artist.follow")}
            </button>
            <PlayAllButton ids={ids} name={t("artist.topTracksName", { name: artist.name })} />
            <button
              type="button"
              className="ghost-btn"
              disabled={ids.length === 0}
              onClick={() => {
                const order = shuffled(ids);
                playTrack(order[0], order);
              }}
              aria-label={t("artist.shuffle", { name: artist.name })}
            >
              <Shuffle size={15} aria-hidden="true" /> {t("common.shuffle")}
            </button>
            {artist.shareUrl && (
              <a className="ghost-btn" href={artist.shareUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={15} aria-hidden="true" /> {t("common.jamendo")}
                <span className="sr-only"> {t("artist.jamendoNewTab", { name: artist.name })}</span>
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="card chart-panel" aria-labelledby="artist-top-title" aria-busy={status === "loading"}>
        <h2 id="artist-top-title" className="section-title small">
          {t("artist.topTracks")}
        </h2>
        <div className="chart-scroll">
          <TrackTable
            tracks={visible}
            queue={ids}
            showRank
            caption={t("artist.topTracksName", { name: artist.name })}
            empty={top.length === 0 ? t("artist.noTracks") : t("common.noMatch", { q: query.trim() })}
          />
        </div>
      </section>

      <section className="artist-albums" aria-labelledby="artist-albums-title">
        <h2 id="artist-albums-title" className="section-title">
          {t("artist.albums")}
        </h2>
        {albumList.length ? (
          <ul className="card-grid albums">
            {albumList.map((a) => (
              <AlbumCard key={a.id} album={a} showLike />
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Disc3 size={28} />} title={t("artist.noAlbums")} />
        )}
      </section>
    </div>
  );
}
