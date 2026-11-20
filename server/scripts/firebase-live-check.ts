// Live end-to-end check against the REAL Firebase project configured in server/.env and
// client/.env.local. Creates two throwaway users (muify-test-<random>@example.com) with the
// Identity Toolkit REST API (the same calls the web SDK makes), drives the MuiFy API through the
// given base URL (e.g. the Vite proxy), inspects Realtime Database with the Admin SDK, and deletes
// everything it created at the end. Never prints secrets.
//
// Run: cd server && npx tsx scripts/firebase-live-check.ts http://localhost:5174
import "../src/env.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { firebase } from "../src/firebase.js";
import { encodeKey } from "../src/userStore.js";

const base = process.argv[2] ?? "http://localhost:5174";
const clientEnv = Object.fromEntries(
  readFileSync(fileURLToPath(new URL("../../client/.env.local", import.meta.url)), "utf8")
    .split(/\r?\n/)
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => [m[1], m[2]])
);
const apiKey = clientEnv.VITE_FIREBASE_API_KEY;
if (!apiKey) throw new Error("VITE_FIREBASE_API_KEY missing in client/.env.local");

let passes = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function identity(method: string, body: unknown) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json", referer: "http://localhost:5174/" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const rand = () => Math.random().toString(36).slice(2, 10);
const created: string[] = [];
const fb = await firebase();

