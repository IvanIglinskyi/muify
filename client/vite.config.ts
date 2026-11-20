import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { serviceWorker } from "./vite-pwa";

// Optional override (e.g. MUIFY_API_TARGET=http://localhost:4100) — defaults to the dev API on :4000.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const apiTarget = env.MUIFY_API_TARGET || "http://localhost:4000";

export default defineConfig({
  plugins: [react(), serviceWorker()],
  build: {
    rollupOptions: {
      output: {
        // Separate long-lived vendor chunks: app deploys don't invalidate the Firebase / React caches.
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth"],
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Запити /api/* перенаправляються на Express-сервер
    proxy: {
      "/api": apiTarget,
    },
  },
});
