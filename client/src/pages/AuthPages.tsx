import { Eye, EyeOff, Loader2, Lock, Mail, User as UserIcon } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useId, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "../components/common";
import { authErrorMessage, isPopupDismissal, passwordStrength } from "../lib/authErrors";
import { consumeRedirectNext, safeNext, useAuth } from "../store/AuthContext";
import { useDocumentTitle } from "./shell";

/** Google "G" mark (brand colours, inline SVG — no external image). */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-ribbon" aria-hidden="true" />
        <Logo className="logo-sm auth-logo" />
        <h1 id="auth-title" className="auth-title">
          {title}
        </h1>
        {subtitle && <p className="auth-sub">{subtitle}</p>}
        {children}
      </section>
    </div>
  );
}

function Field({
  label,
  icon,
  type = "text",
  value,
  onChange,
  autoComplete,
  required = true,
  describedBy,
  invalid,
  autoFocus,
}: {
  label: string;
  icon: ReactNode;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
  describedBy?: string;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-input">
        <span className="auth-input-icon" aria-hidden="true">
          {icon}
        </span>
        <input
          id={id}
          type={isPassword && show ? "text" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          autoFocus={autoFocus}
        />
        {isPassword && (
          <button
            type="button"
            className="icon-btn auth-eye"
            aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-pressed={show}
            onClick={() => setShow((s) => !s)}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  return (
    <div className={message ? "auth-error" : "sr-only"} role="alert" aria-live="assertive">
      {message}
    </div>
  );
}

function GoogleButton({ next, onError, disabled }: { next: string; onError: (m: string | null) => void; disabled?: boolean }) {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="google-btn"
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        onError(null);
        try {
          await signInWithGoogle(next);
        } catch (e) {
          if (!isPopupDismissal(e)) onError(authErrorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <GoogleMark />}
      Continue with Google
    </button>
  );
}

/** Shown instead of the forms when accounts are off or misconfigured. */
function AccountsUnavailable() {
  const { phase, clientMisconfigured } = useAuth();
  if (phase === "loading") {
    return (
      <AuthCard title="One moment…">
        <p className="auth-sub">Checking your session…</p>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Accounts are off"
      subtitle={
        clientMisconfigured
          ? "This app build has no Firebase web config (client/.env.local), so sign-in isn't available."
          : "This MuiFy server runs in local mode: no sign-in needed — your likes, playlists and history are saved on this computer."
      }
    >
      <Link to="/" className="pill-btn auth-submit">
        Go home
      </Link>
    </AuthCard>
  );
}

function useAuthGate(): { ready: boolean; signedInRedirect: ReactNode | null; next: string } {
  const { phase, clientMisconfigured } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next") ?? consumeRedirectNextOnce());
  const ready = phase === "guest" && !clientMisconfigured;
  const signedInRedirect = phase === "user" ? <Navigate to={next} replace /> : null;
  return { ready, signedInRedirect, next };
}

let redirectNext: string | null | undefined;
/** After a Google redirect sign-in we land on /login again: go where the listener was heading. */
function consumeRedirectNextOnce(): string | null {
  if (redirectNext === undefined) redirectNext = consumeRedirectNext();
  return redirectNext;
}

const withNext = (path: string, next: string) => (next === "/" ? path : `${path}?next=${encodeURIComponent(next)}`);

export function LoginPage() {
  useDocumentTitle("Sign in");
  const { signIn, redirectError, clearRedirectError, notice, setNotice } = useAuth();
  const { ready, signedInRedirect, next } = useAuthGate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (redirectError) {
      setError(redirectError);
      clearRedirectError();
    }
  }, [redirectError, clearRedirectError]);

  if (signedInRedirect) return signedInRedirect;
  if (!ready) return <AccountsUnavailable />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      setNotice(null);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to keep your favourites, playlists and history in sync.">
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
      <GoogleButton next={next} onError={setError} disabled={busy} />
      <div className="auth-divider">
        <span>or with email</span>
      </div>
      <form className="auth-form" onSubmit={onSubmit} noValidate={false}>
        <Field label="Email" icon={<Mail size={16} />} type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
        <Field label="Password" icon={<Lock size={16} />} type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="auth-row-end">
          <Link to={withNext("/reset-password", next)} className="link-btn">
            Forgot password?
          </Link>
        </div>
        <FormError message={error} />
        <button type="submit" className="pill-btn auth-submit" disabled={busy}>
          {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
          Sign in
        </button>
      </form>
      <p className="auth-switch">
        New to MuiFy? <Link to={withNext("/signup", next)}>Create an account</Link>
      </p>
    </AuthCard>
  );
}

export function StrengthMeter({ password, id }: { password: string; id: string }) {
  const s = passwordStrength(password);
  return (
    <div className="strength" id={id} aria-live="polite">
      <div className={`strength-bar s${s.score}`} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <span className="strength-text">
        {s.label && <strong>{s.label}. </strong>}
        {s.hint}
      </span>
    </div>
  );
}

export function SignupPage() {
  useDocumentTitle("Create account");
  const { signUp } = useAuth();
  const { ready, signedInRedirect, next } = useAuthGate();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strengthId = useId();
  const mismatch = confirm.length > 0 && confirm !== password;

  if (signedInRedirect && !busy) return signedInRedirect;
  if (!ready && !busy) return <AccountsUnavailable />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Please enter a display name.");
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    try {
      await signUp(name, email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Create your account" subtitle="Free forever. Save what you love and pick up where you left off.">
      <GoogleButton next={next} onError={setError} disabled={busy} />
      <div className="auth-divider">
        <span>or with email</span>
      </div>
      <form className="auth-form" onSubmit={onSubmit}>
        <Field label="Display name" icon={<UserIcon size={16} />} value={name} onChange={setName} autoComplete="nickname" autoFocus />
        <Field label="Email" icon={<Mail size={16} />} type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          label="Password"
          icon={<Lock size={16} />}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          describedBy={strengthId}
        />
        <StrengthMeter password={password} id={strengthId} />
        <Field
          label="Confirm password"
          icon={<Lock size={16} />}
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          invalid={mismatch}
        />
        {mismatch && <p className="field-hint is-warn">The passwords don't match yet.</p>}
        <FormError message={error} />
        <button type="submit" className="pill-btn auth-submit" disabled={busy}>
          {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
          Create account
        </button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to={withNext("/login", next)}>Sign in</Link>
      </p>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  useDocumentTitle("Reset password");
  const { resetPassword } = useAuth();
  const { ready, signedInRedirect, next } = useAuthGate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (signedInRedirect) return signedInRedirect;
  if (!ready) return <AccountsUnavailable />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email);
      setSent(true);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a link to choose a new password.">
      {sent ? (
        <p className="auth-notice is-ok" role="status">
          If an account exists for <strong>{email.trim()}</strong>, a reset link is on its way. Check your inbox (and spam folder).
        </p>
      ) : (
        <form className="auth-form" onSubmit={onSubmit}>
          <Field label="Email" icon={<Mail size={16} />} type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
          <FormError message={error} />
          <button type="submit" className="pill-btn auth-submit" disabled={busy}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
            Send reset link
          </button>
        </form>
      )}
      <p className="auth-switch">
        <Link to={withNext("/login", next)}>Back to sign in</Link>
      </p>
    </AuthCard>
  );
}

/** Wraps routes that need an account: guests go to /login?next=… and come back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { phase } = useAuth();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  if (phase === "loading") {
    return (
      <div className="empty-state" aria-busy="true">
        <Loader2 size={22} className="spin" aria-hidden="true" />
        <p>Checking your session…</p>
      </div>
    );
  }
  if (phase === "guest") return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />;
  return <>{children}</>;
}
