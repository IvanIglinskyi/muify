import { sendEmailVerification } from "firebase/auth";
import { MailWarning, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { DialogProvider } from "./components/Dialogs";
import { Header } from "./components/Header";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { Sidebar } from "./components/Sidebar";
import { AccountPage } from "./pages/AccountPage";
import { AlbumPage } from "./pages/AlbumPage";
import { ArtistPage } from "./pages/ArtistPage";
import { LoginPage, RequireAuth, ResetPasswordPage, SignupPage } from "./pages/AuthPages";
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
import { SharedPlaylistPage } from "./pages/SharedPlaylistPage";
import type { ShellContext } from "./pages/shell";
import { StatsPage } from "./pages/StatsPage";
import { WeekAlbumsPage } from "./pages/WeekAlbumsPage";
import { AuthProvider, useAuth } from "./store/AuthContext";
import { LibraryProvider, useLibrary } from "./store/LibraryContext";
import { PlayerProvider } from "./store/PlayerContext";

function Toasts() {
  const { error, dismissError, info, dismissInfo } = useLibrary();
  const { signInPrompt, dismissSignInPrompt, notice, setNotice, phase } = useAuth();
  const { pathname, search } = useLocation();
  const onAuthPage = /^\/(login|signup|reset-password)/.test(pathname);

  useEffect(() => {
    if (!signInPrompt) return;
    const t = window.setTimeout(dismissSignInPrompt, 6000);
    return () => window.clearTimeout(t);
  }, [signInPrompt, dismissSignInPrompt]);

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
      {signInPrompt && (
        <div className="toast is-info is-auth" role="status">
          <span>{signInPrompt}.</span>
          <Link
            to={`/login?next=${encodeURIComponent(pathname + search)}`}
            className="toast-link"
            onClick={dismissSignInPrompt}
          >
            Sign in
          </Link>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={dismissSignInPrompt}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && phase !== "user" && !onAuthPage && (
        <div className="toast is-info" role="status">
          <span>{notice}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>
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

const BANNER_KEY = "muify:verify-banner-dismissed";

/** Email/password accounts that haven't confirmed their address yet (dismissible per session). */
function VerifyEmailBanner() {
  const { user, refreshUser } = useAuth();
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(BANNER_KEY) === "1");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const needs = user && !user.emailVerified && user.providerData.some((p) => p.providerId === "password");

  // Coming back to the tab after clicking the link: pick up the new status.
  useEffect(() => {
    if (!needs) return;
    const onFocus = () => void refreshUser().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [needs, refreshUser]);

  if (!needs || dismissed) return null;
  return (
    <div className="verify-banner" role="region" aria-label="Email verification">
      <MailWarning size={18} aria-hidden="true" />
      <p>
        Please verify <strong>{user.email}</strong> — we sent you a link.{" "}
        {state === "sent" && <span role="status">New link sent.</span>}
        {state === "error" && <span role="alert">Couldn't send right now, try again later.</span>}
      </p>
      <button
        type="button"
        className="link-btn"
        disabled={state === "sending" || state === "sent"}
        onClick={async () => {
          setState("sending");
          try {
            await sendEmailVerification(user);
            setState("sent");
          } catch {
            setState("error");
          }
        }}
      >
        Resend verification
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Dismiss verification reminder"
        onClick={() => {
          sessionStorage.setItem(BANNER_KEY, "1");
          setDismissed(true);
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

/** What the header search box does on each page. `submitTo` = Enter jumps to another page. */
function searchFor(pathname: string): { label: string; submitTo?: string } {
  if (pathname.startsWith("/explore")) return { label: "Search all tracks and albums" };
  if (pathname.startsWith("/library")) return { label: "Search your library" };
  if (pathname.startsWith("/album/")) return { label: "Search tracks in this album" };
  if (pathname.startsWith("/albums/week")) return { label: "Search albums of the week" };
  if (pathname.startsWith("/artist/")) return { label: "Search this artist's top tracks" };
  if (pathname.startsWith("/p/")) return { label: "Search tracks in this playlist" };
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
  const { phase } = useAuth();
  // Guests get no sidebar (playlists / Recent Plays are personal); nav moves into the header.
  // Hidden while loading too, so guests never see it flash in.
  const showSidebar = phase === "user" || phase === "local";

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const closeQueue = useCallback(() => {
    setQueueOpen(false);
    document.querySelector<HTMLButtonElement>(".queue-btn")?.focus();
  }, []);

  const context: ShellContext = { query, showPromo, closePromo: () => setShowPromo(false) };

  return (
    <div className={`app${queueOpen ? " has-queue" : ""}${showSidebar ? "" : " no-sidebar"}`}>
      <Header
        query={query}
        onQueryChange={setQuery}
        searchLabel={search.label}
        onSubmit={() => search.submitTo && query.trim() && navigate(search.submitTo)}
        showNav={phase === "guest"}
      />
      {showSidebar && <Sidebar />}
      <main className="main" id="main">
        <VerifyEmailBanner />
        <Outlet context={context} />
      </main>
      <QueuePanel open={queueOpen} onClose={closeQueue} />
      <PlayerBar queueOpen={queueOpen} onToggleQueue={() => setQueueOpen((o) => !o)} />
      <Toasts />
      <KeyboardShortcuts />
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
        <AuthProvider>
        <LibraryProvider>
          <PlayerProvider>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<HomePage />} />
                <Route path="explore" element={<ExplorePage />} />
                <Route path="album/:id" element={<AlbumPage />} />
                <Route path="artist/:id" element={<ArtistPage />} />
                <Route path="p/:shareId" element={<SharedPlaylistPage />} />
                <Route path="albums/week" element={<WeekAlbumsPage />} />
                <Route
                  path="stats"
                  element={
                    <RequireAuth>
                      <StatsPage />
                    </RequireAuth>
                  }
                />
                <Route path="login" element={<LoginPage />} />
                <Route path="signup" element={<SignupPage />} />
                <Route path="reset-password" element={<ResetPasswordPage />} />
                <Route
                  path="account"
                  element={
                    <RequireAuth>
                      <AccountPage />
                    </RequireAuth>
                  }
                />
                <Route path="plans" element={<PlansPage />} />
                <Route
                  path="library"
                  element={
                    <RequireAuth>
                      <LibraryPage />
                    </RequireAuth>
                  }
                >
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
        </AuthProvider>
      </DialogProvider>
    </BrowserRouter>
  );
}
