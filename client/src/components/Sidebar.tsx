import {
  BookOpen,
  Compass,
  Dumbbell,
  Flower2,
  Footprints,
  Heart,
  Home,
  Library,
  LucideIcon,
  PartyPopper,
  Search,
} from "lucide-react";
import { useState } from "react";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import { Cover } from "./Cover";
import { HeartButton } from "./common";

const NAV: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "explore", label: "Explore", icon: Search },
  { id: "library", label: "Library", icon: Library },
];

// Icons are always shown for Favourites; for the rest only in the collapsed (icon) sidebar.
const PLAYLIST_ICONS: Record<string, LucideIcon> = {
  "p-favourites": Heart,
  "p-gym": Dumbbell,
  "p-pre-party": PartyPopper,
  "p-reading": BookOpen,
  "p-meditation": Flower2,
  "p-walk": Footprints,
};

const RECENT_PREVIEW = 7;

export function Sidebar() {
  const { playlists, recentIds, tracks, toggleTrackLike, loadPlaylistTracks } = useLibrary();
  const { current, isPlaying, playTrack } = usePlayer();
  const [active, setActive] = useState("home");
  const [activePlaylist, setActivePlaylist] = useState<string | null>(null);
  const [showAllRecent, setShowAllRecent] = useState(false);

  const recent = (showAllRecent ? recentIds : recentIds.slice(0, RECENT_PREVIEW))
    .map((id) => tracks[id])
    .filter(Boolean);

  const playPlaylist = async (id: string) => {
    setActivePlaylist(id);
    try {
      const ids = await loadPlaylistTracks(id);
      if (ids.length) playTrack(ids[0], ids);
    } catch {
      /* error surfaced by network layer; nothing to play */
    }
  };

  return (
    <aside className="sidebar" aria-label="Sidebar">
      <nav aria-label="Main">
        <ul className="nav-list">
          {NAV.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                className={`nav-item${active === id ? " is-active" : ""}`}
                aria-current={active === id ? "page" : undefined}
                onClick={() => setActive(id)}
                title={label}
              >
                <span className="nav-dot" aria-hidden="true" />
                <Icon size={19} aria-hidden="true" />
                <span className="label">{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section className="sidebar-section" aria-labelledby="my-playlist-title">
        <h2 id="my-playlist-title" className="sidebar-title">
          My Playlist
        </h2>
        <ul className="playlist-box">
          {playlists.map((p) => {
            const Icon = PLAYLIST_ICONS[p.id] ?? Compass;
            return (
              <li key={p.id}>
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
                    <Cover seed={t.id} />
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
        {recentIds.length > RECENT_PREVIEW && (
          <button type="button" className="link-btn see-all" onClick={() => setShowAllRecent((v) => !v)}>
            {showAllRecent ? "Show less" : "See All"}
          </button>
        )}
      </section>
    </aside>
  );
}
