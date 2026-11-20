// In-memory fake of the Firebase layer (no network, no emulator). The fake Realtime Database
// enforces the real constraints that matter here: forbidden key characters, no `undefined`
// values, no overlapping paths in one update(). Tokens are "fake.<base64url JSON>".
import type { FirebaseServices, VerifiedUser } from "../src/firebase.js";

type Tree = Record<string, unknown>;
export const FORBIDDEN_KEY = /[.$#[\]/\x00-\x1f\x7f]/;

export interface FakeFirebase {
  services: FirebaseServices;
  root: Tree;
  writes: { path: string; keys: string[]; bytes: number }[];
  authUsers: Map<string, { email: string; displayName: string | null; revokedAt: number }>;
  /** Token for `uid` (creates the Auth user on first use). */
  token(uid: string, email?: string, opts?: { authTimeAgoS?: number; iatAgoS?: number }): string;
  getAt(path: string): unknown;
}

function checkValue(v: unknown, where: string) {
  if (v === undefined) throw new Error(`undefined value at ${where}`);
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Tree)) {
      if (FORBIDDEN_KEY.test(k) || k === "") throw new Error(`invalid key "${k}" at ${where}`);
      checkValue(x, `${where}/${k}`);
    }
  }
}

function segs(p: string) {
  const s = p.split("/").filter(Boolean);
  for (const k of s) if (FORBIDDEN_KEY.test(k)) throw new Error(`invalid path segment "${k}"`);
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

export function createFakeFirebase(): FakeFirebase {
  const root: Tree = {};
  const writes: FakeFirebase["writes"] = [];
  const authUsers: FakeFirebase["authUsers"] = new Map();

  const setAt = (path: string[], value: unknown) => {
    let node: Tree = root;
    for (let i = 0; i < path.length - 1; i++) {
      const next = node[path[i]];
      if (!next || typeof next !== "object") node[path[i]] = {};
      node = node[path[i]] as Tree;
    }
    const last = path[path.length - 1];
    if (value === null) delete node[last];
    else node[last] = JSON.parse(JSON.stringify(value));
  };

  const getAt = (p: string): unknown => {
    let node: unknown = root;
    for (const s of segs(p)) {
      if (!node || typeof node !== "object") return null;
      node = (node as Tree)[s];
    }
    if (node === undefined) return null;
    const pruned = prune(node);
    if (pruned && typeof pruned === "object" && Object.keys(pruned as Tree).length === 0) return null;
    return JSON.parse(JSON.stringify(pruned ?? null));
  };

  const services: FirebaseServices = {
    projectId: "fake-project",
    emulator: true,
    async verifyIdToken(token) {
      if (!token.startsWith("fake.")) throw Object.assign(new Error("bad token"), { code: "auth/argument-error" });
      let b: { uid: string; email: string; authTime: number; iat: number };
      try {
        b = JSON.parse(Buffer.from(token.slice(5), "base64url").toString());
      } catch {
        throw Object.assign(new Error("bad token"), { code: "auth/argument-error" });
      }
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
        return getAt(p);
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

  return {
    services,
    root,
    writes,
    authUsers,
    getAt,
    token(uid, email = `${uid}@example.com`, opts = {}) {
      if (!authUsers.has(uid)) authUsers.set(uid, { email, displayName: null, revokedAt: 0 });
      const now = Math.floor(Date.now() / 1000);
      const body = { uid, email, authTime: now - (opts.authTimeAgoS ?? 0), iat: now - (opts.iatAgoS ?? 0), nonce: Math.random() };
      return `fake.${Buffer.from(JSON.stringify(body)).toString("base64url")}`;
    },
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
