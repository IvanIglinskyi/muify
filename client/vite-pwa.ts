// Tiny build-time PWA helper (no extra dependency): after `vite build` it writes dist/sw.js — a
// service worker that precaches the app shell (index.html, the hashed JS/CSS bundles, manifest,
// icons) under a cache name derived from the build, and NEVER caches /api (data, audio streams).
import type { Plugin } from "vite";

/** FNV-1a (hex) — enough to give every distinct build its own cache name. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const SHELL_FILES = ["/", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

export function serviceWorker(): Plugin {
  return {
    name: "muify-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((f) => /^assets\/.+\.(js|css|woff2?|svg|png)$/.test(f))
        .map((f) => `/${f}`)
        .sort();
      const precache = [...SHELL_FILES, ...assets];
      // Bundle file names carry content hashes, so the list changes whenever the code does.
      const version = hash(precache.join("\n"));
      this.emitFile({ type: "asset", fileName: "sw.js", source: swSource(version, precache) });
    },
  };
}

function swSource(version: string, precache: string[]): string {
  return `// MuiFy service worker — generated at build time (client/vite-pwa.ts). Do not edit.
const CACHE = "muify-shell-${version}";
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("muify-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only our own origin; never the API (JSON, audio streams) — those always go to the network.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (req.headers.has("range")) return;

  // Page loads: network first (fresh deploys), the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error()))
    );
    return;
  }

  // Hashed bundles never change: cache first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Other shell files (icons, manifest): cached copy, refreshed in the background.
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || refresh;
      })
    );
  }
});
`;
}
