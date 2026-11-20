import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Optional override (e.g. MUIFY_API_TARGET=http://localhost:4100) — defaults to the dev API on :4000.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const apiTarget = env.MUIFY_API_TARGET || "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Запити /api/* перенаправляються на Express-сервер
    proxy: {
      "/api": apiTarget,
    },
  },
});
