import { ArrowLeft, Disc3, Heart, ListMusic, Pause, Play } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { AlbumCard } from "../components/AlbumCard";
import { Cover } from "../components/Cover";
import { TrackTable } from "../components/TrackTable";
import { formatLongDuration } from "../lib/format";
import { playlistIcon } from "../lib/playlistIcons";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import type { Playlist, Track } from "../types";
import { matchesQuery, useDocumentTitle, useShell } from "./shell";

const trackMatches = (q: string) => (t: Track) => matchesQuery(q, t.title, t.artist, t.album);

/** Layout for /library/*: title + tabs, the active tab renders in the outlet. */
export function LibraryPage() {
  const shell = useShell();
  const { playlists, likedTrackIds, likedAlbums } = useLibrary();
  const tabs = [
    { to: "playlists", label: "Playlists", count: playlists.length },
    { to: "liked", label: "Liked tracks", count: likedTrackIds.length },
    { to: "albums", label: "Albums", count: likedAlbums.length },
  ];

  return (
    <div className="page library">
      <div className="page-head">
        <h1 className="page-title">Library</h1>
      </div>
      <nav className="tabs" aria-label="Library sections">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab${isActive ? " is-active" : ""}`}>
            {t.label}
            <span className="tab-count">{t.count}</span>
          </NavLink>
        ))}
      </nav>
      {/* Nested routes don't inherit outlet context automatically. */}
      <Outlet context={shell} />
    </div>
  );
}

function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/** "Play all" pill: plays `ids` from the start, or pauses/resumes if already playing from it. */
function PlayAllButton({ ids, name }: { ids: string[]; name: string }) {
  const { current, isPlaying, playTrack, togglePlay } = usePlayer();
  const playingHere = !!current && ids.includes(current.id);
  const showPause = playingHere && isPlaying;
  return (
    <button
      type="button"
      className="pill-btn play-all"
      disabled={ids.length === 0}
      onClick={() => (playingHere ? togglePlay() : playTrack(ids[0], ids))}
      aria-label={`${showPause ? "Pause" : "Play all"} ${name}`}
    >
      {showPause ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      {showPause ? "Pause" : "Play all"}
    </button>
  );
}

function PlaylistArt({ playlist }: { playlist: Playlist }) {
  const ids = playlist.trackIds.slice(0, 4);
  if (ids.length < 4) return <Cover seed={playlist.id} />;
  return (
    <span className="mosaic">
      {ids.map((id) => (
        <Cover key={id} seed={id} />
      ))}
    </span>
  );
}

export function PlaylistsTab() {
  useDocumentTitle("Playlists");
  const { query } = useShell();
  const { playlists, loading, loadPlaylistTracks } = useLibrary();
  const { playTrack } = usePlayer();
  const list = playlists.filter((p) => matchesQuery(query, p.name));

  const play = async (id: string) => {
    try {
      const ids = await loadPlaylistTracks(id);
      if (ids.length) playTrack(ids[0], ids);
    } catch {
      /* nothing to play */
    }
  };

  if (loading) return <ul className="card-grid" aria-busy="true">{[0, 1, 2, 3].map((i) => <li key={i} className="playlist-card skeleton" />)}</ul>;
  if (playlists.length === 0) {
    return (
      <EmptyState icon={<ListMusic size={28} />} title="No playlists yet">
        <p>Playlists you create will appear here.</p>
      </EmptyState>
    );
  }
  if (list.length === 0) {
    return <EmptyState icon={<ListMusic size={28} />} title={`No playlists match “${query.trim()}”`} />;
  }

  return (
    <ul className="card-grid">
      {list.map((p) => {
        const Icon = playlistIcon(p.id);
        return (
          <li key={p.id} className="playlist-card">
            <Link to={p.id} className="playlist-card-link" aria-label={`Open playlist ${p.name}, ${p.trackIds.length} tracks`}>
              <span className="playlist-art">
                <PlaylistArt playlist={p} />
              </span>
              <span className="playlist-card-text">
                <span className="playlist-card-name">
                  <Icon size={16} aria-hidden="true" />
                  {p.name}
                </span>
                <span className="track-artist">{p.trackIds.length} tracks</span>
              </span>
            </Link>
            <button
              type="button"
              className="play-circle card-play"
              onClick={() => play(p.id)}
              disabled={p.trackIds.length === 0}
              aria-label={`Play playlist ${p.name}`}
            >
              <Play size={18} fill="currentColor" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function PlaylistDetail() {
  const { id = "" } = useParams();
  const { query } = useShell();
  const { playlists, tracks, loading, loadPlaylistTracks } = useLibrary();
  const playlist = playlists.find((p) => p.id === id);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useDocumentTitle(playlist?.name ?? "Playlist");

  // Make sure every track of the playlist is in the shared index (refetch only when the
  // playlist changes, not on every like).
  const playlistId = playlist?.id;
  useEffect(() => {
    if (!playlistId) return;
    let cancelled = false;
    setStatus("loading");
    loadPlaylistTracks(playlistId)
      .then(() => !cancelled && setStatus("ready"))
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [playlistId, loadPlaylistTracks]);

  const back = (
    <Link to="/library/playlists" className="back-link">
      <ArrowLeft size={16} aria-hidden="true" /> All playlists
    </Link>
  );

  if (!playlist) {
    if (loading) return <div className="playlist-hero skeleton" aria-busy="true" />;
    return (
      <>
        {back}
        <EmptyState icon={<ListMusic size={28} />} title="Playlist not found">
          <p>It may have been removed.</p>
        </EmptyState>
      </>
    );
  }

  // playlist.trackIds is live (Favourites updates as likes change).
  const all = playlist.trackIds.map((tid) => tracks[tid]).filter(Boolean);
  const visible = all.filter(trackMatches(query));
  const total = all.reduce((s, t) => s + t.duration, 0);
  const Icon = playlistIcon(playlist.id);

  return (
    <>
      {back}
      <section className="card playlist-hero" aria-labelledby="playlist-title">
        <span className="playlist-hero-art">
          <PlaylistArt playlist={playlist} />
        </span>
        <div className="playlist-hero-text">
          <span className="eyebrow">
            <Icon size={14} aria-hidden="true" /> Playlist
          </span>
          <h2 id="playlist-title" className="playlist-hero-title">
            {playlist.name}
          </h2>
          <p className="meta">
            {playlist.trackIds.length} Tracks&nbsp;&nbsp;{formatLongDuration(total)}
          </p>
          <PlayAllButton ids={visible.map((t) => t.id)} name={playlist.name} />
        </div>
      </section>

      <section className="card chart-panel" aria-label={`${playlist.name} tracks`} aria-busy={status === "loading"}>
        {status === "error" && (
          <p className="inline-error" role="alert">
            Could not load this playlist’s tracks.
          </p>
        )}
        <div className="chart-scroll">
          <TrackTable
            tracks={visible}
            caption={`${playlist.name} tracks`}
            empty={
              status === "loading" && all.length === 0
                ? undefined
                : all.length === 0
                  ? "This playlist is empty."
                  : <>No tracks match “{query.trim()}”.</>
            }
          />
        </div>
      </section>
    </>
  );
}

export function LikedTracksTab() {
  useDocumentTitle("Liked tracks");
  const { query } = useShell();
  const { likedTrackIds, tracks, loading } = useLibrary();
  // Newest likes first.
  const all = [...likedTrackIds].reverse().map((id) => tracks[id]).filter(Boolean);
  const visible = all.filter(trackMatches(query));

  if (loading) return <div className="card chart-panel skeleton" aria-busy="true" style={{ minHeight: 240 }} />;
  if (all.length === 0) {
    return (
      <EmptyState icon={<Heart size={28} />} title="No liked tracks yet">
        <p>Tap the heart on any track and it will show up here.</p>
        <Link to="/explore" className="pill-btn">
          Explore music
        </Link>
      </EmptyState>
    );
  }

  return (
    <section className="card chart-panel" aria-labelledby="liked-title">
      <div className="panel-head">
        <h2 id="liked-title" className="section-title">
          Liked tracks
        </h2>
        <PlayAllButton ids={visible.map((t) => t.id)} name="liked tracks" />
      </div>
      <div className="chart-scroll">
        <TrackTable tracks={visible} caption="Liked tracks" empty={<>No liked tracks match “{query.trim()}”.</>} />
      </div>
    </section>
  );
}

export function LikedAlbumsTab() {
  useDocumentTitle("Albums");
  const { query } = useShell();
  const { likedAlbums, loading } = useLibrary();
  const visible = likedAlbums.filter((a) => matchesQuery(query, a.title, a.artist));

  if (loading) return <ul className="card-grid" aria-busy="true">{[0, 1, 2].map((i) => <li key={i} className="album-card skeleton" />)}</ul>;
  if (likedAlbums.length === 0) {
    return (
      <EmptyState icon={<Disc3 size={28} />} title="No liked albums yet">
        <p>Like an album from Home or Explore to keep it here.</p>
        <Link to="/explore" className="pill-btn">
          Explore albums
        </Link>
      </EmptyState>
    );
  }
  if (visible.length === 0) {
    return <EmptyState icon={<Disc3 size={28} />} title={`No liked albums match “${query.trim()}”`} />;
  }

  return (
    <ul className="card-grid albums">
      {visible.map((a) => (
        <AlbumCard key={a.id} album={a} showLike />
      ))}
    </ul>
  );
}
