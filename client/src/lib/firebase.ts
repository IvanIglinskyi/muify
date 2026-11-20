// Firebase JS SDK — used for Authentication ONLY. The browser never talks to Realtime Database:
// all user data goes through our API, which verifies the ID token (see server/src/auth.ts).
import { initializeApp } from "firebase/app";
import { browserLocalPersistence, connectAuthEmulator, initializeAuth, browserPopupRedirectResolver, type Auth } from "firebase/auth";

const env = import.meta.env;

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

/** True when client/.env.local has the minimum Firebase web config. */
export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

export const usingAuthEmulator = env.VITE_USE_FIREBASE_EMULATORS === "true";

function createAuth(): Auth | null {
  if (!firebaseConfigured) return null;
  const app = initializeApp(config);
  const auth = initializeAuth(app, {
    persistence: browserLocalPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  auth.useDeviceLanguage();
  if (usingAuthEmulator) {
    connectAuthEmulator(auth, env.VITE_FIREBASE_AUTH_EMULATOR_URL || "http://127.0.0.1:9099", { disableWarnings: true });
  }
  return auth;
}

/** null when the client has no Firebase config (local mode / misconfiguration). */
export const firebaseAuth: Auth | null = createAuth();
