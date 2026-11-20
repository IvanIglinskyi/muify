import { Bell, BellOff, Database, History, Search, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
}

function SettingsMenu({ close }: { close: () => void }) {
  const { clearHistory } = useLibrary();
  const { confirm } = useDialogs();
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
      <button type="button" className="menu-action is-danger" onClick={onClear}>
        <History size={16} aria-hidden="true" /> Clear history
      </button>
    </div>
  );
}

export function Header({ query, onQueryChange, searchLabel, onSubmit }: HeaderProps) {
  return (
    <header className="app-header">
      <Link to="/" className="brand" aria-label="Muify home">
        <Logo />
      </Link>
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
        <button type="button" className="avatar" aria-label="Account" title="Account (demo)">
          <span aria-hidden="true">AK</span>
        </button>
      </div>
    </header>
  );
}
