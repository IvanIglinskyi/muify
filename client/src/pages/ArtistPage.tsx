import { ArrowLeft, Disc3, ExternalLink, Mic2, Shuffle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiRequestError, api } from "../api";
import { AlbumCard } from "../components/AlbumCard";
import { Cover } from "../components/Cover";
import { TrackTable } from "../components/TrackTable";
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
  const { id = "" } = useParams();
  const { query } = useShell();
  const { tracks, albums, mergeTracks, mergeAlbums } = useLibrary();
  const { playTrack } = usePlayer();
  const navigate = useNavigate();
  const [data, setData] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useDocumentTitle(data?.artist.id === id ? data.artist.name : "Artist");

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus("loading");
    api
      .getArtist(id, ctrl.signal)
      .then(({ topTracks, albums: list, ...artist }) => {
        setData({ artist, trackIds: mergeTracks(topTracks), albumIds: mergeAlbums(list) });
        setStatus("ready");
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        if (e instanceof ApiRequestError && (e.status === 404 || e.status === 400)) setStatus("notfound");
        else {
          setError(e.message);
          setStatus("error");
        }
      });
    return () => ctrl.abort();
  }, [id, reloadKey, mergeTracks, mergeAlbums]);

  const back = (
    <button type="button" className="back-link" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}>
      <ArrowLeft size={16} aria-hidden="true" /> Back
    </button>
  );

  if (status === "notfound") {
    return (
      <div className="page">
        {back}
        <EmptyState icon={<Mic2 size={28} />} title="Artist not found">
          <p>This artist may no longer be available.</p>
          <Link to="/explore" className="pill-btn">
            Explore music
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
          <span>Could not load this artist: {error}</span>
          <button type="button" className="link-btn" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
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
  const visible = top.filter((t) => matchesQuery(query, t.title, t.album));
  const albumList = data.albumIds.map((aid) => albums[aid]).filter(Boolean);
  const ids = top.map((t) => t.id);
  const joined = artist.joinDate ? new Date(`${artist.joinDate}T12:00:00`).getFullYear() : null;

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
            <Mic2 size={14} aria-hidden="true" /> Artist
          </span>
          <h1 id="artist-title" className="playlist-hero-title">
            {artist.name}
          </h1>
          <p className="meta">
            {top.length} top track{top.length === 1 ? "" : "s"}&nbsp;&nbsp;{albumList.length} album{albumList.length === 1 ? "" : "s"}
            {joined ? <span className="muted"> · on Jamendo since {joined}</span> : null}
          </p>
          <div className="hero-actions">
            <PlayAllButton ids={ids} name={`${artist.name} top tracks`} />
            <button
              type="button"
              className="ghost-btn"
              disabled={ids.length === 0}
              onClick={() => {
                const order = shuffled(ids);
                playTrack(order[0], order);
              }}
              aria-label={`Shuffle ${artist.name}`}
            >
              <Shuffle size={15} aria-hidden="true" /> Shuffle
            </button>
            {artist.shareUrl && (
              <a className="ghost-btn" href={artist.shareUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={15} aria-hidden="true" /> Jamendo
                <span className="sr-only"> (opens {artist.name} on jamendo.com in a new tab)</span>
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="card chart-panel" aria-labelledby="artist-top-title" aria-busy={status === "loading"}>
        <h2 id="artist-top-title" className="section-title small">
          Top tracks
        </h2>
        <div className="chart-scroll">
          <TrackTable
            tracks={visible}
            queue={ids}
            showRank
            caption={`${artist.name} top tracks`}
            empty={top.length === 0 ? "No playable tracks by this artist yet." : <>No tracks match “{query.trim()}”.</>}
          />
        </div>
      </section>

      <section className="artist-albums" aria-labelledby="artist-albums-title">
        <h2 id="artist-albums-title" className="section-title">
          Albums
        </h2>
        {albumList.length ? (
          <ul className="card-grid albums">
            {albumList.map((a) => (
              <AlbumCard key={a.id} album={a} showLike />
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Disc3 size={28} />} title="No albums yet" />
        )}
      </section>
    </div>
  );
}
