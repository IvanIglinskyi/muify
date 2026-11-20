import { Bell, BellOff, Check, CheckCheck, Disc3, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useT } from "../i18n";
import { formatRelative } from "../lib/format";
import { useAuth } from "../store/AuthContext";
import type { AppNotification, NotificationsResponse } from "../types";
import { albumPath } from "./AlbumCard";
import { Cover } from "./Cover";
import { Popover } from "./common";

/** Re-check this often while the tab is visible (the server asks Jamendo at most every 6 h anyway). */
const POLL_MS = 10 * 60_000;

/** Header bell: new releases of followed artists + a welcome notice (members only). */
export function NotificationsBell() {
  const t = useT();
  const { phase, identityKey } = useAuth();
  const member = phase === "user" || phase === "local";
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [error, setError] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    api.getNotifications(ctrl.signal).then(
      (d) => {
        setData(d);
        setError(false);
      },
      (e: Error) => e.name !== "AbortError" && setError(true)
    );
  }, []);

  useEffect(() => {
    setData(null);
    if (!member) return;
    load();
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      ctrlRef.current?.abort();
    };
  }, [member, identityKey, load]);

  if (!member) return null;

  const unread = data?.unread ?? 0;
  const label = unread ? t("notif.buttonUnread", { count: unread }) : t("notif.button");

  const markRead = (ids: string[] | "all") => {
    // Optimistic; the server answers with the fresh list.
    setData((d) =>
      d && {
        ...d,
        items: d.items.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, read: true } : n)),
        unread: ids === "all" ? 0 : d.items.filter((n) => !n.read && !ids.includes(n.id)).length,
      }
    );
    api.markNotificationsRead(ids).then(setData, () => load());
  };

  return (
    <Popover
      className="bell"
      label={label}
      icon={
        <span className="bell-icon">
          <Bell size={20} />
          {unread > 0 && (
            <span className="bell-badge" aria-hidden="true">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      }
      onOpen={load}
    >
      {(close) => (
        <div className="notif-panel">
          <div className="notif-head">
            <h2 className="popover-title">{t("notif.title")}</h2>
            {unread > 0 && (
              <button type="button" className="link-btn notif-all" onClick={() => markRead("all")}>
                <CheckCheck size={14} aria-hidden="true" /> {t("notif.markAllRead")}
              </button>
            )}
          </div>
          {error && !data ? (
            <p className="popover-empty" role="alert">
              {t("notif.loadError")}
            </p>
          ) : !data ? (
            <p className="popover-empty">{t("common.loading")}</p>
          ) : data.items.length === 0 ? (
            <div className="popover-empty">
              <BellOff size={18} aria-hidden="true" />
              <span>
                {t("notif.empty")}
                <br />
                <small>{t("notif.emptyHint")}</small>
              </span>
            </div>
          ) : (
            <ul className="notif-list">
              {data.items.map((n) => (
                <NotificationRow key={n.id} n={n} onRead={() => markRead([n.id])} onNavigate={close} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Popover>
  );
}

function NotificationRow({ n, onRead, onNavigate }: { n: AppNotification; onRead: () => void; onNavigate: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const isRelease = n.kind === "release" && n.albumId;
  const title = isRelease ? t("notif.release.title", { artist: n.artistName ?? "" }) : t("notif.welcome.title");
  const body = isRelease ? n.albumTitle : t("notif.welcome.text");

  const open = () => {
    if (!n.read) onRead();
    if (isRelease) {
      onNavigate();
      navigate(albumPath(n.albumId!));
    }
  };

  return (
    <li className={`notif-row${n.read ? "" : " is-unread"}`}>
      <button
        type="button"
        className="notif-main"
        onClick={open}
        title={isRelease ? t("notif.release.open", { album: n.albumTitle ?? "", artist: n.artistName ?? "" }) : undefined}
      >
        <span className="notif-art" aria-hidden="true">
          {isRelease ? <Cover seed={n.albumId!} src={n.coverUrl} /> : <Sparkles size={18} />}
        </span>
        <span className="notif-text">
          <strong>{title}</strong>
          {body && (
            <span className="notif-body">
              {isRelease && <Disc3 size={12} aria-hidden="true" />} {body}
              {n.demo && <span className="badge notif-demo">{t("notif.release.demoTag")}</span>}
            </span>
          )}
          <time className="notif-time" dateTime={n.createdAt}>
            {formatRelative(n.createdAt)}
          </time>
        </span>
        {!n.read && <span className="notif-dot" title={t("notif.unreadDot")} aria-label={t("notif.unreadDot")} role="img" />}
      </button>
      {!n.read && (
        <button type="button" className="icon-btn notif-read" aria-label={t("notif.markRead")} title={t("notif.markRead")} onClick={onRead}>
          <Check size={15} />
        </button>
      )}
    </li>
  );
}
