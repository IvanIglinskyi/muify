import { Home, Library, LucideIcon, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useT, type MessageKey } from "../i18n";
import { playlistName } from "../lib/names";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import { playlistIcon } from "../lib/playlistIcons";
import { ArtistLink } from "./ArtistLink";
import { Cover } from "./Cover";
import { HeartButton } from "./common";
import { useNewPlaylist } from "./useTrackMenu";

const NAV: { to: string; label: MessageKey; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "nav.home", icon: Home, end: true },
  { to: "/explore", label: "nav.explore", icon: Search },
  { to: "/library", label: "nav.library", icon: Library },
];

const RECENT_PREVIEW = 7;

export function Sidebar() {
  const t = useT();
  const { playlists, recentIds, tracks, toggleTrackLike, loadPlaylistTracks } = useLibrary();
  const { current, isPlaying, playTrack } = usePlayer();
  const [activePlaylist, setActivePlaylist] = useState<string | null>(null);
  const navigate = useNavigate();
  const newPlaylist = useNewPlaylist();

  const recent = recentIds
    .slice(0, RECENT_PREVIEW)
    .map((id) => tracks[id])
    .filter(Boolean);

  const playPlaylist = async (id: string) => {
    setActivePlaylist(id);
    try {
      const ids = await loadPlaylistTracks(id);
      if (ids.length) playTrack(ids[0], ids);
      // An empty (new) playlist has nothing to play: open it instead.
      else navigate(`/library/playlists/${encodeURIComponent(id)}`);
    } catch {
      /* error surfaced by network layer; nothing to play */
    }
  };

  const create = async () => {
    const p = await newPlaylist();
    if (p) navigate(`/library/playlists/${encodeURIComponent(p.id)}`);
  };

  return (
    <aside className="sidebar" aria-label={t("sidebar.label")}>
      <nav aria-label={t("nav.main")}>
        <ul className="nav-list">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              {/* NavLink sets aria-current="page" on the active route. */}
              <NavLink to={to} end={end} className={({ isActive }) => `nav-item${isActive ? " is-active" : ""}`} title={t(label)}>
                <span className="nav-dot" aria-hidden="true" />
                <Icon size={19} aria-hidden="true" />
                <span className="label">{t(label)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <section className="sidebar-section" aria-labelledby="my-playlist-title">
        <div className="sidebar-title-row">
          <h2 id="my-playlist-title" className="sidebar-title">
            {t("sidebar.myPlaylist")}
          </h2>
          <button type="button" className="icon-btn add-btn" aria-label={t("sidebar.createPlaylist")} title={t("sidebar.createPlaylist")} onClick={create}>
            <Plus size={16} />
          </button>
        </div>
        <ul className="playlist-box">
          {playlists.map((p) => {
            const Icon = playlistIcon(p.id);
            const name = playlistName(p);
            return (
              <li key={p.id}>
                {/* Icons: always for Favourites, for the rest only in the collapsed (icon) sidebar. */}
                <button
                  type="button"
                  className={`playlist-item${p.icon ? " has-icon" : ""}${activePlaylist === p.id ? " is-active" : ""}`}
                  onClick={() => playPlaylist(p.id)}
                  title={t("sidebar.playPlaylist", { name })}
                  aria-label={t("sidebar.playPlaylistLabel", { name, count: p.trackIds.length })}
                >
                  <Icon size={18} aria-hidden="true" className="playlist-icon" />
                  <span className="label">{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="sidebar-section recent" aria-labelledby="recent-title">
        <h2 id="recent-title" className="sidebar-title muted">
          {t("sidebar.recentPlays")}
        </h2>
        <ul className="recent-list">
          {recent.map((tr) => {
            const isCurrent = current?.id === tr.id;
            return (
              <li key={tr.id} className={`recent-item${isCurrent ? " is-current" : ""}`}>
                {/* The play button's hit area stretches over the row; the artist link sits above it. */}
                <div className="recent-main">
                  <button
                    type="button"
                    className="recent-play"
                    onClick={() => playTrack(tr.id, recentIds)}
                    aria-label={t("table.playTrack", { title: tr.title, artist: tr.artist })}
                    title={`${tr.title} — ${tr.artist}`}
                  >
                    <span className="thumb">
                      <Cover seed={tr.id} src={tr.coverUrl} />
                      {isCurrent && isPlaying && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
                    </span>
                  </button>
                  <span className="recent-text label">
                    <span className="track-title" aria-hidden="true">{tr.title}</span>
                    <ArtistLink className="track-artist" name={tr.artist} id={tr.artistId} />
                  </span>
                </div>
                <HeartButton
                  className="label-like"
                  liked={tr.liked}
                  label={tr.title}
                  onToggle={() => toggleTrackLike(tr.id)}
                />
              </li>
            );
          })}
        </ul>
        <Link to="/library/history" className="link-btn see-all" aria-label={t("sidebar.seeAllRecent")}>
          {t("common.seeAll")}
        </Link>
      </section>
    </aside>
  );
}