try {
  const st = await call("GET", "/api/status");
  check("status via proxy: firebase mode, real project", st.json?.auth?.mode === "firebase" && st.json.auth.emulator === false, st.json?.auth);

  // ---- sign-up (Email/Password) ----
  const emailA = `muify-test-${rand()}@example.com`;
  const emailB = `muify-test-${rand()}@example.com`;
  const password = `T3st-${rand()}-pw!`;
  const upA = await identity("signUp", { email: emailA, password, returnSecureToken: true });
  check("sign-up A (Email/Password provider enabled)", upA.status === 200 && Boolean(upA.json.idToken), upA.json?.error?.message);
  if (upA.json.localId) created.push(upA.json.localId);
  const upB = await identity("signUp", { email: emailB, password, returnSecureToken: true });
  check("sign-up B", upB.status === 200, upB.json?.error?.message);
  if (upB.json.localId) created.push(upB.json.localId);
  const dup = await identity("signUp", { email: emailA, password, returnSecureToken: true });
  check("sign-up with the same email → EMAIL_EXISTS (auth/email-already-in-use)", dup.json?.error?.message === "EMAIL_EXISTS", dup.json?.error?.message);

  // ---- login ----
  const inA = await identity("signInWithPassword", { email: emailA, password, returnSecureToken: true });
  check("login A with the right password", inA.status === 200 && Boolean(inA.json.idToken), inA.json?.error?.message);
  const wrong = await identity("signInWithPassword", { email: emailA, password: "wrong-password-123", returnSecureToken: true });
  check(
    "login with a wrong password is rejected (INVALID_LOGIN_CREDENTIALS / INVALID_PASSWORD)",
    wrong.status === 400 && /INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD/.test(wrong.json?.error?.message ?? ""),
    wrong.json?.error?.message
  );
  const A = inA.json.idToken as string;
  const B = upB.json.idToken as string;
  const uidA = upA.json.localId as string;
  const uidB = upB.json.localId as string;

  // ---- 401 / 200 ----
  const g = await call("GET", "/api/history");
  check("no token → 401", g.status === 401 && g.json.code === "auth-required", g);
  const forged = await call("GET", "/api/history", A.slice(0, -4) + "AAAA");
  check("tampered token → 401 token-invalid", forged.status === 401 && forged.json.code === "token-invalid", forged);
  const okA = await call("GET", "/api/history", A);
  check("valid token → 200", okA.status === 200 && Array.isArray(okA.json), okA.status);
  const me = await call("GET", "/api/me", A);
  check("GET /api/me returns A", me.status === 200 && me.json.uid === uidA && me.json.email === emailA && me.json.providers.includes("password"), me.json);

  // ---- writes for A ----
  const mix = await call("GET", "/api/tracks/daily-mix", A);
  const trackId = mix.json[0]?.id as string;
  const like = await call("PATCH", `/api/tracks/${encodeURIComponent(trackId)}/like`, A, { liked: true });
  check(`A likes ${trackId}`, like.status === 200 && like.json.liked === true, like);
  const pl = await call("POST", "/api/playlists", A, { name: "Live test", trackIds: [trackId] });
  check("A creates a playlist", pl.status === 201, pl);
  const hist = await call("POST", "/api/history", A, { trackId, seconds: 15 });
  check("A reports a play", hist.status === 201, hist);
  const ps = await call("POST", "/api/player/state", A, { trackId, position: 12, queue: mix.json.slice(0, 3).map((t: any) => t.id), volume: 0.4 });
  check("A saves player state", ps.status === 204, ps);
  const prof = await call("PATCH", "/api/me", A, { displayName: "Muify Test A", accentColor: "#2bb5a7" });
  check("A updates profile (Auth displayName + RTDB profile)", prof.status === 200 && prof.json.displayName === "Muify Test A", prof.json);
  await sleep(4000); // debounced RTDB write

  const tree = (await fb.db.get(`users/${encodeKey(uidA)}`)) as any;
  check("RTDB users/{uidA} has likes/playlists/history/player/profile/meta", Boolean(tree?.likes?.tracks?.[encodeKey(trackId)] && tree.playlists && tree.history && tree.player && tree.profile), tree && Object.keys(tree));
  check("RTDB profile has accent colour", tree?.profile?.accentColor === "#2bb5a7", tree?.profile);
  const authA = await fb.getUser(uidA);
  check("Auth displayName updated by the server", authA.displayName === "Muify Test A", authA.displayName);

  // ---- isolation ----
  const bLiked = await call("GET", "/api/tracks?liked=true", B);
  check("B sees none of A's likes", bLiked.status === 200 && bLiked.json.length === 0, bLiked.json);
  const bPl = await call("GET", `/api/playlists/${pl.json.id}`, B);
  check("B can't read A's playlist", bPl.status === 404, bPl.status);
  const bLast = await call("GET", "/api/player/last", B);
  check("B doesn't get A's player state", bLast.json.saved === false);
  const aLast = await call("GET", "/api/player/last", A);
  check("A gets own player state", aLast.json.saved === true && aLast.json.volume === 0.4, aLast.json?.volume);
  const exp = await call("GET", "/api/me/export", A);
  check("export works", exp.status === 200 && exp.json.likedTracks.length === 1, exp.status);

  // ---- delete account A through the API (fresh sign-in → allowed) ----
  const del = await call("DELETE", "/api/me", A);
  check("DELETE /api/me → 204", del.status === 204, del);
  await sleep(1500);
  const after = await fb.db.get(`users/${encodeKey(uidA)}`);
  check("users/{uidA} deleted from RTDB", after === null, after);
  let authGone = false;
  try {
    await fb.getUser(uidA);
  } catch (e) {
    authGone = String((e as { code?: string }).code).includes("user-not-found");
  }
  check("Auth user A deleted", authGone);
  if (authGone) created.splice(created.indexOf(uidA), 1);
  const afterTok = await call("GET", "/api/history", A);
  check("A's token rejected after deletion", afterTok.status === 401, afterTok);
  const relogin = await identity("signInWithPassword", { email: emailA, password, returnSecureToken: true });
  check("A can no longer sign in", relogin.status === 400, relogin.json?.error?.message);

  // ---- revoke sessions for B ----
  const rev = await call("POST", "/api/me/revoke-sessions", B);
  check("revoke-sessions → 204", rev.status === 204, rev);
  await sleep(1500);
  const revoked = await call("GET", "/api/history", B);
  check("B's token rejected after revoke", revoked.status === 401 && revoked.json.code === "token-revoked", revoked.json);
} catch (e) {
  failures++;
  console.error("ERROR", (e as Error).message);
} finally {
  // Cleanup: every test user + data.
  for (const uid of created) {
    await fb.db.remove(`users/${encodeKey(uid)}`).catch(() => {});
    await fb.deleteUser(uid).catch(() => {});
  }
  const leftovers = await Promise.all(created.map((uid) => fb.db.get(`users/${encodeKey(uid)}`)));
  console.log(`cleanup: removed ${created.length} remaining test user(s); leftover data nodes: ${leftovers.filter((x) => x !== null).length}`);
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}
