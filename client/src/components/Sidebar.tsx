import { Home, Library, LucideIcon, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import { playlistIcon } from "../lib/playlistIcons";
import { Cover } from "./Cover";
import { HeartButton } from "./common";
import { useNewPlaylist } from "./useTrackMenu";

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/explore", label: "Explore", icon: Search },
  { to: "/library", label: "Library", icon: Library },
];

const RECENT_PREVIEW = 7;

export function Sidebar() {
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
    <aside className="sidebar" aria-label="Sidebar">
      <nav aria-label="Main">
        <ul className="nav-list">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              {/* NavLink sets aria-current="page" on the active route. */}
              <NavLink to={to} end={end} className={({ isActive }) => `nav-item${isActive ? " is-active" : ""}`} title={label}>
                <span className="nav-dot" aria-hidden="true" />
                <Icon size={19} aria-hidden="true" />
                <span className="label">{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <section className="sidebar-section" aria-labelledby="my-playlist-title">
        <div className="sidebar-title-row">
          <h2 id="my-playlist-title" className="sidebar-title">
            My Playlist
          </h2>
          <button type="button" className="icon-btn add-btn" aria-label="Create playlist" title="Create playlist" onClick={create}>
            <Plus size={16} />
          </button>
        </div>
        <ul className="playlist-box">
          {playlists.map((p) => {
            const Icon = playlistIcon(p.id);
            return (
              <li key={p.id}>
                {/* Icons: always for Favourites, for the rest only in the collapsed (icon) sidebar. */}
                <button
                  type="button"
                  className={`playlist-item${p.icon ? " has-icon" : ""}${activePlaylist === p.id ? " is-active" : ""}`}
                  onClick={() => playPlaylist(p.id)}
                  title={`Play ${p.name}`}
                  aria-label={`Play playlist ${p.name} (${p.trackIds.length} tracks)`}
                >
                  <Icon size={18} aria-hidden="true" className="playlist-icon" />
                  <span className="label">{p.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="sidebar-section recent" aria-labelledby="recent-title">
        <h2 id="recent-title" className="sidebar-title muted">
          Recent Plays
        </h2>
        <ul className="recent-list">
          {recent.map((t) => {
            const isCurrent = current?.id === t.id;
            return (
              <li key={t.id} className={`recent-item${isCurrent ? " is-current" : ""}`}>
                <button
                  type="button"
                  className="recent-main"
                  onClick={() => playTrack(t.id, recentIds)}
                  aria-label={`Play ${t.title} by ${t.artist}`}
                  title={`${t.title} — ${t.artist}`}
                >
                  <span className="thumb">
                    <Cover seed={t.id} src={t.coverUrl} />
                    {isCurrent && isPlaying && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
                  </span>
                  <span className="recent-text label">
                    <span className="track-title">{t.title}</span>
                    <span className="track-artist">{t.artist}</span>
                  </span>
                </button>
                <HeartButton
                  className="label-like"
                  liked={t.liked}
                  label={t.title}
                  onToggle={() => toggleTrackLike(t.id)}
                />
              </li>
            );
          })}
        </ul>
        <Link to="/library/history" className="link-btn see-all" aria-label="See all recent plays (listening history)">
          See All
        </Link>
      </section>
    </aside>
  );
}
