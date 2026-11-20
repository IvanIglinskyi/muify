// Integration test of Firebase mode against an in-memory fake of the Firebase layer (no network,
// no emulator). The fake Realtime Database enforces the real constraints that matter here:
// forbidden key characters, no `undefined` values, no overlapping paths in one update().
//
// Run: cd server && npx tsx scripts/auth-smoke.ts
import type { AddressInfo } from "node:net";
import { setFirebaseServicesForTesting, type FirebaseServices, type VerifiedUser } from "../src/firebase.js";
import { decodeKey, encodeKey, resetUserStoreForTesting, userStore } from "../src/userStore.js";

// ---------------------------------------------------------------------------
// Fake Firebase
// ---------------------------------------------------------------------------
type Tree = Record<string, unknown>;
const root: Tree = {};
const writes: { path: string; keys: string[]; bytes: number }[] = [];
const FORBIDDEN = /[.$#[\]/\x00-\x1f\x7f]/;

function checkValue(v: unknown, where: string) {
  if (v === undefined) throw new Error(`undefined value at ${where}`);
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Tree)) {
      if (FORBIDDEN.test(k) || k === "") throw new Error(`invalid key "${k}" at ${where}`);
      checkValue(x, `${where}/${k}`);
    }
  }
}

function segs(p: string) {
  const s = p.split("/").filter(Boolean);
  for (const k of s) if (FORBIDDEN.test(k)) throw new Error(`invalid path segment "${k}"`);
  return s;
}

function prune(node: unknown): unknown {
  if (Array.isArray(node)) node = Object.fromEntries(node.map((v, i) => [String(i), v]));
  if (!node || typeof node !== "object") return node;
  const out: Tree = {};
  for (const [k, v] of Object.entries(node as Tree)) {
    const pv = prune(v);
    if (pv !== null && pv !== undefined && !(typeof pv === "object" && Object.keys(pv as Tree).length === 0)) out[k] = pv;
  }
  return out;
}

function setAt(path: string[], value: unknown) {
  let node: Tree = root;
  for (let i = 0; i < path.length - 1; i++) {
    const next = node[path[i]];
    if (!next || typeof next !== "object") node[path[i]] = {};
    node = node[path[i]] as Tree;
  }
  const last = path[path.length - 1];
  if (value === null) delete node[last];
  else node[last] = JSON.parse(JSON.stringify(value));
}

function getAt(path: string[]): unknown {
  let node: unknown = root;
  for (const s of path) {
    if (!node || typeof node !== "object") return null;
    node = (node as Tree)[s];
  }
  return node === undefined ? null : JSON.parse(JSON.stringify(prune(node) ?? null));
}

const authUsers = new Map<string, { email: string; displayName: string | null; revokedAt: number }>();

function makeToken(uid: string, email: string, authTimeAgoS = 0, iatAgoS = 0): string {
  if (!authUsers.has(uid)) authUsers.set(uid, { email, displayName: null, revokedAt: 0 });
  const now = Math.floor(Date.now() / 1000);
  const body = { uid, email, authTime: now - authTimeAgoS, iat: now - iatAgoS, nonce: Math.random() };
  return `fake.${Buffer.from(JSON.stringify(body)).toString("base64url")}`;
}

const fake: FirebaseServices = {
  projectId: "fake-project",
  emulator: true,
  async verifyIdToken(token) {
    if (!token.startsWith("fake.")) throw Object.assign(new Error("bad token"), { code: "auth/argument-error" });
    const b = JSON.parse(Buffer.from(token.slice(5), "base64url").toString()) as { uid: string; email: string; authTime: number; iat: number };
    const u = authUsers.get(b.uid);
    if (!u) throw Object.assign(new Error("no user"), { code: "auth/user-not-found" });
    if (b.iat * 1000 < u.revokedAt) throw Object.assign(new Error("revoked"), { code: "auth/id-token-revoked" });
    const v: VerifiedUser = {
      uid: b.uid,
      email: b.email,
      emailVerified: false,
      name: u.displayName,
      picture: null,
      authTime: b.authTime,
      signInProvider: "password",
      expiresAt: b.iat + 3600,
    };
    return v;
  },
  async revokeRefreshTokens(uid) {
    const u = authUsers.get(uid);
    if (u) u.revokedAt = Date.now() + 1000; // tokens issued before "now" (second precision) are revoked
  },
  async getUser(uid) {
    const u = authUsers.get(uid);
    if (!u) throw Object.assign(new Error("no user"), { code: "auth/user-not-found" });
    return { uid, email: u.email, emailVerified: false, displayName: u.displayName, photoURL: null, providers: ["password"], createdAt: null, lastSignInAt: null };
  },
  async updateUser(uid, props) {
    const u = authUsers.get(uid);
    if (u && props.displayName !== undefined) u.displayName = props.displayName;
  },
  async deleteUser(uid) {
    authUsers.delete(uid);
  },
  db: {
    async get(p) {
      return getAt(segs(p));
    },
    async update(p, patch) {
      const keys = Object.keys(patch);
      for (const a of keys) for (const b of keys) if (a !== b && b.startsWith(`${a}/`)) throw new Error(`overlapping paths ${a} / ${b}`);
      for (const [k, v] of Object.entries(patch)) {
        checkValue(v, `${p}/${k}`);
        segs(k);
      }
      for (const [k, v] of Object.entries(patch)) setAt([...segs(p), ...segs(k)], v);
      writes.push({ path: p, keys, bytes: JSON.stringify(patch).length });
    },
    async remove(p) {
      setAt(segs(p), null);
    },
  },
};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

