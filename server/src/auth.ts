// Who is calling? Resolves the Firebase ID token (Authorization: Bearer <token>) per request.
//
// - Local mode (no Firebase config): every request is the implicit "local" user — as before.
// - Firebase mode: a valid token → that user; no / invalid token → guest. Catalogue routes accept
//   guests; user-state routes call requireMember(), which answers 401 for guests.
//
// Verified tokens are cached briefly (revocation is checked on first sight of each token), so a
// listener's frequent pings cost no extra round-trips to Firebase.
import type { Request, Response } from "express";
import { authMode, firebase, type VerifiedUser } from "./firebase.js";
import { LOCAL_UID, userStore, type UserDoc } from "./userStore.js";

export type Identity =
  | { kind: "local"; uid: string }
  | { kind: "user"; uid: string; token: VerifiedUser }
  | { kind: "guest"; error: AuthFailure | null };

export interface AuthFailure {
  code: "token-invalid" | "token-expired" | "token-revoked" | "user-disabled" | "auth-unavailable";
  message: string;
}

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 2000;
const tokenCache = new Map<string, { user: VerifiedUser; until: number }>();

function cacheGet(token: string): VerifiedUser | null {
  const hit = tokenCache.get(token);
  if (!hit) return null;
  if (Date.now() > hit.until) {
    tokenCache.delete(token);
    return null;
  }
  return hit.user;
}

function cachePut(token: string, user: VerifiedUser) {
  if (tokenCache.size >= CACHE_MAX) {
    // Drop the oldest entries (Map keeps insertion order).
    for (const k of [...tokenCache.keys()].slice(0, CACHE_MAX / 4)) tokenCache.delete(k);
  }
  tokenCache.set(token, { user, until: Math.min(Date.now() + CACHE_TTL_MS, user.expiresAt * 1000) });
}

/** After revoking sessions / deleting an account: forget every cached token of `uid`. */
export function forgetTokensOf(uid: string) {
  for (const [k, v] of tokenCache) if (v.user.uid === uid) tokenCache.delete(k);
}

function failureOf(e: unknown): AuthFailure {
  const code = String((e as { code?: string })?.code ?? "");
  if (code.endsWith("id-token-expired")) return { code: "token-expired", message: "Your session token has expired" };
  if (code.endsWith("id-token-revoked")) return { code: "token-revoked", message: "This session was signed out" };
  if (code.endsWith("user-disabled")) return { code: "user-disabled", message: "This account has been disabled" };
  if (code.endsWith("user-not-found")) return { code: "token-revoked", message: "This account no longer exists" };
  if (code.startsWith("auth/") || code === "") {
    return { code: "token-invalid", message: "Invalid sign-in token" };
  }
  return { code: "auth-unavailable", message: "Could not verify the sign-in token" };
}

const BEARER = /^Bearer\s+([A-Za-z0-9._\-:]+)\s*$/;

async function resolve(req: Request): Promise<Identity> {
  if (authMode() === "local") return { kind: "local", uid: LOCAL_UID };
  const m = BEARER.exec(req.headers.authorization ?? "");
  if (!m) return { kind: "guest", error: req.headers.authorization ? { code: "token-invalid", message: "Malformed Authorization header" } : null };
  const token = m[1];
  const cached = cacheGet(token);
  if (cached) return { kind: "user", uid: cached.uid, token: cached };
  try {
    const fb = await firebase();
    const user = await fb.verifyIdToken(token);
    cachePut(token, user);
    return { kind: "user", uid: user.uid, token: user };
  } catch (e) {
    const failure = failureOf(e);
    if (failure.code === "auth-unavailable") console.error(`[auth] Token verification failed: ${(e as Error).message}`);
    return { kind: "guest", error: failure };
  }
}

const memo = new WeakMap<Request, Promise<Identity>>();

/** The caller's identity (memoised per request). */
export function identify(req: Request): Promise<Identity> {
  let p = memo.get(req);
  if (!p) {
    p = resolve(req);
    memo.set(req, p);
  }
  return p;
}

/** State of the caller, or null for guests (catalogue routes: no likes, default lists). */
export async function viewerDoc(req: Request): Promise<UserDoc | null> {
  const who = await identify(req);
  if (who.kind === "guest") return null;
  const doc = await userStore().get(who.uid);
  if (who.kind === "user") syncProfile(doc, who.token);
  return doc;
}

/** Keeps users/{uid}/profile in step with the token's claims (first visit, email change…). */
function syncProfile(doc: UserDoc, t: VerifiedUser) {
  const p = doc.state.profile;
  if (!p) {
    doc.updateProfile({ displayName: t.name, email: t.email, photoURL: t.picture });
    return;
  }
  const changes: Parameters<UserDoc["updateProfile"]>[0] = {};
  if (t.email !== p.email) changes.email = t.email;
  if (t.picture !== p.photoURL) changes.photoURL = t.picture;
  // The token's name claim lags behind a rename until the client refreshes it: only fill blanks.
  if (!p.displayName && t.name) changes.displayName = t.name;
  if (Object.keys(changes).length) doc.updateProfile(changes);
}

export interface Member {
  doc: UserDoc;
  identity: Exclude<Identity, { kind: "guest" }>;
}

/** Signed-in caller (or the local user), else sends 401 and returns undefined. */
export async function requireMember(req: Request, res: Response): Promise<Member | undefined> {
  const identity = await identify(req);
  if (identity.kind === "guest") {
    const err = identity.error;
    if (err?.code === "auth-unavailable") {
      res.status(503).json({ error: err.message, code: err.code });
      return undefined;
    }
    res
      .status(401)
      .setHeader("WWW-Authenticate", 'Bearer realm="muify"')
      .json(err ? { error: err.message, code: err.code } : { error: "Sign in to save your music", code: "auth-required" });
    return undefined;
  }
  const doc = await viewerDoc(req);
  return { doc: doc!, identity };
}
