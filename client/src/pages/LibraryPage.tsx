import {
  AlignLeft,
  ArrowLeft,
  Clock,
  Copy,
  Disc3,
  ExternalLink,
  Globe,
  Heart,
  ListMusic,
  Lock,
  Mic2,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  UserCheck,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { AlbumCard } from "../components/AlbumCard";
import { artistPath } from "../components/ArtistLink";
import { Cover } from "../components/Cover";
import { useDialogs } from "../components/Dialogs";
import { TrackTable } from "../components/TrackTable";
import { useNewPlaylist } from "../components/useTrackMenu";
import { useT, type MessageKey } from "../i18n";
import { errorText } from "../lib/errors";
import { formatDate, formatDateTime, formatLongDuration, formatRelative } from "../lib/format";
import { playlistName } from "../lib/names";
import { playlistIcon } from "../lib/playlistIcons";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import type { HistoryItem, Playlist, Track } from "../types";
import { matchesQuery, useDocumentTitle, useShell } from "./shell";

const trackMatches = (q: string) => (t: Track) => matchesQuery(q, t.title, t.artist, t.album);

/** Layout for /library/*: title + tabs, the active tab renders in the outlet. */
export function LibraryPage() {
  const t = useT();
  const shell = useShell();
  const { playlists, likedTrackIds, likedAlbums, follows } = useLibrary();
  const tabs: { to: string; label: MessageKey; count: number | null }[] = [
    { to: "playlists", label: "library.tab.playlists", count: playlists.length },
    { to: "liked", label: "library.tab.liked", count: likedTrackIds.length },
    { to: "albums", label: "library.tab.albums", count: likedAlbums.length },
    { to: "artists", label: "library.tab.artists", count: follows.length },
    { to: "history", label: "library.tab.history", count: null },
  ];

  return (
    <div className="page library">
      <div className="page-head">
        <h1 className="page-title">{t("library.title")}</h1>
      </div>
      <nav className="tabs" aria-label={t("library.sections")}>
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} className={({ isActive }) => `tab${isActive ? " is-active" : ""}`}>
            {t(tab.label)}
            {tab.count !== null && <span className="tab-count">{tab.count}</span>}
          </NavLink>
        ))}
      </nav>
      {/* Nested routes don't inherit outlet context automatically. */}
      <Outlet context={shell} />
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
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
export function PlayAllButton({ ids, name }: { ids: string[]; name: string }) {
  const t = useT();
  const { current, isPlaying, playTrack, togglePlay } = usePlayer();
  const playingHere = !!current && ids.includes(current.id);
  const showPause = playingHere && isPlaying;
  const label = showPause ? t("common.pause") : t("common.playAll");
  return (
    <button
      type="button"
      className="pill-btn play-all"
      disabled={ids.length === 0}
      onClick={() => (playingHere ? togglePlay() : playTrack(ids[0], ids))}
      aria-label={`${label}: ${name}`}
    >
      {showPause ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      {label}
    </button>
  );
}

function PlaylistArt({ playlist }: { playlist: Playlist }) {
  const { tracks } = useLibrary();
  const ids = playlist.trackIds.slice(0, 4);
  if (ids.length < 4) return <Cover seed={playlist.id} src={tracks[ids[0]]?.coverUrl} />;
  return (
    <span className="mosaic">
      {ids.map((id) => (
        <Cover key={id} seed={id} src={tracks[id]?.coverUrl} />
      ))}
    </span>
  );
}

export function PlaylistsTab() {
  const t = useT();
  useDocumentTitle(t("library.tab.playlists"));
  const { query } = useShell();
  const { playlists, loading, loadPlaylistTracks } = useLibrary();
  const { playTrack } = usePlayer();
  const newPlaylist = useNewPlaylist();
  const navigate = useNavigate();
  const list = playlists.filter((p) => matchesQuery(query, playlistName(p)));

  const create = async () => {
    const p = await newPlaylist();
    if (p) navigate(encodeURIComponent(p.id));
  };
  const createButton = (
    <button type="button" className="pill-btn new-playlist-btn" onClick={create}>
      <Plus size={16} aria-hidden="true" /> {t("library.newPlaylist")}
    </button>
  );

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
      <EmptyState icon={<ListMusic size={28} />} title={t("library.noPlaylists")}>
        <p>{t("library.noPlaylistsText")}</p>
        {createButton}
      </EmptyState>
    );
  }
  if (list.length === 0) {
    return (
      <>
        <div className="toolbar">{createButton}</div>
        <EmptyState icon={<ListMusic size={28} />} title={t("library.noPlaylistsMatch", { q: query.trim() })} />
      </>
    );
  }

  return (
    <>
      <div className="toolbar">{createButton}</div>
      <ul className="card-grid">
        {list.map((p) => {
          const Icon = playlistIcon(p.id);
          const name = playlistName(p);
          return (
            <li key={p.id} className="playlist-card">
              <Link to={p.id} className="playlist-card-link" aria-label={t("library.openPlaylist", { name, count: p.trackIds.length })}>
                <span className="playlist-art">
                  <PlaylistArt playlist={p} />
                </span>
                <span className="playlist-card-text">
                  <span className="playlist-card-name">
                    <Icon size={16} aria-hidden="true" />
                    {name}
                  </span>
                  <span className="track-artist">{t("common.tracksCount", { count: p.trackIds.length })}</span>
                </span>
              </Link>
              <button
                type="button"
                className="play-circle card-play"
                onClick={() => play(p.id)}
                disabled={p.trackIds.length === 0}
                aria-label={t("library.playPlaylist", { name })}
              >
                <Play size={18} fill="currentColor" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export const sharePath = (shareId: string) => `/p/${encodeURIComponent(shareId)}`;
export const shareUrl = (shareId: string) => `${window.location.origin}${sharePath(shareId)}`;

/** "Public link" switch + copyable URL for a user playlist. */
function SharePanel({ playlist }: { playlist: Playlist }) {
  const t = useT();
  const { setPlaylistShared, notifyInfo, notify } = useLibrary();
  const [busy, setBusy] = useState(false);
  const shared = Boolean(playlist.shareId);
  const url = playlist.shareId ? shareUrl(playlist.shareId) : "";

  const toggle = async () => {
    setBusy(true);
    await setPlaylistShared(playlist.id, !shared);
    setBusy(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      notifyInfo(t("share.copied"));
    } catch {
      notify(t("share.copyFailed"));
    }
  };

  return (
    <div className="share-panel">
      <button
        type="button"
        role="switch"
        aria-checked={shared}
        className={`switch${shared ? " is-on" : ""}`}
        onClick={toggle}
        disabled={busy}
      >
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
        <Globe size={15} aria-hidden="true" /> {t("share.public")}
      </button>
      {shared && (
        <div className="share-url">
          <input type="text" readOnly value={url} aria-label={t("share.urlLabel")} onFocus={(e) => e.target.select()} />
          <button type="button" className="icon-btn" onClick={copy} aria-label={t("share.copy")} title={t("share.copyShort")}>
            <Copy size={16} />
          </button>
          <Link to={sharePath(playlist.shareId!)} className="icon-btn" aria-label={t("share.open")} title={t("share.open")}>
            <ExternalLink size={16} />
          </Link>
        </div>
      )}
      <p className="share-hint">{shared ? t("share.onHint") : t("share.offHint")}</p>
    </div>
  );
}

export function PlaylistDetail() {
  const t = useT();
  const { id = "" } = useParams();
  const { query } = useShell();
  const { playlists, tracks, loading, loadPlaylistTracks, renamePlaylist, deletePlaylist, setPlaylistDescription, reorderPlaylist, notifyInfo } =
    useLibrary();
  const { prompt, confirm } = useDialogs();
  const navigate = useNavigate();
  const playlist = playlists.find((p) => p.id === id);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const name = playlist ? playlistName(playlist) : t("library.playlist");
  useDocumentTitle(name);

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
      <ArrowLeft size={16} aria-hidden="true" /> {t("library.allPlaylists")}
    </Link>
  );

  if (!playlist) {
    if (loading) return <div className="playlist-hero skeleton" aria-busy="true" />;
    return (
      <>
        {back}
        <EmptyState icon={<ListMusic size={28} />} title={t("library.playlistNotFound")}>
          <p>{t("library.playlistNotFoundText")}</p>
        </EmptyState>
      </>
    );
  }

  // playlist.trackIds is live (Favourites updates as likes change).
  const all = playlist.trackIds.map((tid) => tracks[tid]).filter(Boolean);
  const visible = all.filter(trackMatches(query));
  const total = all.reduce((s, x) => s + x.duration, 0);
  const Icon = playlistIcon(playlist.id);
  const editable = playlist.kind === "user";

  const onRename = async () => {
    const next = await prompt({
      title: t("playlistDialog.renameTitle"),
      label: t("playlistDialog.nameLabel"),
      initial: playlist.name,
      confirmLabel: t("playlistDialog.rename"),
    });
    if (next && next !== playlist.name) await renamePlaylist(playlist.id, next);
  };
  const onDelete = async () => {
    const ok = await confirm({
      title: t("playlistDialog.deleteTitle", { name }),
      message: t("playlistDialog.deleteText"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (ok && (await deletePlaylist(playlist.id))) navigate("/library/playlists", { replace: true });
  };
  const onDescribe = async () => {
    const text = await prompt({
      title: playlist.description ? t("playlistDialog.editDescription") : t("playlistDialog.addDescription"),
      label: t("playlistDialog.descriptionLabel"),
      initial: playlist.description ?? "",
      confirmLabel: t("common.save"),
      multiline: true,
      allowEmpty: true,
      maxLength: 300,
      hint: t("playlistDialog.descriptionHint"),
    });
    if (text !== null && text !== (playlist.description ?? "")) await setPlaylistDescription(playlist.id, text);
  };

  // Reordering works on the full list (disabled while a search filters it).
  const canReorder = editable && !query.trim() && all.length > 1 && all.length === playlist.trackIds.length;
  const onMove = (from: number, to: number) => {
    const order = all.map((x) => x.id);
    if (to < 0 || to >= order.length || from === to) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    void reorderPlaylist(playlist.id, order);
    const tr = tracks[moved];
    if (tr) notifyInfo(t("table.moved", { title: tr.title, position: to + 1 }));
  };

  return (
    <>
      {back}
      <section className="card playlist-hero" aria-labelledby="playlist-title">
        <span className="playlist-hero-art">
          <PlaylistArt playlist={playlist} />
        </span>
        <div className="playlist-hero-text">
          <span className="eyebrow">
            <Icon size={14} aria-hidden="true" /> {editable ? t("library.yourPlaylist") : t("library.playlist")}
            {playlist.kind === "builtin" && (
              <span className="badge" title={t("library.readOnlyHint")}>
                <Lock size={11} aria-hidden="true" /> {t("library.readOnly")}
              </span>
            )}
          </span>
          <h2 id="playlist-title" className="playlist-hero-title">
            {name}
          </h2>
          {playlist.description && <p className="playlist-description">{playlist.description}</p>}
          <p className="meta">
            {t("common.tracksMeta", { count: playlist.trackIds.length })}&nbsp;&nbsp;{formatLongDuration(total)}
          </p>
          <div className="hero-actions">
            <PlayAllButton ids={visible.map((x) => x.id)} name={name} />
            {editable && (
              <>
                <button type="button" className="ghost-btn" onClick={onRename}>
                  <Pencil size={15} aria-hidden="true" /> {t("library.rename")}
                </button>
                <button type="button" className="ghost-btn" onClick={onDescribe}>
                  <AlignLeft size={15} aria-hidden="true" /> {playlist.description ? t("library.editDescription") : t("library.addDescription")}
                </button>
                <button type="button" className="ghost-btn is-danger" onClick={onDelete}>
                  <Trash2 size={15} aria-hidden="true" /> {t("common.delete")}
                </button>
              </>
            )}
          </div>
          {editable && <SharePanel playlist={playlist} />}
        </div>
      </section>

      <section className="card chart-panel" aria-label={t("library.tracksCaption", { name })} aria-busy={status === "loading"}>
        {editable && all.length > 1 && <p className="reorder-hint">{canReorder ? t("library.reorderHint") : t("library.reorderClearSearch")}</p>}
        {status === "error" && (
          <p className="inline-error" role="alert">
            {t("library.tracksLoadError")}
          </p>
        )}
        <div className="chart-scroll">
          <TrackTable
            tracks={visible}
            caption={t("library.tracksCaption", { name })}
            playlistId={playlist.id}
            reorder={canReorder ? { onMove } : undefined}
            empty={
              status === "loading" && all.length === 0
                ? undefined
                : all.length === 0
                  ? editable
                    ? t("library.emptyEditable")
                    : t("library.empty")
                  : t("common.noMatch", { q: query.trim() })
            }
          />
        </div>
      </section>
    </>
  );
}

export function LikedTracksTab() {
  const t = useT();
  useDocumentTitle(t("library.liked"));
  const { query } = useShell();
  const { likedTrackIds, tracks, loading } = useLibrary();
  // Newest likes first.
  const all = [...likedTrackIds].reverse().map((id) => tracks[id]).filter(Boolean);
  const visible = all.filter(trackMatches(query));

  if (loading) return <div className="card chart-panel skeleton" aria-busy="true" style={{ minHeight: 240 }} />;
  if (all.length === 0) {
    return (
      <EmptyState icon={<Heart size={28} />} title={t("library.noLiked")}>
        <p>{t("library.noLikedText")}</p>
        <Link to="/explore" className="pill-btn">
          {t("common.exploreMusic")}
        </Link>
      </EmptyState>
    );
  }

  return (
    <section className="card chart-panel" aria-labelledby="liked-title">
      <div className="panel-head">
        <h2 id="liked-title" className="section-title">
          {t("library.liked")}
        </h2>
        <PlayAllButton ids={visible.map((x) => x.id)} name={t("library.likedName")} />
      </div>
      <div className="chart-scroll">
        <TrackTable tracks={visible} caption={t("library.liked")} playlistId="p-favourites" empty={t("library.noLikedMatch", { q: query.trim() })} />
      </div>
    </section>
  );
}

export function LikedAlbumsTab() {
  const t = useT();
  useDocumentTitle(t("library.tab.albums"));
  const { query } = useShell();
  const { likedAlbums, loading } = useLibrary();
  const visible = likedAlbums.filter((a) => matchesQuery(query, a.title, a.artist));

  if (loading) return <ul className="card-grid" aria-busy="true">{[0, 1, 2].map((i) => <li key={i} className="album-card skeleton" />)}</ul>;
  if (likedAlbums.length === 0) {
    return (
      <EmptyState icon={<Disc3 size={28} />} title={t("library.noAlbums")}>
        <p>{t("library.noAlbumsText")}</p>
        <Link to="/explore" className="pill-btn">
          {t("common.exploreAlbums")}
        </Link>
      </EmptyState>
    );
  }
  if (visible.length === 0) {
    return <EmptyState icon={<Disc3 size={28} />} title={t("library.noAlbumsMatch", { q: query.trim() })} />;
  }

  return (
    <ul className="card-grid albums">
      {visible.map((a) => (
        <AlbumCard key={a.id} album={a} showLike />
      ))}
    </ul>
  );
}

/** /library/artists — artists the listener follows (new releases show up in the bell). */
export function FollowedArtistsTab() {
  const t = useT();
  useDocumentTitle(t("library.tab.artists"));
  const { query } = useShell();
  const { follows, loading, toggleFollow } = useLibrary();
  const visible = follows.filter((a) => matchesQuery(query, a.name));

  if (loading) return <ul className="card-grid" aria-busy="true">{[0, 1, 2].map((i) => <li key={i} className="artist-card skeleton" />)}</ul>;
  if (follows.length === 0) {
    return (
      <EmptyState icon={<Mic2 size={28} />} title={t("library.noArtists")}>
        <p>{t("library.noArtistsText")}</p>
        <Link to="/explore" className="pill-btn">
          {t("common.exploreMusic")}
        </Link>
      </EmptyState>
    );
  }
  if (visible.length === 0) return <EmptyState icon={<Mic2 size={28} />} title={t("library.noArtistsMatch", { q: query.trim() })} />;

  return (
    <ul className="card-grid artist-grid">
      {visible.map((a) => (
        <li key={a.id} className="artist-card">
          <Link to={artistPath(a.id)} className="artist-card-link">
            <span className="artist-card-art">
              <Cover seed={a.id} src={a.imageUrl} />
            </span>
            <span className="artist-card-name">{a.name}</span>
            <span className="track-artist">{t("library.followedSince", { date: formatDate(a.followedAt) })}</span>
          </Link>
          <button
            type="button"
            className="follow-btn is-on small"
            aria-pressed={true}
            aria-label={t("artist.unfollowLabel", { name: a.name })}
            onClick={() => void toggleFollow(a)}
          >
            <UserCheck size={14} aria-hidden="true" /> {t("artist.following")}
          </button>
        </li>
      ))}
    </ul>
  );
}

interface HistoryRow {
  track: Track;
  lastPlayed: string;
  plays: number;
}

/** /library/history — every reported play, one row per track (newest first). */
export function HistoryTab() {
  const t = useT();
  useDocumentTitle(t("library.tab.history"));
  const { query } = useShell();
  const { tracks, mergeTracks, historyVersion, clearHistory } = useLibrary();
  const { confirm } = useDialogs();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .getHistory(500, ctrl.signal)
      .then((list) => {
        mergeTracks(list.map((h) => h.track));
        setItems(list);
        setError(null);
      })
      .catch((e: Error) => e.name !== "AbortError" && setError(errorText(e)));
    return () => ctrl.abort();
  }, [historyVersion, mergeTracks]);

  if (error && !items) {
    return (
      <p className="inline-error" role="alert">
        {t("library.historyLoadError", { error })}
      </p>
    );
  }
  if (!items) return <div className="card chart-panel skeleton" aria-busy="true" style={{ minHeight: 240 }} />;

  // One row per track: newest play first, with a play count.
  const rows = new Map<string, HistoryRow>();
  for (const h of items) {
    const tr = tracks[h.trackId] ?? h.track;
    const row = rows.get(h.trackId);
    if (row) row.plays++;
    else rows.set(h.trackId, { track: tr, lastPlayed: h.playedAt, plays: 1 });
  }
  const all = [...rows.values()];
  const visible = all.filter((r) => matchesQuery(query, r.track.title, r.track.artist, r.track.album));
  const byId = new Map(all.map((r) => [r.track.id, r]));

  if (all.length === 0) {
    return (
      <EmptyState icon={<Clock size={28} />} title={t("library.noHistory")}>
        <p>{t("library.noHistoryText")}</p>
        <Link to="/explore" className="pill-btn">
          {t("common.exploreMusic")}
        </Link>
      </EmptyState>
    );
  }

  const onClear = async () => {
    const ok = await confirm({
      title: t("history.clearTitle"),
      message: t("history.clearText"),
      confirmLabel: t("history.clear"),
      danger: true,
    });
    if (ok) await clearHistory();
  };

  return (
    <section className="card chart-panel" aria-labelledby="history-title">
      <div className="panel-head">
        <div>
          <h2 id="history-title" className="section-title">
            {t("library.history")}
          </h2>
          <p className="page-sub">
            {t("library.historySummary", {
              plays: t("common.playsCount", { count: items.length }),
              tracks: t("common.tracksCount", { count: all.length }),
            })}
          </p>
        </div>
        <div className="hero-actions">
          <PlayAllButton ids={visible.map((r) => r.track.id)} name={t("library.historyName")} />
          <button type="button" className="ghost-btn is-danger" onClick={onClear}>
            <Trash2 size={15} aria-hidden="true" /> {t("history.clear")}
          </button>
        </div>
      </div>
      <div className="chart-scroll">
        <TrackTable
          tracks={visible.map((r) => r.track)}
          caption={t("library.history")}
          extraColumn={{
            header: t("library.lastPlayed"),
            render: (tr) => {
              const r = byId.get(tr.id);
              if (!r) return null;
              return (
                <span title={formatDateTime(r.lastPlayed)}>
                  {formatRelative(r.lastPlayed)}
                  {r.plays > 1 && <span className="muted"> · {r.plays}×</span>}
                </span>
              );
            },
          }}
          empty={t("library.noHistoryMatch", { q: query.trim() })}
        />
      </div>
    </section>
  );
}
