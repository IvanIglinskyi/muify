import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Header } from "./components/Header";
import { PlayerBar } from "./components/PlayerBar";
import { Sidebar } from "./components/Sidebar";
import { ExplorePage } from "./pages/ExplorePage";
import { HomePage } from "./pages/HomePage";
import { LibraryPage, LikedAlbumsTab, LikedTracksTab, PlaylistDetail, PlaylistsTab } from "./pages/LibraryPage";
import type { ShellContext } from "./pages/shell";
import { LibraryProvider, useLibrary } from "./store/LibraryContext";
import { PlayerProvider } from "./store/PlayerContext";

function ErrorToast() {
  const { error, dismissError } = useLibrary();
  if (!error) return null;
  return (
    <div className="toast" role="alert">
      <span>{error}</span>
      <button type="button" className="icon-btn" aria-label="Dismiss error" onClick={dismissError}>
        <X size={16} />
      </button>
    </div>
  );
}

function searchLabelFor(pathname: string): string {
  if (pathname.startsWith("/explore")) return "Search all tracks and albums";
  if (pathname.startsWith("/library")) return "Search your library";
  return "Search tracks in Daily Mix";
}

/** Persistent layout: header, sidebar and player survive navigation (playback never resets). */
function Shell() {
  const { pathname } = useLocation();
  const [query, setQuery] = useState("");
  const [showPromo, setShowPromo] = useState(true);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const context: ShellContext = { query, showPromo, closePromo: () => setShowPromo(false) };

  return (
    <div className="app">
      <Header query={query} onQueryChange={setQuery} searchLabel={searchLabelFor(pathname)} />
      <Sidebar />
      <main className="main" id="main">
        <Outlet context={context} />
      </main>
      <PlayerBar />
      <ErrorToast />
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
      <LibraryProvider>
        <PlayerProvider>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<HomePage />} />
              <Route path="explore" element={<ExplorePage />} />
              <Route path="library" element={<LibraryPage />}>
                <Route index element={<Navigate to="playlists" replace />} />
                <Route path="playlists" element={<PlaylistsTab />} />
                <Route path="playlists/:id" element={<PlaylistDetail />} />
                <Route path="liked" element={<LikedTracksTab />} />
                <Route path="albums" element={<LikedAlbumsTab />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </PlayerProvider>
      </LibraryProvider>
    </BrowserRouter>
  );
}
