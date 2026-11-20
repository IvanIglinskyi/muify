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
import { BadgeCheck, Download, KeyRound, Link2, Loader2, LogOut, Mail, MonitorSmartphone, ShieldAlert, Trash2, TriangleAlert, UserRound } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiRequestError } from "../api";
import { UserAvatar } from "../components/UserAvatar";
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
          Confirm it's you
        </h2>
        <p className="modal-text">{reason}</p>
        {usesPassword && (
          <div className="auth-field">
            <label htmlFor={pwId}>Current password</label>
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
            Cancel
          </button>
          {usesGoogle && (
            <button type="button" className={usesPassword ? "ghost-btn" : "pill-btn"} disabled={busy} onClick={() => void run(() => reauthenticateWithPopup(user, new GoogleAuthProvider()))}>
              Confirm with Google
            </button>
          )}
          {usesPassword && (
            <button type="submit" className="pill-btn" disabled={busy || !password}>
              {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
              Confirm
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
      setMsg({ kind: "ok", text: "Profile saved." });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={<UserRound size={18} />} title="Profile">
      <form className="account-profile" onSubmit={onSave}>
        <div className="account-avatar">
          <UserAvatar size={88} accentOverride={accent} usePhotoOverride={usePhoto} />
        </div>
        <div className="account-fields">
          <div className="auth-field">
            <label htmlFor={nameId}>Display name</label>
            <div className="auth-input">
              <input id={nameId} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} required autoComplete="nickname" />
            </div>
          </div>
          <fieldset className="accent-picker">
            <legend>Avatar colour</legend>
            <div className="accent-swatches">
              {ACCENT_COLORS.map((c) => (
                <label key={c} className="accent-swatch" style={{ background: c }} title={c}>
                  <input type="radio" name="accent" value={c} checked={(accent ?? ACCENT_COLORS[0]) === c} onChange={() => setAccent(c)} />
                  <span className="sr-only">Colour {c}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {photo && (
            <label className="check-row">
              <input type="checkbox" checked={usePhoto} onChange={(e) => setUsePhoto(e.target.checked)} />
              Use my Google photo as avatar
            </label>
          )}
          <Status msg={msg} />
          <div>
            <button type="submit" className="pill-btn" disabled={busy || !name.trim()}>
              {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
              Save profile
            </button>
          </div>
        </div>
      </form>
    </Section>
  );
}

function EmailSection({ ask }: { ask: (r: string) => Promise<boolean> }) {
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
      setMsg({ kind: "ok", text: `Verification email sent to ${user.email}.` });
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
      const done = await withRecentLogin(ask, "Changing your email needs a recent sign-in.", () => verifyBeforeUpdateEmail(user, newEmail.trim()));
      if (done !== null) {
        setMsg({ kind: "ok", text: `Check ${newEmail.trim()}: your email changes after you click the link we sent there.` });
        setNewEmail("");
      }
    } catch (err) {
      setMsg({ kind: "error", text: authErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section icon={<Mail size={18} />} title="Email">
      <div className="account-row">
        <div>
          <div className="account-value">{user.email ?? "No email"}</div>
          {user.emailVerified ? (
            <span className="badge is-ok">
              <BadgeCheck size={14} aria-hidden="true" /> Verified
            </span>
          ) : (
            <span className="badge is-warn">
              <TriangleAlert size={14} aria-hidden="true" /> Not verified
            </span>
          )}
        </div>
        {!user.emailVerified && (
          <div className="account-actions">
            <button type="button" className="ghost-btn" onClick={resend} disabled={busy !== null}>
              Resend verification
            </button>
            <button type="button" className="ghost-btn" onClick={check} disabled={busy !== null}>
              I've verified
            </button>
          </div>
        )}
      </div>
      <form className="account-inline-form" onSubmit={change}>
        <div className="auth-field">
          <label htmlFor={emailId}>New email</label>
          <div className="auth-input">
            <input id={emailId} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required autoComplete="email" />
          </div>
        </div>
        <button type="submit" className="ghost-btn" disabled={busy !== null || !newEmail.trim()}>
          {busy === "change" && <Loader2 size={16} className="spin" aria-hidden="true" />}
          Change email
        </button>
      </form>
      <Status msg={msg} />
    </Section>
  );
}

function PasswordSection({ ask }: { ask: (r: string) => Promise<boolean> }) {
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
    if (next.length < 8) return setMsg({ kind: "error", text: "Use at least 8 characters." });
    if (next !== confirm) return setMsg({ kind: "error", text: "The new passwords don't match." });
    setBusy(true);
    try {
      if (hasPassword) {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? "", current));
        await updatePassword(user, next);
        setMsg({ kind: "ok", text: "Password changed." });
      } else {
        const done = await withRecentLogin(ask, "Adding a password needs a recent sign-in.", () =>
          linkWithCredential(user, EmailAuthProvider.credential(user.email ?? "", next))
        );
        if (done === null) return;
        await refreshUser();
        setMsg({ kind: "ok", text: "Password added — you can now also sign in with your email." });
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
    <Section icon={<KeyRound size={18} />} title={hasPassword ? "Change password" : "Add a password"}>
      {!hasPassword && <p className="account-hint">You sign in with Google. Add a password to also sign in with {user.email}.</p>}
      <form className="account-grid-form" onSubmit={onSubmit}>
        {hasPassword && (
          <div className="auth-field">
            <label htmlFor={ids.cur}>Current password</label>
            <div className="auth-input">
              <input id={ids.cur} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            </div>
          </div>
        )}
        <div className="auth-field">
          <label htmlFor={ids.next}>New password</label>
          <div className="auth-input">
            <input id={ids.next} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-describedby={ids.strength} required />
          </div>
        </div>
        <div className="auth-field">
          <label htmlFor={ids.confirm}>Confirm new password</label>
          <div className="auth-input">
            <input id={ids.confirm} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required aria-invalid={(confirm && confirm !== next) || undefined} />
          </div>
        </div>
        <StrengthMeter password={next} id={ids.strength} />
        <Status msg={msg} />
        <div>
          <button type="submit" className="pill-btn" disabled={busy}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
            {hasPassword ? "Change password" : "Add password"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function ProvidersSection({ ask }: { ask: (r: string) => Promise<boolean> }) {
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
      await withRecentLogin(ask, "Linking Google needs a recent sign-in.", () => linkWithPopup(user, provider));
      await refreshUser();
      setMsg({ kind: "ok", text: "Google is now linked to your account." });
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
      setMsg({ kind: "ok", text: "Google was unlinked. Sign in with your email and password from now on." });
    } catch (e) {
      setMsg({ kind: "error", text: authErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={<Link2 size={18} />} title="Sign-in methods">
      <ul className="provider-list">
        <li>
          <span>
            <strong>Email &amp; password</strong>
            <span className="account-hint">{password ? "Enabled" : "Not set — add a password above"}</span>
          </span>
        </li>
        <li>
          <span>
            <strong>Google</strong>
            <span className="account-hint">{google ? "Linked" : "Not linked"}</span>
          </span>
          {google ? (
            <button type="button" className="ghost-btn" onClick={unlinkGoogle} disabled={busy || only} title={only ? "Add a password first — it's your only sign-in method" : undefined}>
              Unlink
            </button>
          ) : (
            <button type="button" className="ghost-btn" onClick={link} disabled={busy}>
              Link Google
            </button>
          )}
        </li>
      </ul>
      <Status msg={msg} />
    </Section>
  );
}

function SessionsSection() {
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
      await signOut("You were signed out on all devices.");
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
      setBusy(false);
    }
  };

  return (
    <Section icon={<MonitorSmartphone size={18} />} title="Sessions">
      <p className="account-hint">Lost a device or used a shared computer? Sign out everywhere — every device has to sign in again.</p>
      <div className="account-actions">
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            navigate("/");
            void signOut();
          }}
        >
          <LogOut size={16} aria-hidden="true" /> Sign out
        </button>
        <button type="button" className="ghost-btn" onClick={everywhere} disabled={busy}>
          {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
          Sign out of all devices
        </button>
      </div>
      <Status msg={msg} />
    </Section>
  );
}

function DataSection() {
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
      setMsg({ kind: "ok", text: "Your data was downloaded." });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={<Download size={18} />} title="Your data">
      <p className="account-hint">A JSON file with your profile, likes, playlists, listening history and player state.</p>
      <div className="account-actions">
        <button type="button" className="ghost-btn" onClick={download} disabled={busy}>
          {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
          Download my data
        </button>
      </div>
      <Status msg={msg} />
    </Section>
  );
}

function DeleteSection({ ask }: { ask: (r: string) => Promise<boolean> }) {
  const { user, signOut } = useAuth();
  const { notifyInfo, notify } = useLibrary();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const inputId = useId();
  const WORD = "DELETE";
  if (!user) return null;

  const onDelete = async (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim() !== WORD) return;
    setMsg(null);
    // Always confirm identity first: the server only accepts a sign-in from the last 5 minutes.
    if (!(await ask("Deleting your account is permanent. Confirm your identity to continue."))) return;
    setBusy(true);
    // Leave the protected page first: once the account is gone, any in-flight request ends the
    // session, and /account would otherwise bounce to /login.
    navigate("/", { replace: true });
    try {
      await api.deleteAccount();
      await signOut();
      notifyInfo("Your account and all its data were deleted.");
    } catch (err) {
      notify(`Could not delete the account: ${(err as Error).message}`);
    }
  };

  return (
    <Section icon={<ShieldAlert size={18} />} title="Delete account" danger>
      <p className="account-hint">
        This permanently deletes your MuiFy account, favourites, playlists, history and saved player state. It can't be undone.
      </p>
      <form className="account-inline-form" onSubmit={onDelete}>
        <div className="auth-field">
          <label htmlFor={inputId}>
            Type <strong>{WORD}</strong> to confirm
          </label>
          <div className="auth-input">
            <input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </div>
        </div>
        <button type="submit" className="pill-btn is-danger" disabled={busy || typed.trim() !== WORD}>
          {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
          Delete my account
        </button>
      </form>
      <Status msg={msg} />
    </Section>
  );
}

export function AccountPage() {
  useDocumentTitle("Account");
  const { phase, user } = useAuth();
  const { ask, dialog } = useReauth();

  if (phase === "local") {
    return (
      <div className="page account-page">
        <div className="page-head">
          <h1 className="page-title">Account</h1>
        </div>
        <div className="empty-state">
          <h2>Local mode</h2>
          <p>This server has no accounts configured. Your likes, playlists and history are saved on this computer — no sign-in needed.</p>
        </div>
        <DataSection />
      </div>
    );
  }

  return (
    <div className="page account-page">
      <div className="page-head">
        <h1 className="page-title">Account</h1>
        <p className="page-sub">{user?.email}</p>
      </div>
      <div className="account-grid">
        <ProfileSection />
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
