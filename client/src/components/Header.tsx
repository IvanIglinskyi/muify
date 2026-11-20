import { Compass, Database, History, Home, Keyboard, Languages, LogIn, LogOut, Search, Settings, ShieldCheck, UserRound } from "lucide-react";
import { openShortcutsHelp } from "./KeyboardShortcuts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../store/AuthContext";
import { UserAvatar } from "./UserAvatar";
import { api } from "../api";
import { useT } from "../i18n";
import { useLibrary } from "../store/LibraryContext";
import type { CatalogStatus } from "../types";
import { Logo, Popover } from "./common";
import { useDialogs } from "./Dialogs";
import { LanguageSwitch } from "./LanguageSync";
import { NotificationsBell } from "./Notifications";

interface HeaderProps {
  query: string;
  onQueryChange: (q: string) => void;
  /** Accessible name of the search box; depends on what the current page searches. */
  searchLabel: string;
  /** Enter in the search box (opens the search page where the page has no list of its own). */
  onSubmit: () => void;
  /** Show Home / Explore / Search links in the header (guests have no sidebar). */
  showNav?: boolean;
}

function SettingsMenu({ close }: { close: () => void }) {
  const t = useT();
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
      ? t("settings.checking")
      : status === "error"
        ? t("settings.unknown")
        : status.source === "jamendo"
          ? t("settings.sourceJamendo")
          : t("settings.sourceDemo");
  const hint =
    status && status !== "error"
      ? status.source === "jamendo"
        ? t("settings.hint.jamendo")
        : status.jamendoConfigured
          ? t("settings.hint.fallback")
          : t("settings.hint.noKey")
      : null;

  const onClear = async () => {
    close();
    const ok = await confirm({
      title: t("history.clearTitle"),
      message: t("history.clearText"),
      confirmLabel: t("history.clear"),
      danger: true,
    });
    if (ok) await clearHistory();
  };

  return (
    <div className="settings-menu">
      <h2 className="popover-title">{t("settings.title")}</h2>
      <div className="settings-row">
        <Languages size={16} aria-hidden="true" />
        <div className="settings-grow">
          <div className="settings-label" id="settings-lang-label">
            {t("lang.label")}
          </div>
          <LanguageSwitch compact />
          <p className="settings-hint">
            {phase === "local" ? t("settings.languageHintLocal") : canSave ? t("settings.languageHint") : t("settings.languageHintGuest")}
          </p>
        </div>
      </div>
      <div className="settings-row">
        <Database size={16} aria-hidden="true" />
        <div>
          <div className="settings-label">
            {t("settings.dataSource")}{" "}
            <strong className={status && status !== "error" && status.source === "jamendo" ? "ok" : "warn"}>{source}</strong>
          </div>
          {hint && <p className="settings-hint">{hint}</p>}
        </div>
      </div>
      <div className="settings-row">
        <ShieldCheck size={16} aria-hidden="true" />
        <div>
          <div className="settings-label">
            {t("settings.accounts")}{" "}
            <strong className="ok">{phase === "local" ? t("settings.localMode") : phase === "loading" ? t("settings.checking") : t("settings.firebase")}</strong>
          </div>
          <p className="settings-hint">
            {phase === "local"
              ? t("settings.hint.local")
              : user
                ? t("settings.hint.signedIn", { who: user.email ?? user.displayName ?? t("settings.hint.you") })
                : t("settings.hint.guest")}
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
        <Keyboard size={16} aria-hidden="true" /> {t("settings.shortcuts")} <kbd className="menu-kbd">?</kbd>
      </button>
      {canSave && (
        <button type="button" className="menu-action is-danger" onClick={onClear}>
          <History size={16} aria-hidden="true" /> {t("settings.clearHistory")}
        </button>
      )}
    </div>
  );
}

export function Header({ query, onQueryChange, searchLabel, onSubmit, showNav }: HeaderProps) {
  const t = useT();
  return (
    <header className="app-header">
      <div className="header-left">
        <Link to="/" className="brand" aria-label={t("header.homeLink")}>
          <Logo />
        </Link>
        {showNav && (
          <nav className="header-nav" aria-label={t("nav.main")}>
            <NavLink to="/" end className="header-nav-link">
              <Home size={18} aria-hidden="true" />
              <span>{t("nav.home")}</span>
            </NavLink>
            <NavLink to="/explore" className="header-nav-link">
              <Compass size={18} aria-hidden="true" />
              <span>{t("nav.explore")}</span>
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
            placeholder={t("header.searchPlaceholder")}
            aria-label={searchLabel}
            value={query}
            enterKeyHint="search"
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </form>
        <NotificationsBell />
        <Popover className="settings" icon={<Settings size={20} />} label={t("header.settings")}>
          {(close) => <SettingsMenu close={close} />}
        </Popover>
        <AccountButton />
      </div>
    </header>
  );
}

/** Avatar with Account / Sign out menu, or a "Sign in" button for guests. */
function AccountButton() {
  const t = useT();
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
      <Link to={`/login${next}`} className="pill-btn sign-in-btn" aria-label={t("common.signIn")} title={t("common.signIn")}>
        <LogIn size={16} aria-hidden="true" />
        <span className="label">{t("common.signIn")}</span>
      </Link>
    );
  }

  const name = user.displayName || user.email || t("header.account");
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
        aria-label={t("header.accountMenu", { name })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <UserAvatar size={50} />
      </button>
      {open && (
        <div className="popover account-menu" role="menu" ref={menuRef} aria-label={t("header.account")}>
          <div className="account-menu-head">
            <UserAvatar size={40} />
            <div className="account-menu-id">
              <strong>{user.displayName || t("header.listener")}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <Link to="/account" role="menuitem" className="menu-action" onClick={() => close()}>
            <UserRound size={16} aria-hidden="true" /> {t("header.account")}
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
            <LogOut size={16} aria-hidden="true" /> {t("header.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
