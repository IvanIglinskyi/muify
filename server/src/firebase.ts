// Firebase Admin layer: token verification, Auth user management and Realtime Database access.
//
// Firebase mode is ON when FIREBASE_DATABASE_URL is set and either a service-account JSON is found
// (FIREBASE_SERVICE_ACCOUNT_PATH, default server/firebase-service-account.json) or the emulators
// are configured (FIREBASE_AUTH_EMULATOR_HOST + FIREBASE_DATABASE_EMULATOR_HOST). Otherwise the
// server runs in "local" mode: one implicit user, state in a JSON file (see userStore.ts).
//
// Everything Firebase-specific sits behind the small `FirebaseServices` interface, so tests can
// swap in an in-memory fake (setFirebaseServicesForTesting) without touching the routes.
// The service-account credentials never leave this module — nothing here is sent to clients.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface VerifiedUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  /** Seconds since epoch of the last real sign-in (re-auth refreshes it). */
  authTime: number;
  /** Provider of this session: "password", "google.com", … */
  signInProvider: string | null;
  /** Token expiry, seconds since epoch. */
  expiresAt: number;
}

export interface AuthUserRecord {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoURL: string | null;
  providers: string[];
  createdAt: string | null;
  lastSignInAt: string | null;
}

/** Minimal Realtime Database surface the user store needs. Paths are "/"-separated, pre-encoded. */
export interface RtdbAdapter {
  get(path: string): Promise<unknown>;
  /** Multi-path update relative to `path` (keys may contain "/"; null deletes). */
  update(path: string, patch: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface FirebaseServices {
  projectId: string;
  emulator: boolean;
  /** Verifies signature, expiry and revocation. Rejects with an error carrying `code`. */
  verifyIdToken(token: string): Promise<VerifiedUser>;
  revokeRefreshTokens(uid: string): Promise<void>;
  getUser(uid: string): Promise<AuthUserRecord>;
  updateUser(uid: string, props: { displayName?: string | null }): Promise<void>;
  deleteUser(uid: string): Promise<void>;
  db: RtdbAdapter;
}

export type AuthMode = "firebase" | "local";

export interface FirebaseConfigInfo {
  mode: AuthMode;
  emulator: boolean;
  projectId: string | null;
  /** Why Firebase mode is off (missing config…), or null. Never contains secrets. */
  reason: string | null;
}

interface ServiceAccountJson {
  project_id: string;
  client_email: string;
  private_key: string;
}

const serverDir = fileURLToPath(new URL("../", import.meta.url));

function resolveServiceAccountPath(raw: string | undefined): { path: string; tried: string[] } {
  const value = raw?.trim() || "firebase-service-account.json";
  if (path.isAbsolute(value)) return { path: value, tried: [value] };
  // Relative paths: try the server dir first (default), then the working dir, then the repo root.
  const tried = [
    path.resolve(serverDir, value),
    path.resolve(process.cwd(), value),
    path.resolve(serverDir, "..", value),
  ];
  return { path: tried.find((p) => existsSync(p)) ?? tried[0], tried };
}

function readServiceAccount(file: string): ServiceAccountJson {
  return parseServiceAccount(JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>);
}

function parseServiceAccount(raw: Record<string, unknown>): ServiceAccountJson {
  if (
    typeof raw.project_id !== "string" ||
    typeof raw.client_email !== "string" ||
    typeof raw.private_key !== "string"
  ) {
    throw new Error("not a service-account key (project_id / client_email / private_key missing)");
  }
  return raw as unknown as ServiceAccountJson;
}

interface ResolvedConfig {
  info: FirebaseConfigInfo;
  databaseURL?: string;
  serviceAccount?: ServiceAccountJson;
}

let resolved: ResolvedConfig | null = null;

function resolveConfig(): ResolvedConfig {
  if (resolved) return resolved;
  const databaseURL = process.env.FIREBASE_DATABASE_URL?.trim();
  const emulator = Boolean(
    process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim() && process.env.FIREBASE_DATABASE_EMULATOR_HOST?.trim()
  );
  const local = (reason: string): ResolvedConfig => ({ info: { mode: "local", emulator: false, projectId: null, reason } });

  if (!databaseURL) {
    resolved = local("FIREBASE_DATABASE_URL is not set");
    return resolved;
  }
  if (emulator) {
    const projectId =
      process.env.FIREBASE_PROJECT_ID?.trim() || process.env.GCLOUD_PROJECT?.trim() || "demo-muify";
    resolved = { info: { mode: "firebase", emulator: true, projectId, reason: null }, databaseURL };
    return resolved;
  }
  // Containers / PaaS: the key can come from an env variable (raw JSON or base64) instead of a file.
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    try {
      const text = inline.startsWith("{") ? inline : Buffer.from(inline, "base64").toString("utf8");
      const sa = parseServiceAccount(JSON.parse(text) as Record<string, unknown>);
      resolved = { info: { mode: "firebase", emulator: false, projectId: sa.project_id, reason: null }, databaseURL, serviceAccount: sa };
    } catch (e) {
      // Never echo the value itself.
      resolved = local(`FIREBASE_SERVICE_ACCOUNT_JSON is not a valid service-account key (${(e as Error).name})`);
    }
    return resolved;
  }
  const { path: saPath, tried } = resolveServiceAccountPath(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  if (!existsSync(saPath)) {
    resolved = local(`service-account file not found (looked at: ${tried.join(", ")})`);
    return resolved;
  }
  try {
    const sa = readServiceAccount(saPath);
    resolved = {
      info: { mode: "firebase", emulator: false, projectId: sa.project_id, reason: null },
      databaseURL,
      serviceAccount: sa,
    };
  } catch (e) {
    resolved = local(`could not read the service-account file ${saPath}: ${(e as Error).message}`);
  }
  return resolved;
}

let testServices: FirebaseServices | null | undefined;

export function firebaseConfigInfo(): FirebaseConfigInfo {
  if (testServices) return { mode: "firebase", emulator: testServices.emulator, projectId: testServices.projectId, reason: null };
  if (testServices === null) return { mode: "local", emulator: false, projectId: null, reason: "disabled for tests" };
  return resolveConfig().info;
}

export const authMode = (): AuthMode => firebaseConfigInfo().mode;

/** Test hook: an in-memory fake (or null = force local mode). Call before the first request. */
export function setFirebaseServicesForTesting(s: FirebaseServices | null): void {
  testServices = s;
  servicesPromise = null;
}

let servicesPromise: Promise<FirebaseServices> | null = null;

/** Firebase services (initialised on first use). Only call when authMode() === "firebase". */
export function firebase(): Promise<FirebaseServices> {
  if (testServices) return Promise.resolve(testServices);
  servicesPromise ??= initAdmin().catch((e) => {
    servicesPromise = null; // allow a retry on the next request
    throw e;
  });
  return servicesPromise;
}

const iso = (s: string | undefined) => (s ? new Date(s).toISOString() : null);

async function initAdmin(): Promise<FirebaseServices> {
  const cfg = resolveConfig();
  if (cfg.info.mode !== "firebase" || !cfg.databaseURL) throw new Error("Firebase is not configured");
  // Loaded lazily: local mode never pays for firebase-admin.
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getDatabase } = await import("firebase-admin/database");

  const app =
    getApps().find((a) => a.name === "muify") ??
    initializeApp(
      cfg.serviceAccount
        ? {
            credential: cert({
              projectId: cfg.serviceAccount.project_id,
              clientEmail: cfg.serviceAccount.client_email,
              privateKey: cfg.serviceAccount.private_key,
            }),
            databaseURL: cfg.databaseURL,
            projectId: cfg.serviceAccount.project_id,
          }
        : { projectId: cfg.info.projectId!, databaseURL: cfg.databaseURL },
      "muify"
    );
  const auth = getAuth(app);
  const database = getDatabase(app);

  return {
    projectId: cfg.info.projectId!,
    emulator: cfg.info.emulator,
    async verifyIdToken(token) {
      const d = await auth.verifyIdToken(token, true);
      return {
        uid: d.uid,
        email: d.email ?? null,
        emailVerified: d.email_verified === true,
        name: typeof d.name === "string" ? d.name : null,
        picture: d.picture ?? null,
        authTime: d.auth_time,
        signInProvider: d.firebase?.sign_in_provider ?? null,
        expiresAt: d.exp,
      };
    },
    revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
    async getUser(uid) {
      const u = await auth.getUser(uid);
      return {
        uid: u.uid,
        email: u.email ?? null,
        emailVerified: u.emailVerified,
        displayName: u.displayName ?? null,
        photoURL: u.photoURL ?? null,
        providers: u.providerData.map((p) => p.providerId),
        createdAt: iso(u.metadata.creationTime),
        lastSignInAt: iso(u.metadata.lastSignInTime),
      };
    },
    async updateUser(uid, props) {
      await auth.updateUser(uid, props);
    },
    deleteUser: (uid) => auth.deleteUser(uid),
    db: {
      async get(p) {
        return (await database.ref(p).get()).val();
      },
      async update(p, patch) {
        await database.ref(p).update(patch);
      },
      async remove(p) {
        await database.ref(p).remove();
      },
    },
  };
}
