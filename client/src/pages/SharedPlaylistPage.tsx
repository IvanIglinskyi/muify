import { Globe, Link2Off, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiRequestError, api } from "../api";
import { Cover } from "../components/Cover";
import { TrackTable } from "../components/TrackTable";
import { formatLongDuration } from "../lib/format";
import { useAuth } from "../store/AuthContext";
import { useLibrary } from "../store/LibraryContext";
import type { SharedPlaylist } from "../types";
import { EmptyState, PlayAllButton } from "./LibraryPage";
import { matchesQuery, useDocumentTitle, useShell } from "./shell";

type Meta = Omit<SharedPlaylist, "tracks">;

/** /p/:shareId — public, read-only playlist anyone can open and play (guests included). */
export function SharedPlaylistPage() {
  const { shareId = "" } = useParams();
  const { query } = useShell();
  const { tracks, mergeTracks } = useLibrary();
  const { identityKey } = useAuth();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(meta?.name ?? "Shared playlist");

  useEffect(() => {
    if (identityKey === null) return; // wait for the session: the owner sees an "Edit" link
    const ctrl = new AbortController();
    setStatus("loading");
    api
      .getSharedPlaylist(shareId, ctrl.signal)
      .then(({ tracks: list, ...rest }) => {
        mergeTracks(list);
        setMeta(rest);
        setStatus("ready");
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        if (e instanceof ApiRequestError && e.status === 404) setStatus("notfound");
        else {
          setError(e.message);
          setStatus("error");
        }
      });
    return () => ctrl.abort();
  }, [shareId, identityKey, mergeTracks]);

  if (status === "notfound") {
    return (
      <div className="page">
        <EmptyState icon={<Link2Off size={28} />} title="This link isn’t active">
          <p>The playlist may have been made private or deleted.</p>
          <Link to="/" className="pill-btn">
            Go home
          </Link>
        </EmptyState>
      </div>
    );
  }
  if (status === "error" && !meta) {
    return (
      <div className="page">
        <p className="inline-error" role="alert">
          Could not load this playlist: {error}
        </p>
      </div>
    );
  }
  if (!meta) return <div className="page" aria-busy="true"><div className="card playlist-hero skeleton" /></div>;

  const all = meta.trackIds.map((id) => tracks[id]).filter(Boolean);
  const visible = all.filter((t) => matchesQuery(query, t.title, t.artist, t.album));
  const total = all.reduce((s, t) => s + t.duration, 0);
  const art = all.slice(0, 4);

  return (
    <div className="page shared-page">
      <section className="card playlist-hero" aria-labelledby="shared-title">
        <span className="playlist-hero-art">
          {art.length < 4 ? (
            <Cover seed={meta.shareId} src={art[0]?.coverUrl} />
          ) : (
            <span className="mosaic">
              {art.map((t) => (
                <Cover key={t.id} seed={t.id} src={t.coverUrl} />
              ))}
            </span>
          )}
        </span>
        <div className="playlist-hero-text">
          <span className="eyebrow">
            <Globe size={14} aria-hidden="true" /> Shared playlist
            {meta.ownerName && <span className="muted"> · by {meta.ownerName}</span>}
          </span>
          <h1 id="shared-title" className="playlist-hero-title">
            {meta.name}
          </h1>
          {meta.description && <p className="playlist-description">{meta.description}</p>}
          <p className="meta">
            {all.length} Tracks&nbsp;&nbsp;{formatLongDuration(total)}
          </p>
          <div className="hero-actions">
            <PlayAllButton ids={visible.map((t) => t.id)} name={meta.name} />
            {meta.ownedByYou && meta.playlistId && (
              <Link to={`/library/playlists/${encodeURIComponent(meta.playlistId)}`} className="ghost-btn">
                <Pencil size={15} aria-hidden="true" /> Edit in your library
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="card chart-panel" aria-label={`${meta.name} tracks`}>
        <div className="chart-scroll">
          <TrackTable
            tracks={visible}
            caption={`${meta.name} tracks`}
            empty={all.length === 0 ? "This playlist is empty." : <>No tracks match “{query.trim()}”.</>}
          />
        </div>
      </section>
    </div>
  );
}
