import { defineConfig } from "vitest/config";

// Run via `npm test` here or at the repo root (scripts/test.mjs fixes the cwd's drive-letter
// case on Windows, which otherwise trips Vitest).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Every test file runs in its own module registry (catalogue/store singletons are per file).
    isolate: true,
    // Never talk to the real Jamendo / Firebase from tests, whatever the shell or .env says
    // (server/.env is only loaded by src/index.ts, which tests don't import).
    env: {
      JAMENDO_CLIENT_ID: "",
      JAMENDO_API_BASE: "",
      FIREBASE_DATABASE_URL: "",
      FIREBASE_AUTH_EMULATOR_HOST: "",
      FIREBASE_DATABASE_EMULATOR_HOST: "",
    },
    testTimeout: 15_000,
  },
});
