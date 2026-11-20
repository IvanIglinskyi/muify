import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, setAuthBridge } from "../api";
import { authErrorCode, authErrorMessage } from "../lib/authErrors";
import { firebaseAuth, firebaseConfigured } from "../lib/firebase";
import type { AuthStatus, MeResponse } from "../types";

/**
 * - "loading": server mode / Firebase session not known yet.
 * - "local": the server has no accounts (Firebase not configured) — everything is saved, as before.
 * - "guest": accounts are on, nobody signed in — browse & play, saving needs sign-in.
 * - "user": signed in.
 */
export type AuthPhase = "loading" | "local" | "guest" | "user";

interface AuthApi {
  phase: AuthPhase;
  status: AuthStatus | null;
  user: User | null;
  /** Bumped when `user` changed in place (reload after verification, profile edits…). */
  userVersion: number;
  /** Profile from our API (accent colour, photo preference…). */
  me: MeResponse | null;
  /** Whose data is on screen: "local" | "guest" | uid; null while loading. */
  identityKey: string | null;
  /** Likes, playlists, history and the player position can be saved. */
  canSave: boolean;
  /** Server has accounts but this client build has no Firebase config. */
  clientMisconfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (displayName: string, email: string, password: string) => Promise<void>;
  /** Popup, falling back to a full-page redirect if the popup is blocked. `next` = where to go after a redirect. */
  signInWithGoogle: (next: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: (message?: string) => Promise<void>;
  /** Re-reads the Firebase user (e.g. after email verification) and our profile. */
  refreshUser: () => Promise<void>;
  setMe: (me: MeResponse) => void;
  /** Error from a Google redirect sign-in (shown on the login page). */
  redirectError: string | null;
  clearRedirectError: () => void;
  /** "Sign in to save" nudge for guests. Returns true if the action may proceed. */
  requireSignIn: (what: string) => boolean;
  signInPrompt: string | null;
  dismissSignInPrompt: () => void;
  /** Message after a forced sign-out (session revoked elsewhere, account deleted…). */
  notice: string | null;
  setNotice: (m: string | null) => void;
}

const AuthContext = createContext<AuthApi | null>(null);

const NEXT_KEY = "muify:auth-next";

/** Only same-app paths are allowed as ?next= targets (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (/^\/(login|signup|reset-password)\b/.test(next)) return "/";
  return next;
}

export function consumeRedirectNext(): string | null {
  const v = sessionStorage.getItem(NEXT_KEY);
  sessionStorage.removeItem(NEXT_KEY);
  return v;
}

async function loadStatus(): Promise<AuthStatus | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (await api.getStatus()).auth;
    } catch {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!firebaseAuth);
  const [userVersion, setUserVersion] = useState(0);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [redirectError, setRedirectError] = useState<string | null>(null);
  const [signInPrompt, setSignInPrompt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    void loadStatus().then((s) => {
      setStatus(s);
      setStatusLoaded(true);
    });
  }, []);

  const mode = status?.mode ?? "local";
  const firebaseMode = statusLoaded && mode === "firebase";

  // Firebase session (persisted in the browser). Token refreshes fire this too.
  useEffect(() => {
    const auth = firebaseAuth;
    if (!auth) return;
    const unsub = onIdTokenChanged(auth, (u) => {
      setUser(u);
      setUserVersion((v) => v + 1);
      setAuthReady(true);
      if (u) u.getIdToken().then((t) => (tokenRef.current = t), () => {});
      else tokenRef.current = null;
    });
    getRedirectResult(auth).catch((e) => setRedirectError(authErrorMessage(e)));
    return unsub;
  }, []);

  const signOut = useCallback(async (message?: string) => {
    if (firebaseAuth) await fbSignOut(firebaseAuth);
    setMe(null);
    tokenRef.current = null;
    if (message) setNotice(message);
  }, []);

  // Hand the token to the API layer.
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  useEffect(() => {
    setAuthBridge({
      getToken: async () => {
        const auth = firebaseAuth;
        if (!auth) return null;
        await auth.authStateReady();
        const u = auth.currentUser;
        if (!u) return null;
        const t = await u.getIdToken();
        tokenRef.current = t;
        return t;
      },
      cachedToken: () => tokenRef.current,
      onSessionRejected: (code) =>
        void signOutRef.current(
          code === "user-disabled" ? "This account has been disabled." : "You were signed out. Please sign in again."
        ),
    });
  }, []);

  const phase: AuthPhase = !statusLoaded
    ? "loading"
    : !firebaseMode
      ? "local"
      : !authReady
        ? "loading"
        : user
          ? "user"
          : "guest";

  const identityKey = phase === "loading" ? null : phase === "user" ? user!.uid : phase;

  // Our profile (accent colour…) for the signed-in user.
  useEffect(() => {
    if (phase !== "user") {
      setMe(null);
      return;
    }
    let cancelled = false;
    api.getMe().then(
      (m) => !cancelled && setMe(m),
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [phase, identityKey]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!firebaseAuth) throw new Error("Sign-in is not configured.");
    await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
    setNotice(null);
  }, []);

  const signUp = useCallback(async (displayName: string, email: string, password: string) => {
    if (!firebaseAuth) throw new Error("Sign-in is not configured.");
    const cred = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
    const name = displayName.replace(/\s+/g, " ").trim();
    if (name) await updateProfile(cred.user, { displayName: name }).catch(() => {});
    sendEmailVerification(cred.user).catch(() => {});
    if (name) await api.updateMe({ displayName: name }).then(setMe, () => {});
    setUserVersion((v) => v + 1);
    setNotice(null);
  }, []);

  const signInWithGoogle = useCallback(async (next: string) => {
    const auth = firebaseAuth;
    if (!auth) throw new Error("Sign-in is not configured.");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(auth, provider);
      setNotice(null);
    } catch (e) {
      if (authErrorCode(e) === "auth/popup-blocked" || authErrorCode(e) === "auth/operation-not-supported-in-this-environment") {
        sessionStorage.setItem(NEXT_KEY, safeNext(next));
        await signInWithRedirect(auth, provider);
        return;
      }
      throw e;
    }
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    if (!firebaseAuth) throw new Error("Sign-in is not configured.");
    await sendPasswordResetEmail(firebaseAuth, email.trim());
  }, []);

  const refreshUser = useCallback(async () => {
    const u = firebaseAuth?.currentUser;
    if (!u) return;
    await u.reload();
    tokenRef.current = await u.getIdToken(true);
    setUser(firebaseAuth!.currentUser);
    setUserVersion((v) => v + 1);
    await api.getMe().then(setMe, () => {});
  }, []);

  const canSave = phase === "local" || phase === "user";
  const requireSignIn = useCallback(
    (what: string) => {
      if (canSave) return true;
      setSignInPrompt(`Sign in to ${what}`);
      return false;
    },
    [canSave]
  );

  const value = useMemo<AuthApi>(
    () => ({
      phase,
      status,
      user,
      userVersion,
      me,
      identityKey,
      canSave,
      clientMisconfigured: firebaseMode && !firebaseConfigured,
      signIn,
      signUp,
      signInWithGoogle,
      resetPassword,
      signOut,
      refreshUser,
      setMe,
      redirectError,
      clearRedirectError: () => setRedirectError(null),
      requireSignIn,
      signInPrompt,
      dismissSignInPrompt: () => setSignInPrompt(null),
      notice,
      setNotice,
    }),
    [phase, status, user, userVersion, me, identityKey, canSave, firebaseMode, signIn, signUp, signInWithGoogle, resetPassword, signOut, refreshUser, redirectError, requireSignIn, signInPrompt, notice]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Display helpers for avatars. */
export function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name || email?.split("@")[0] || "?").trim();
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return letters.toUpperCase();
}

export const ACCENT_COLORS = ["#ff9a1f", "#e8506e", "#9b6bff", "#2bb5a7", "#3d8bff", "#7cc04b"];
