import { sendEmailVerification } from "firebase/auth";
import { MailWarning, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { DialogProvider } from "./components/Dialogs";
import { Header } from "./components/Header";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { LanguageSync } from "./components/LanguageSync";
import { LyricsPanel } from "./components/LyricsPanel";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { Sidebar } from "./components/Sidebar";
import { I18nProvider, Trans, useT, type MessageKey } from "./i18n";
import { AccountPage } from "./pages/AccountPage";
import { AlbumPage } from "./pages/AlbumPage";
import { ArtistPage } from "./pages/ArtistPage";
import { LoginPage, RequireAuth, ResetPasswordPage, SignupPage } from "./pages/AuthPages";
import { ExplorePage } from "./pages/ExplorePage";
import { HomePage } from "./pages/HomePage";
import {
  FollowedArtistsTab,
  HistoryTab,
  LibraryPage,
  LikedAlbumsTab,
  LikedTracksTab,
  PlaylistDetail,
  PlaylistsTab,
} from "./pages/LibraryPage";
import { PlansPage } from "./pages/PlansPage";
import { SearchPage, searchPath } from "./pages/SearchPage";
import { SharedPlaylistPage } from "./pages/SharedPlaylistPage";
import type { ShellContext } from "./pages/shell";
import { StatsPage } from "./pages/StatsPage";
import { WeekAlbumsPage } from "./pages/WeekAlbumsPage";
import { AuthProvider, useAuth } from "./store/AuthContext";
import { LibraryProvider, useLibrary } from "./store/LibraryContext";
import { PlayerProvider } from "./store/PlayerContext";

function Toasts() {
  const t = useT();
  const { error, dismissError, info, dismissInfo } = useLibrary();
  const { signInPrompt, dismissSignInPrompt, notice, setNotice, phase } = useAuth();
  const { pathname, search } = useLocation();
  const onAuthPage = /^\/(login|signup|reset-password)/.test(pathname);

  useEffect(() => {
    if (!signInPrompt) return;
    const id = window.setTimeout(dismissSignInPrompt, 6000);
    return () => window.clearTimeout(id);
  }, [signInPrompt, dismissSignInPrompt]);

  useEffect(() => {
    if (!info) return;
    const id = window.setTimeout(dismissInfo, 3200);
    return () => window.clearTimeout(id);
  }, [info, dismissInfo]);

  return (
    <div className="toasts">
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-btn" aria-label={t("toast.dismissError")} onClick={dismissError}>
            <X size={16} />
          </button>
        </div>
      )}
      {signInPrompt && (
        <div className="toast is-info is-auth" role="status">
          <span>{t("toast.signInTo", { what: t(signInPrompt) })}</span>
          <Link
            to={`/login?next=${encodeURIComponent(pathname + search)}`}
            className="toast-link"
            onClick={dismissSignInPrompt}
          >
            {t("common.signIn")}
          </Link>
          <button type="button" className="icon-btn" aria-label={t("common.dismiss")} onClick={dismissSignInPrompt}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && phase !== "user" && !onAuthPage && (
        <div className="toast is-info" role="status">
          <span>{t(notice)}</span>
          <button type="button" className="icon-btn" aria-label={t("common.dismiss")} onClick={() => setNotice(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {/* Always mounted so screen readers announce new messages. */}
      <div role="status" aria-live="polite" className={info ? "toast is-info" : "sr-only"}>
        {info && (
          <>
            <span>{info}</span>
            <button type="button" className="icon-btn" aria-label={t("toast.dismissMessage")} onClick={dismissInfo}>
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
  const t = useT();
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
    <div className="verify-banner" role="region" aria-label={t("verify.region")}>
      <MailWarning size={18} aria-hidden="true" />
      <p>
        <Trans k="verify.text" values={{ email: <strong>{user.email}</strong> }} />{" "}
        {state === "sent" && <span role="status">{t("verify.sent")}</span>}
        {state === "error" && <span role="alert">{t("verify.error")}</span>}
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
        {t("verify.resend")}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={t("verify.dismiss")}
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

/**
 * What the header search box does on each page: pages with their own list filter it live (Enter
 * does nothing more); everywhere else Enter opens the full search page (/search?q=).
 */
function searchFor(pathname: string): { label: MessageKey; submitsToSearch: boolean } {
  if (pathname.startsWith("/explore")) return { label: "header.search.explore", submitsToSearch: true };
  if (pathname.startsWith("/library")) return { label: "header.search.library", submitsToSearch: false };
  if (pathname.startsWith("/album/")) return { label: "header.search.album", submitsToSearch: false };
  if (pathname.startsWith("/albums/week")) return { label: "header.search.weekAlbums", submitsToSearch: false };
  if (pathname.startsWith("/artist/")) return { label: "header.search.artist", submitsToSearch: false };
  if (pathname.startsWith("/p/")) return { label: "header.search.shared", submitsToSearch: false };
  if (pathname.startsWith("/search")) return { label: "header.search.searchPage", submitsToSearch: true };
  if (pathname === "/") return { label: "header.search.home", submitsToSearch: true };
  return { label: "header.search.default", submitsToSearch: true };
}

type SidePanel = "queue" | "lyrics" | null;

/** Persistent layout: header, sidebar and player survive navigation (playback never resets). */
function Shell() {
  const t = useT();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [showPromo, setShowPromo] = useState(true);
  const [panel, setPanel] = useState<SidePanel>(null);
  const search = searchFor(pathname);
  const { phase } = useAuth();
  // Guests get no sidebar (playlists / Recent Plays are personal); nav moves into the header.
  // Hidden while loading too, so guests never see it flash in.
  const showSidebar = phase === "user" || phase === "local";

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const closePanel = useCallback((which: SidePanel) => {
    setPanel((p) => (p === which ? null : p));
    document.querySelector<HTMLButtonElement>(which === "lyrics" ? ".lyrics-btn" : ".queue-btn")?.focus();
  }, []);
  const closeQueue = useCallback(() => closePanel("queue"), [closePanel]);
  const closeLyrics = useCallback(() => closePanel("lyrics"), [closePanel]);

  const context: ShellContext = { query, setQuery, showPromo, closePromo: () => setShowPromo(false) };

  const submit = () => {
    const q = query.trim();
    if (!search.submitsToSearch || !q) return;
    navigate(searchPath(q));
    setQuery(""); // the search page shows the query in its own box
  };

  return (
    <div className={`app${panel ? " has-queue" : ""}${showSidebar ? "" : " no-sidebar"}`}>
      <a href="#main" className="skip-link">
        {t("common.skipToContent")}
      </a>
      <Header query={query} onQueryChange={setQuery} searchLabel={t(search.label)} onSubmit={submit} showNav={phase === "guest"} />
      {showSidebar && <Sidebar />}
      <main className="main" id="main" tabIndex={-1}>
        <VerifyEmailBanner />
        <Outlet context={context} />
      </main>
      <QueuePanel open={panel === "queue"} onClose={closeQueue} />
      <LyricsPanel open={panel === "lyrics"} onClose={closeLyrics} />
      <PlayerBar
        queueOpen={panel === "queue"}
        onToggleQueue={() => setPanel((p) => (p === "queue" ? null : "queue"))}
        lyricsOpen={panel === "lyrics"}
        onToggleLyrics={() => setPanel((p) => (p === "lyrics" ? null : "lyrics"))}
      />
      <Toasts />
      <KeyboardShortcuts />
    </div>
  );
}

function NotFound() {
  const t = useT();
  return (
    <div className="empty-state">
      <h1 className="page-title">{t("notFound.title")}</h1>
      <p>{t("notFound.text")}</p>
      <Link to="/" className="pill-btn">
        {t("common.goHome")}
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <DialogProvider>
          <AuthProvider>
            <LanguageSync />
            <LibraryProvider>
              <PlayerProvider>
                <Routes>
                  <Route element={<Shell />}>
                    <Route index element={<HomePage />} />
                    <Route path="explore" element={<ExplorePage />} />
                    <Route path="search" element={<SearchPage />} />
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
                      <Route path="artists" element={<FollowedArtistsTab />} />
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
    </I18nProvider>
  );
}
