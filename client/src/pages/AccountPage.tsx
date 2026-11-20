import {
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  linkWithRedirect,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  unlink,
  updatePassword,
  verifyBeforeUpdateEmail,
  type User,
} from "firebase/auth";
import { BadgeCheck, Download, KeyRound, Languages, Link2, Loader2, LogOut, Mail, MonitorSmartphone, ShieldAlert, Trash2, TriangleAlert, UserRound } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiRequestError } from "../api";
import { LanguageSwitch } from "../components/LanguageSync";
import { UserAvatar } from "../components/UserAvatar";
import { Trans, useT } from "../i18n";
import { errorText } from "../lib/errors";
import { authErrorCode, authErrorMessage, isPopupDismissal } from "../lib/authErrors";
import { ACCENT_COLORS, useAuth } from "../store/AuthContext";
import { useLibrary } from "../store/LibraryContext";
import { StrengthMeter } from "./AuthPages";
import { useDocumentTitle } from "./shell";

const hasProvider = (u: User | null, id: string) => Boolean(u?.providerData.some((p) => p.providerId === id));

function Section({ icon, title, children, danger }: { icon: ReactNode; title: string; children: ReactNode; danger?: boolean }) {
  const id = useId();
  return (
    <section className={`account-card${danger ? " is-danger" : ""}`} aria-labelledby={id}>
      <h2 id={id} className="account-card-title">
        <span className="account-card-icon" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Status({ msg }: { msg: { kind: "ok" | "error"; text: string } | null }) {
  return (
    <p className={msg ? `account-msg is-${msg.kind}` : "sr-only"} role={msg?.kind === "error" ? "alert" : "status"}>
      {msg?.text}
    </p>
  );
}

type Msg = { kind: "ok" | "error"; text: string } | null;

/**
 * Re-authentication dialog (Firebase requires a recent sign-in for email/password changes,
 * linking and account deletion). Password users type their password; Google-only users confirm
 * in a Google popup.
 */
function useReauth() {
  const { user } = useAuth();
  const [open, setOpen] = useState<{ reason: string; resolve: (ok: boolean) => void } | null>(null);

  const ask = (reason: string) => new Promise<boolean>((resolve) => setOpen({ reason, resolve }));

  const dialog = open && user && (
    <ReauthDialog
      user={user}
      reason={open.reason}
      onDone={(ok) => {
        open.resolve(ok);
        setOpen(null);
      }}
    />
  );
  return { ask, dialog };
}

function ReauthDialog({ user, reason, onDone }: { user: User; reason: string; onDone: (ok: boolean) => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usesPassword = hasProvider(user, "password");
  const usesGoogle = hasProvider(user, "google.com");
  const pwId = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      ref.current?.close();
      onDone(true);
    } catch (e) {
      if (!isPopupDismissal(e)) setError(authErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="modal" aria-labelledby="reauth-title" onCancel={() => onDone(false)}>
      <form
        method="dialog"
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (usesPassword) void run(() => reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? "", password)));
        }}
      >
        <h2 id="reauth-title" className="modal-title">
          {t("account.reauthTitle")}
        </h2>
        <p className="modal-text">{reason}</p>
        {usesPassword && (
          <div className="auth-field">
            <label htmlFor={pwId}>{t("account.currentPassword")}</label>
            <div className="auth-input">
              <input id={pwId} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            </div>
          </div>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              ref.current?.close();
              onDone(false);
            }}
          >
            {t("common.cancel")}
          </button>
          {usesGoogle && (
            <button type="button" className={usesPassword ? "ghost-btn" : "pill-btn"} disabled={busy} onClick={() => void run(() => reauthenticateWithPopup(user, new GoogleAuthProvider()))}>
              {t("account.confirmGoogle")}
            </button>
          )}
          {usesPassword && (
            <button type="submit" className="pill-btn" disabled={busy || !password}>
              {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
              {t("account.confirm")}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}

/** Runs `fn`; if Firebase says the sign-in is too old, re-authenticates and retries once. */
async function withRecentLogin<T>(ask: (reason: string) => Promise<boolean>, reason: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    const code = authErrorCode(e) || (e instanceof ApiRequestError ? e.code ?? "" : "");
    if (code !== "auth/requires-recent-login" && code !== "requires-recent-login") throw e;
    if (!(await ask(reason))) return null;
    return fn();
  }
}

function ProfileSection() {
  const t = useT();
  const { user, me, setMe, refreshUser, phase } = useAuth();
  const [name, setName] = useState(me?.displayName ?? user?.displayName ?? "");
  const [accent, setAccent] = useState<string | null>(me?.accentColor ?? null);
  const [usePhoto, setUsePhoto] = useState(me?.usePhoto ?? true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const nameId = useId();
  const photo = me?.photoURL ?? user?.photoURL;

  useEffect(() => {
    if (!me) return;
    setName(me.displayName ?? "");
    setAccent(me.accentColor);
    setUsePhoto(me.usePhoto);
  }, [me]);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const updated = await api.updateMe({ displayName: name, accentColor: accent, usePhoto });
      setMe(updated);
      if (phase === "user") await refreshUser();
      setMsg({ kind: "ok", text: t("account.profileSaved") });
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={<UserRound size={18} />} title={t("account.profile")}>
      <form className="account-profile" onSubmit={onSave}>
        <div className="account-avatar">
          <UserAvatar size={88} accentOverride={accent} usePhotoOverride={usePhoto} />
        </div>
        <div className="account-fields">
          <div className="auth-field">
            <label htmlFor={nameId}>{t("account.displayName")}</label>
            <div className="auth-input">
              <input id={nameId} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} required autoComplete="nickname" />
            </div>
          </div>
          <fieldset className="accent-picker">
            <legend>{t("account.avatarColour")}</legend>
            <div className="accent-swatches">
              {ACCENT_COLORS.map((c) => (
                <label key={c} className="accent-swatch" style={{ background: c }} title={c}>
                  <input type="radio" name="accent" value={c} checked={(accent ?? ACCENT_COLORS[0]) === c} onChange={() => setAccent(c)} />
                  <span className="sr-only">{t("account.colour", { color: c })}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {photo && (
            <label className="check-row">
              <input type="checkbox" checked={usePhoto} onChange={(e) => setUsePhoto(e.target.checked)} />
              {t("account.usePhoto")}
            </label>
          )}
          <Status msg={msg} />
          <div>
            <button type="submit" className="pill-btn" disabled={busy || !name.trim()}>
              {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
              {t("account.saveProfile")}
            </button>
          </div>
        </div>
      </form>
    </Section>
  );
}

function EmailSection({ ask }: { ask: (r: string) => Promise<boolean> }) {
  const t = useT();
  const { user, refreshUser } = useAuth();
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState<"verify" | "change" | "check" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const emailId = useId();
  if (!user) return null;

  const resend = async () => {
    setBusy("verify");
    setMsg(null);
    try {
      await sendEmailVerification(user);
      setMsg({ kind: "ok", text: t("account.verificationSent", { email: user.email ?? "" }) });
    } catch (e) {
      setMsg({ kind: "error", text: authErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    setBusy("check");
    await refreshUser().catch(() => {});
    setBusy(null);
  };

  const change = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("change");
    setMsg(null);
    try {
      const done = await withRecentLogin(ask, t("account.reason.email"), () => verifyBeforeUpdateEmail(user, newEmail.trim()));
      if (done !== null) {
        setMsg({ kind: "ok", text: t("account.emailCheck", { email: newEmail.trim() }) });
        setNewEmail("");
      }
    } catch (err) {
      setMsg({ kind: "error", text: authErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section icon={<Mail size={18} />} title={t("account.email")}>
      <div className="account-row">
        <div>
          <div className="account-value">{user.email ?? t("account.noEmail")}</div>
          {user.emailVerified ? (
            <span className="badge is-ok">
              <BadgeCheck size={14} aria-hidden="true" /> {t("account.verified")}
            </span>
          ) : (
            <span className="badge is-warn">
              <TriangleAlert size={14} aria-hidden="true" /> {t("account.notVerified")}
            </span>
          )}
        </div>
        {!user.emailVerified && (
          <div className="account-actions">
            <button type="button" className="ghost-btn" onClick={resend} disabled={busy !== null}>
              {t("account.resend")}
            </button>
            <button type="button" className="ghost-btn" onClick={check} disabled={busy !== null}>
              {t("account.iVerified")}
            </button>
          </div>
        )}
      </div>
      <form className="account-inline-form" onSubmit={change}>
        <div className="auth-field">
          <label htmlFor={emailId}>{t("account.newEmail")}</label>
          <div className="auth-input">
            <input id={emailId} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required autoComplete="email" />
          </div>
        </div>
        <button type="submit" className="ghost-btn" disabled={busy !== null || !newEmail.trim()}>
          {busy === "change" && <Loader2 size={16} className="spin" aria-hidden="true" />}
          {t("account.changeEmail")}
        </button>
      </form>
      <Status msg={msg} />
    </Section>
  );
}

function PasswordSection({ ask }: { ask: (r: string) => Promise<boolean> }) {
  const t = useT();
  const { user, refreshUser } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const ids = { cur: useId(), next: useId(), confirm: useId(), strength: useId() };
  if (!user) return null;
  const hasPassword = hasProvider(user, "password");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) return setMsg({ kind: "error", text: t("account.err.short") });
    if (next !== confirm) return setMsg({ kind: "error", text: t("account.err.mismatch") });
    setBusy(true);
    try {
      if (hasPassword) {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? "", current));
        await updatePassword(user, next);
        setMsg({ kind: "ok", text: t("account.passwordChanged") });
      } else {
        const done = await withRecentLogin(ask, t("account.reason.password"), () =>
          linkWithCredential(user, EmailAuthProvider.credential(user.email ?? "", next))
        );
        if (done === null) return;
        await refreshUser();
        setMsg({ kind: "ok", text: t("account.passwordAdded") });
      }
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setMsg({ kind: "error", text: authErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={<KeyRound size={18} />} title={hasPassword ? t("account.changePassword") : t("account.addPasswordTitle")}>
      {!hasPassword && <p className="account-hint">{t("account.googleOnly", { email: user.email ?? "" })}</p>}
      <form className="account-grid-form" onSubmit={onSubmit}>
        {hasPassword && (
          <div className="auth-field">
            <label htmlFor={ids.cur}>{t("account.currentPassword")}</label>
            <div className="auth-input">
              <input id={ids.cur} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            </div>
          </div>
        )}
        <div className="auth-field">
          <label htmlFor={ids.next}>{t("account.newPassword")}</label>
          <div className="auth-input">
            <input id={ids.next} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-describedby={ids.strength} required />
          </div>
        </div>
        <div className="auth-field">
          <label htmlFor={ids.confirm}>{t("account.confirmNewPassword")}</label>
          <div className="auth-input">
            <input id={ids.confirm} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required aria-invalid={(confirm && confirm !== next) || undefined} />
          </div>
        </div>
        <StrengthMeter password={next} id={ids.strength} />
        <Status msg={msg} />
        <div>
          <button type="submit" className="pill-btn" disabled={busy}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
            {hasPassword ? t("account.changePassword") : t("account.addPassword")}
          </button>
        </div>
      </form>
    </Section>
  );
}

function ProvidersSection({ ask }: { ask: (r: string) => Promise<boolean> }) {
  const t = useT();
  const { user, refreshUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  if (!user) return null;
  const google = hasProvider(user, "google.com");
  const password = hasProvider(user, "password");
  const only = user.providerData.length <= 1;

  const link = async () => {
    setBusy(true);
    setMsg(null);
    const provider = new GoogleAuthProvider();
    try {
      await withRecentLogin(ask, t("account.reason.link"), () => linkWithPopup(user, provider));
      await refreshUser();
      setMsg({ kind: "ok", text: t("account.googleLinked") });
    } catch (e) {
      if (authErrorCode(e) === "auth/popup-blocked") {
        await linkWithRedirect(user, provider);
        return;
      }
      if (!isPopupDismissal(e)) setMsg({ kind: "error", text: authErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const unlinkGoogle = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await unlink(user, "google.com");
      await refreshUser();
      setMsg({ kind: "ok", text: t("account.googleUnlinked") });
    } catch (e) {
      setMsg({ kind: "error", text: authErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={<Link2 size={18} />} title={t("account.methods")}>
      <ul className="provider-list">
        <li>
          <span>
            <strong>{t("account.emailPassword")}</strong>
            <span className="account-hint">{password ? t("account.enabled") : t("account.notSet")}</span>
          </span>
        </li>
        <li>
          <span>
            <strong>{t("account.google")}</strong>
            <span className="account-hint">{google ? t("account.linked") : t("account.notLinked")}</span>
          </span>
          {google ? (
            <button type="button" className="ghost-btn" onClick={unlinkGoogle} disabled={busy || only} title={only ? t("account.unlinkOnly") : undefined}>
              {t("account.unlink")}
            </button>
          ) : (
            <button type="button" className="ghost-btn" onClick={link} disabled={busy}>
              {t("account.linkGoogle")}
            </button>
          )}
        </li>
      </ul>
      <Status msg={msg} />
    </Section>
  );
}

function SessionsSection() {
  const t = useT();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const everywhere = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.revokeSessions();
      navigate("/login", { replace: true });
      await signOut("account.signedOutAll");
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
      setBusy(false);
    }
  };

  return (
    <Section icon={<MonitorSmartphone size={18} />} title={t("account.sessions")}>
      <p className="account-hint">{t("account.sessionsText")}</p>
      <div className="account-actions">
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            navigate("/");
            void signOut();
          }}
        >
          <LogOut size={16} aria-hidden="true" /> {t("account.signOut")}
        </button>
        <button type="button" className="ghost-btn" onClick={everywhere} disabled={busy}>
          {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
          {t("account.signOutAll")}
        </button>
      </div>
      <Status msg={msg} />
    </Section>
  );
}

function DataSection() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const download = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const data = await api.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `muify-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMsg({ kind: "ok", text: t("account.downloaded") });
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={<Download size={18} />} title={t("account.data")}>
      <p className="account-hint">{t("account.dataText")}</p>
      <div className="account-actions">
        <button type="button" className="ghost-btn" onClick={download} disabled={busy}>
          {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
          {t("account.download")}
        </button>
      </div>
      <Status msg={msg} />
    </Section>
  );
}

function DeleteSection({ ask }: { ask: (r: string) => Promise<boolean> }) {
  const t = useT();
  const { user, signOut } = useAuth();
  const { notifyInfo, notify } = useLibrary();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const inputId = useId();
  const WORD = t("account.deleteWord");
  if (!user) return null;

  const onDelete = async (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim() !== WORD) return;
    setMsg(null);
    // Always confirm identity first: the server only accepts a sign-in from the last 5 minutes.
    if (!(await ask(t("account.reason.delete")))) return;
    setBusy(true);
    // Leave the protected page first: once the account is gone, any in-flight request ends the
    // session, and /account would otherwise bounce to /login.
    navigate("/", { replace: true });
    try {
      await api.deleteAccount();
      await signOut();
      notifyInfo(t("account.deleted"));
    } catch (err) {
      notify(t("account.deleteFailed", { error: errorText(err) }));
    }
  };

  return (
    <Section icon={<ShieldAlert size={18} />} title={t("account.deleteTitle")} danger>
      <p className="account-hint">{t("account.deleteText")}</p>
      <form className="account-inline-form" onSubmit={onDelete}>
        <div className="auth-field">
          <label htmlFor={inputId}>
            <Trans k="account.typeToConfirm" values={{ word: <strong>{WORD}</strong> }} />
          </label>
          <div className="auth-input">
            <input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </div>
        </div>
        <button type="submit" className="pill-btn is-danger" disabled={busy || typed.trim() !== WORD}>
          {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
          {t("account.deleteButton")}
        </button>
      </form>
      <Status msg={msg} />
    </Section>
  );
}

/** Language of the UI (saved to the account). */
function LanguageSection() {
  const t = useT();
  return (
    <Section icon={<Languages size={18} />} title={t("account.language")}>
      <p className="account-hint">{t("account.languageText")}</p>
      <LanguageSwitch />
    </Section>
  );
}

export function AccountPage() {
  const t = useT();
  useDocumentTitle(t("account.title"));
  const { phase, user } = useAuth();
  const { ask, dialog } = useReauth();

  if (phase === "local") {
    return (
      <div className="page account-page">
        <div className="page-head">
          <h1 className="page-title">{t("account.title")}</h1>
        </div>
        <div className="empty-state">
          <h2>{t("account.localTitle")}</h2>
          <p>{t("account.localText")}</p>
        </div>
        <div className="account-grid">
          <LanguageSection />
          <DataSection />
        </div>
      </div>
    );
  }

  return (
    <div className="page account-page">
      <div className="page-head">
        <h1 className="page-title">{t("account.title")}</h1>
        <p className="page-sub">{user?.email}</p>
      </div>
      <div className="account-grid">
        <ProfileSection />
        <LanguageSection />
        <EmailSection ask={ask} />
        <PasswordSection ask={ask} />
        <ProvidersSection ask={ask} />
        <SessionsSection />
        <DataSection />
        <DeleteSection ask={ask} />
      </div>
      {dialog}
    </div>
  );
}
