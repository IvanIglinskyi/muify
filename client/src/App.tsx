import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { DialogProvider } from "./components/Dialogs";
import { Header } from "./components/Header";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { Sidebar } from "./components/Sidebar";
import { AlbumPage } from "./pages/AlbumPage";
import { ExplorePage } from "./pages/ExplorePage";
import { HomePage } from "./pages/HomePage";
import {
  HistoryTab,
  LibraryPage,
  LikedAlbumsTab,
  LikedTracksTab,
  PlaylistDetail,
  PlaylistsTab,
} from "./pages/LibraryPage";
import { PlansPage } from "./pages/PlansPage";
import type { ShellContext } from "./pages/shell";
import { StatsPage } from "./pages/StatsPage";
import { WeekAlbumsPage } from "./pages/WeekAlbumsPage";
import { LibraryProvider, useLibrary } from "./store/LibraryContext";
import { PlayerProvider } from "./store/PlayerContext";

function Toasts() {
  const { error, dismissError, info, dismissInfo } = useLibrary();

  useEffect(() => {
    if (!info) return;
    const t = window.setTimeout(dismissInfo, 3200);
    return () => window.clearTimeout(t);
  }, [info, dismissInfo]);

  return (
    <div className="toasts">
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss error" onClick={dismissError}>
            <X size={16} />
          </button>
        </div>
      )}
      {/* Always mounted so screen readers announce new messages. */}
      <div role="status" aria-live="polite" className={info ? "toast is-info" : "sr-only"}>
        {info && (
          <>
            <span>{info}</span>
            <button type="button" className="icon-btn" aria-label="Dismiss message" onClick={dismissInfo}>
              <X size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** What the header search box does on each page. `submitTo` = Enter jumps to another page. */
function searchFor(pathname: string): { label: string; submitTo?: string } {
  if (pathname.startsWith("/explore")) return { label: "Search all tracks and albums" };
  if (pathname.startsWith("/library")) return { label: "Search your library" };
  if (pathname.startsWith("/album/")) return { label: "Search tracks in this album" };
  if (pathname.startsWith("/albums/week")) return { label: "Search albums of the week" };
  if (pathname === "/") return { label: "Search tracks in Daily Mix (Enter searches all music)", submitTo: "/explore" };
  return { label: "Search all music (press Enter)", submitTo: "/explore" };
}

/** Persistent layout: header, sidebar and player survive navigation (playback never resets). */
function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [showPromo, setShowPromo] = useState(true);
  const [queueOpen, setQueueOpen] = useState(false);
  const search = searchFor(pathname);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const closeQueue = useCallback(() => {
    setQueueOpen(false);
    document.querySelector<HTMLButtonElement>(".queue-btn")?.focus();
  }, []);

  const context: ShellContext = { query, showPromo, closePromo: () => setShowPromo(false) };

  return (
    <div className={`app${queueOpen ? " has-queue" : ""}`}>
      <Header
        query={query}
        onQueryChange={setQuery}
        searchLabel={search.label}
        onSubmit={() => search.submitTo && query.trim() && navigate(search.submitTo)}
      />
      <Sidebar />
      <main className="main" id="main">
        <Outlet context={context} />
      </main>
      <QueuePanel open={queueOpen} onClose={closeQueue} />
      <PlayerBar queueOpen={queueOpen} onToggleQueue={() => setQueueOpen((o) => !o)} />
      <Toasts />
    </div>
  );
}

function NotFound() {
  return (
    <div className="empty-state">
      <h1 className="page-title">Page not found</h1>
      <p>This page doesn’t exist.</p>
      <Link to="/" className="pill-btn">
        Go home
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <DialogProvider>
        <LibraryProvider>
          <PlayerProvider>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<HomePage />} />
                <Route path="explore" element={<ExplorePage />} />
                <Route path="album/:id" element={<AlbumPage />} />
                <Route path="albums/week" element={<WeekAlbumsPage />} />
                <Route path="stats" element={<StatsPage />} />
                <Route path="plans" element={<PlansPage />} />
                <Route path="library" element={<LibraryPage />}>
                  <Route index element={<Navigate to="playlists" replace />} />
                  <Route path="playlists" element={<PlaylistsTab />} />
                  <Route path="playlists/:id" element={<PlaylistDetail />} />
                  <Route path="liked" element={<LikedTracksTab />} />
                  <Route path="albums" element={<LikedAlbumsTab />} />
                  <Route path="history" element={<HistoryTab />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </PlayerProvider>
        </LibraryProvider>
      </DialogProvider>
    </BrowserRouter>
  );
}
