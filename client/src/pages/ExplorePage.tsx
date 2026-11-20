import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { AlbumCard } from "../components/AlbumCard";
import { Cover } from "../components/Cover";
import { SectionHeader } from "../components/common";
import { TrackTable } from "../components/TrackTable";
import { useLibrary } from "../store/LibraryContext";
import type { Genre } from "../types";
import { useDebounced, useDocumentTitle, useShell } from "./shell";

const RELEASES_LIMIT = 12;
const CHART_LIMIT = 20;

interface Results {
  albumIds: string[];
  trackIds: string[];
}

export function ExplorePage() {
  useDocumentTitle("Explore");
  const { query } = useShell();
  const { tracks, albums, mergeAlbums, mergeTracks } = useLibrary();
  const [params, setParams] = useSearchParams();
  const genreId = params.get("genre");
  const q = useDebounced(query.trim(), 250);
  const searching = q.length > 0;

  const [genres, setGenres] = useState<Genre[]>([]);
  const [results, setResults] = useState<Results | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .getGenres(ctrl.signal)
      .then(setGenres)
      .catch((e: Error) => e.name !== "AbortError" && setError(e.message));
    return () => ctrl.abort();
  }, [reloadKey]);

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus("loading");
    Promise.all([
      api.getAlbums({ genre: genreId, q, sort: "new", limit: searching ? undefined : RELEASES_LIMIT }, ctrl.signal),
      api.getTracks({ genre: genreId, q, sort: "top", limit: searching ? undefined : CHART_LIMIT }, ctrl.signal),
    ])
      .then(([albumList, trackList]) => {
        setResults({ albumIds: mergeAlbums(albumList), trackIds: mergeTracks(trackList) });
        setStatus("ready");
        setError(null);
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setStatus("error");
        setError(e.message);
      });
    return () => ctrl.abort();
  }, [genreId, q, searching, reloadKey, mergeAlbums, mergeTracks]);

  const selectGenre = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("genre", id);
    else next.delete("genre");
    setParams(next, { replace: true });
  };

  // Render from the shared index so likes stay live.
  const albumList = (results?.albumIds ?? []).map((id) => albums[id]).filter(Boolean);
  const trackList = (results?.trackIds ?? []).map((id) => tracks[id]).filter(Boolean);
  const activeGenre = genres.find((g) => g.id === genreId);
  const busy = status === "loading";
  const scope = [activeGenre?.name, searching ? `“${q}”` : null].filter(Boolean).join(" · ");

  return (
    <div className="page explore">
      <div className="page-head">
        <h1 className="page-title">Explore</h1>
        <p className="page-sub" role="status" aria-live="polite">
          {status === "ready" && (scope ? `${albumList.length} albums and ${trackList.length} tracks for ${scope}` : "Find new music by genre and mood")}
        </p>
      </div>

      <section aria-labelledby="genres-title">
        <SectionHeader
          title={<span id="genres-title">Genres &amp; moods</span>}
          action={genreId ? "Clear filter" : undefined}
          onAction={() => selectGenre(null)}
        />
        <ul className="genre-grid">
          {genres.map((g) => {
            const active = g.id === genreId;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  className={`genre-tile${active ? " is-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => selectGenre(active ? null : g.id)}
                  aria-label={`${g.name} (${g.kind}${g.trackCount === null ? "" : `, ${g.trackCount} tracks`})`}
                >
                  <Cover seed={`genre-${g.id}`} />
                  <span className="genre-name">{g.name}</span>
                  <span className="genre-kind">{g.kind === "mood" ? "Mood" : "Genre"}</span>
                  {active && (
                    <span className="genre-check" aria-hidden="true">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {genres.length === 0 &&
            Array.from({ length: 7 }, (_, i) => <li key={i} className="genre-tile skeleton" aria-hidden="true" />)}
        </ul>
      </section>

      {status === "error" && (
        <div className="inline-error" role="alert">
          <span>Could not load music: {error}</span>
          <button type="button" className="link-btn" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}

      <section aria-labelledby="releases-title" aria-busy={busy}>
        <SectionHeader title={<span id="releases-title">{searching ? "Albums" : "New releases"}</span>} />
        {albumList.length > 0 ? (
          <ul className={`album-row${busy ? " is-busy" : ""}`}>
            {albumList.map((a) => (
              <AlbumCard key={a.id} album={a} showLike />
            ))}
          </ul>
        ) : status === "ready" ? (
          <p className="empty-inline">No albums found{scope ? ` for ${scope}` : ""}.</p>
        ) : status === "loading" && !results ? (
          <ul className="album-row" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="album-card skeleton" />
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card chart-panel" aria-labelledby="charts-title" aria-busy={busy}>
        <SectionHeader title={<span id="charts-title">{searching ? "Tracks" : "Top charts"}</span>} />
        <div className={`chart-scroll${busy ? " is-busy" : ""}`}>
          <TrackTable
            tracks={trackList}
            showRank={!searching}
            caption={searching ? "Matching tracks" : "Top charts"}
            empty={status === "ready" ? <>No tracks found{scope ? ` for ${scope}` : ""}.</> : undefined}
          />
        </div>
      </section>
    </div>
  );
}
