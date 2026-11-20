import { Bell, BellOff, Compass, Database, History, Home, Keyboard, LogIn, LogOut, Search, Settings, ShieldCheck, UserRound } from "lucide-react";
import { openShortcutsHelp } from "./KeyboardShortcuts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../store/AuthContext";
import { UserAvatar } from "./UserAvatar";
import { api } from "../api";
import { useLibrary } from "../store/LibraryContext";
import type { CatalogStatus } from "../types";
import { Logo, Popover } from "./common";
import { useDialogs } from "./Dialogs";

interface HeaderProps {
  query: string;
  onQueryChange: (q: string) => void;
  /** Accessible name of the search box; depends on what the current page searches. */
  searchLabel: string;
  /** Enter in the search box (pages without their own search jump to Explore). */
  onSubmit: () => void;
  /** Show Home / Explore links in the header (guests have no sidebar). */
  showNav?: boolean;
}

function SettingsMenu({ close }: { close: () => void }) {
  const { clearHistory } = useLibrary();
  const { confirm } = useDialogs();
  const { phase, user, canSave } = useAuth();
  const [status, setStatus] = useState<CatalogStatus | null | "error">(null);

  // Fresh status every time the menu opens (the server may have fallen back since).
  useEffect(() => {
    const ctrl = new AbortController();
    api.getStatus(ctrl.signal).then(setStatus, (e: Error) => e.name !== "AbortError" && setStatus("error"));
    return () => ctrl.abort();
  }, []);

  const source =
    status === null
      ? "Checking…"
      : status === "error"
        ? "Unknown (server unreachable)"
        : status.source === "jamendo"
          ? "Jamendo"
          : "Demo";
  const hint =
    status && status !== "error"
      ? status.source === "jamendo"
        ? "Real Creative Commons music from Jamendo."
        : status.jamendoConfigured
          ? "Jamendo is unavailable right now, so the built-in demo catalogue is used (simulated playback)."
          : "No Jamendo client id configured: built-in demo catalogue with simulated playback."
      : null;

  const onClear = async () => {
    close();
    const ok = await confirm({
      title: "Clear listening history?",
      message: "Recent Plays, History and listening statistics will be reset. Likes and playlists are kept.",
      confirmLabel: "Clear history",
      danger: true,
    });
    if (ok) await clearHistory();
  };

  return (
    <div className="settings-menu">
      <h2 className="popover-title">Settings</h2>
      <div className="settings-row">
        <Database size={16} aria-hidden="true" />
        <div>
          <div className="settings-label">
            Data source: <strong className={status && status !== "error" && status.source === "jamendo" ? "ok" : "warn"}>{source}</strong>
          </div>
          {hint && <p className="settings-hint">{hint}</p>}
        </div>
      </div>
      <div className="settings-row">
        <ShieldCheck size={16} aria-hidden="true" />
        <div>
          <div className="settings-label">
            Accounts: <strong className="ok">{phase === "local" ? "Local mode" : phase === "loading" ? "Checking…" : "Firebase"}</strong>
          </div>
          <p className="settings-hint">
            {phase === "local"
              ? "No sign-in: everything is saved on this computer."
              : user
                ? `Signed in as ${user.email ?? user.displayName ?? "you"}.`
                : "Browsing as a guest — sign in to save likes, playlists and history."}
          </p>
        </div>
      </div>
      <button
        type="button"
        className="menu-action"
        onClick={() => {
          close();
          openShortcutsHelp();
        }}
      >
        <Keyboard size={16} aria-hidden="true" /> Keyboard shortcuts <kbd className="menu-kbd">?</kbd>
      </button>
      {canSave && (
        <button type="button" className="menu-action is-danger" onClick={onClear}>
          <History size={16} aria-hidden="true" /> Clear history
        </button>
      )}
    </div>
  );
}

export function Header({ query, onQueryChange, searchLabel, onSubmit, showNav }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="header-left">
        <Link to="/" className="brand" aria-label="Muify home">
          <Logo />
        </Link>
        {showNav && (
          <nav className="header-nav" aria-label="Main">
            <NavLink to="/" end className="header-nav-link">
              <Home size={18} aria-hidden="true" />
              <span>Home</span>
            </NavLink>
            <NavLink to="/explore" className="header-nav-link">
              <Compass size={18} aria-hidden="true" />
              <span>Explore</span>
            </NavLink>
          </nav>
        )}
      </div>
      <div className="header-right">
        <form
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            placeholder="Navigate"
            aria-label={searchLabel}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </form>
        <Popover className="bell" icon={<Bell size={20} />} label="Notifications" title="No notifications">
          {() => (
            <div className="popover-empty">
              <BellOff size={18} aria-hidden="true" />
              <span>No notifications</span>
            </div>
          )}
        </Popover>
        <Popover className="settings" icon={<Settings size={20} />} label="Settings">
          {(close) => <SettingsMenu close={close} />}
        </Popover>
        <AccountButton />
      </div>
    </header>
  );
}

/** Avatar with Account / Sign out menu, or a "Sign in" button for guests. */
function AccountButton() {
  const { phase, user, signOut } = useAuth();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback((focus = false) => {
    setOpen(false);
    if (focus) btnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, close]);

  if (phase === "loading") return <span className="avatar-placeholder" aria-hidden="true" />;
  if (phase === "local") return null; // no accounts: nothing to show
  if (!user) {
    const here = `${pathname}${search}`;
    const next = pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname === "/" ? "" : `?next=${encodeURIComponent(here)}`;
    return (
      <Link to={`/login${next}`} className="pill-btn sign-in-btn" aria-label="Sign in" title="Sign in">
        <LogIn size={16} aria-hidden="true" />
        <span className="label">Sign in</span>
      </Link>
    );
  }

  const name = user.displayName || user.email || "Account";
  return (
    <div
      className="popover-wrap account-wrap"
      ref={wrapRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className="avatar-btn"
        aria-label={`Account menu for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <UserAvatar size={50} />
      </button>
      {open && (
        <div className="popover account-menu" role="menu" ref={menuRef} aria-label="Account">
          <div className="account-menu-head">
            <UserAvatar size={40} />
            <div className="account-menu-id">
              <strong>{user.displayName || "MuiFy listener"}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <Link to="/account" role="menuitem" className="menu-action" onClick={() => close()}>
            <UserRound size={16} aria-hidden="true" /> Account
          </Link>
          <button
            type="button"
            role="menuitem"
            className="menu-action"
            onClick={async () => {
              close();
              if (/^\/(account|library|stats)/.test(pathname)) navigate("/");
              await signOut();
            }}
          >
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