setFirebaseServicesForTesting(fake);
resetUserStoreForTesting();
const { app } = await import("../src/app.js");
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json: json as any };
}

try {
  // ---- key encoding ----
  const weird = ["a.b", "$x", "#1", "[a]", "a/b", "100%", "j123", "u-1a2b"];
  check("encodeKey output has no forbidden chars and round-trips", weird.every((k) => !FORBIDDEN.test(encodeKey(k)) && decodeKey(encodeKey(k)) === k));

  // ---- status ----
  const st = await call("GET", "/api/status");
  check("/api/status reports firebase mode", st.json?.auth?.mode === "firebase", st.json);

  // ---- guests ----
  const guestPublic = await Promise.all(
    ["/api/albums/day", "/api/albums/week", "/api/playlists", "/api/tracks/recent", "/api/tracks/daily-mix", "/api/stats", "/api/player/last", "/api/genres", "/api/tracks?liked=true"].map((p) => call("GET", p))
  );
  check("guest: public catalogue endpoints answer 200", guestPublic.every((r) => r.status === 200), guestPublic.map((r) => r.status));
  check("guest: no likes anywhere", JSON.stringify(guestPublic.map((r) => r.json)).includes('"liked":true') === false);
  check("guest: liked tracks list is empty", Array.isArray(guestPublic[8].json) && guestPublic[8].json.length === 0);
  const guestWrites = await Promise.all([
    call("PATCH", "/api/tracks/t1/like", undefined, { liked: true }),
    call("PATCH", "/api/albums/a1/like", undefined, { liked: true }),
    call("POST", "/api/playlists", undefined, { name: "x" }),
    call("POST", "/api/history", undefined, { trackId: "t1", seconds: 12 }),
    call("POST", "/api/player/state", undefined, { trackId: "t1", position: 3 }),
    call("GET", "/api/history"),
    call("GET", "/api/stats/listening"),
    call("GET", "/api/me"),
    call("DELETE", "/api/history"),
  ]);
  check("guest: user-state endpoints answer 401 auth-required", guestWrites.every((r) => r.status === 401 && r.json?.code === "auth-required"), guestWrites.map((r) => r.status));
  const bad = await call("GET", "/api/history", "fake.not-json");
  check("invalid token → 401 token-invalid", bad.status === 401 && bad.json?.code === "token-invalid", bad);
  const garbage = await call("GET", "/api/history", "zzz");
  check("non-fake token → 401", garbage.status === 401, garbage);

  // ---- user A ----
  const A = makeToken("uidA", "a@example.com");
  const B = makeToken("uidB", "b@example.com");
  const likeA = await call("PATCH", "/api/tracks/t3/like", A, { liked: true });
  check("A likes t3 → 200 liked", likeA.status === 200 && likeA.json?.liked === true, likeA);
  const albA = await call("PATCH", "/api/albums/a1/like", A, { liked: true });
  check("A likes album a1 → 200", albA.status === 200 || albA.status === 404, albA.status);
  const pl = await call("POST", "/api/playlists", A, { name: "A's mix", trackIds: ["t1", "t2"] });
  check("A creates playlist → 201", pl.status === 201, pl);
  const add = await call("POST", `/api/playlists/${pl.json.id}/tracks`, A, { trackId: "t5" });
  check("A adds track to playlist", add.status === 200 && add.json.trackIds.includes("t5"), add);
  const h1 = await call("POST", "/api/history", A, { trackId: "t3", seconds: 12 });
  check("A reports a play → 201", h1.status === 201, h1);
  await sleep(700); // let the debounced write land
  writes.length = 0;
  const h2 = await call("POST", "/api/history", A, { trackId: "t3", seconds: 40, entryId: h1.json.id });
  check("A updates the play → 200", h2.status === 200 && h2.json.seconds === 40, h2);
  const ps = await call("POST", "/api/player/state", A, { trackId: "t3", position: 30, queue: ["t3", "t4"], volume: 0.5 });
  check("A saves player state → 204", ps.status === 204, ps);
  await sleep(700);
  check("history ping + player save = ONE small multi-path update", writes.length === 1 && writes[0].bytes < 600, writes);
  check("…touching only history/<id>/s and player", writes[0]?.keys.every((k) => k === `history/${h1.json.id}/s` || k.startsWith("player")), writes[0]?.keys);
  writes.length = 0;
  await call("POST", "/api/player/state", A, { trackId: "t3", position: 45, queue: ["t3", "t4"], volume: 0.5 });
  await sleep(700);
  check("position ping with the same queue does not rewrite the queue", writes.length === 1 && !writes[0].keys.includes("player"), writes);

  const treeA = getAt(["users", "uidA"]) as any;
  check("RTDB users/uidA has likes/playlists/history/player/profile", Boolean(treeA?.likes?.tracks?.t3 && treeA?.playlists && treeA?.history && treeA?.player && treeA?.profile), treeA && Object.keys(treeA));
  check("profile email synced from token", treeA?.profile?.email === "a@example.com", treeA?.profile);

  // ---- isolation ----
  const bLiked = await call("GET", "/api/tracks?liked=true", B);
  check("B sees none of A's likes", bLiked.status === 200 && bLiked.json.length === 0, bLiked.json);
  const bPl = await call("GET", "/api/playlists", B);
  check("B does not see A's playlist", !bPl.json.some((p: any) => p.id === pl.json.id), bPl.json.map((p: any) => p.id));
  const bPlGet = await call("GET", `/api/playlists/${pl.json.id}`, B);
  check("B gets 404 for A's playlist id", bPlGet.status === 404, bPlGet.status);
  const bDel = await call("DELETE", `/api/playlists/${pl.json.id}`, B);
  check("B cannot delete A's playlist (404)", bDel.status === 404, bDel.status);
  const bHist = await call("GET", "/api/history", B);
  check("B history is empty", bHist.json.length === 0, bHist.json);
  const bUpd = await call("POST", "/api/history", B, { trackId: "t3", seconds: 99, entryId: h1.json.id });
  check("B cannot update A's history entry (creates own instead)", bUpd.status === 201 && bUpd.json.id !== h1.json.id, bUpd);
  const bLast = await call("GET", "/api/player/last", B);
  check("B does not get A's player state", bLast.json.saved === false, bLast.json);
  const aLast = await call("GET", "/api/player/last", A);
  check("A gets own player state back", aLast.json.saved === true && aLast.json.position === 45 && aLast.json.volume === 0.5, aLast.json);
  const aDay = await call("GET", "/api/tracks/recent", A);
  check("A's recent plays come from A's history", aDay.json[0]?.id === "t3", aDay.json.map((t: any) => t.id));
  const statsA = await call("GET", "/api/stats", A);
  const statsG = await call("GET", "/api/stats");
  check("Likes stat differs per user", statsA.json.likes > statsG.json.likes, [statsA.json, statsG.json]);

  // ---- profile ----
  const me = await call("PATCH", "/api/me", A, { displayName: "  Alice   A ", accentColor: "#9B6BFF", usePhoto: false });
  check("PATCH /api/me normalises name + colour", me.status === 200 && me.json.displayName === "Alice A" && me.json.accentColor === "#9b6bff", me.json);
  const badMe = await call("PATCH", "/api/me", A, { accentColor: "red" });
  check("PATCH /api/me rejects bad colour", badMe.status === 400, badMe);

  // ---- export ----
  const exp = await call("GET", "/api/me/export", A);
  check("export contains A's data", exp.status === 200 && exp.json.likedTracks.some((l: any) => l.id === "t3") && exp.json.playlists.length === 1, exp.json && Object.keys(exp.json));

  // ---- delete: needs a recent sign-in ----
  const staleA = makeToken("uidA", "a@example.com", 3600);
  const delStale = await call("DELETE", "/api/me", staleA);
  check("DELETE /api/me with an old sign-in → 403 requires-recent-login", delStale.status === 403 && delStale.json.code === "requires-recent-login", delStale);
  // A write right before deletion must not resurrect data after it.
  await call("PATCH", "/api/tracks/t4/like", A, { liked: true });
  const del = await call("DELETE", "/api/me", A);
  check("DELETE /api/me → 204", del.status === 204, del);
  await sleep(800);
  check("users/uidA removed from RTDB", getAt(["users", "uidA"]) === null, getAt(["users", "uidA"]));
  check("Auth user A removed", !authUsers.has("uidA"));
  const afterDel = await call("GET", "/api/history", A);
  check("A's old token is rejected after deletion", afterDel.status === 401, afterDel);
  check("B's data untouched", getAt(["users", "uidB", "history"]) !== null);

  // ---- revoke sessions ----
  const B2 = makeToken("uidB", "b@example.com");
  const okB = await call("GET", "/api/history", B2);
  check("B token works before revoke", okB.status === 200);
  const rev = await call("POST", "/api/me/revoke-sessions", B2);
  check("revoke-sessions → 204", rev.status === 204, rev);
  const afterRev = await call("GET", "/api/history", B2);
  check("B's token is rejected after revoke (token-revoked)", afterRev.status === 401 && afterRev.json.code === "token-revoked", afterRev);

  // ---- store backend ----
  check("store backend is firebase", userStore().kind === "firebase");
} catch (e) {
  failures++;
  console.error("ERROR", e);
} finally {
  server.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}
