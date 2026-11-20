// Production: Express serves the built client (client/dist) next to the API, so `npm start` runs
// the whole app on one port. Hashed assets are cached for a year; index.html, the service worker
// and the manifest are always revalidated; unknown non-API paths get index.html (SPA routing).
import express, { type Request, type Response, type Router } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** client/dist, resolved from this file (works from server/src and server/dist), or MUIFY_CLIENT_DIR. */
export function clientDistDir(): string {
  const custom = process.env.MUIFY_CLIENT_DIR?.trim();
  if (custom) return path.resolve(custom);
  return fileURLToPath(new URL("../../client/dist/", import.meta.url));
}

/** Serve the client when NODE_ENV=production (or SERVE_CLIENT=true) and the build exists. */
export function shouldServeClient(dir = clientDistDir()): boolean {
  const wanted = process.env.NODE_ENV === "production" || process.env.SERVE_CLIENT === "true";
  return wanted && existsSync(path.join(dir, "index.html"));
}

const NO_CACHE = "no-cache";
const YEAR = 365 * 24 * 3600;

export function clientRouter(dir: string): Router {
  const router = express.Router();
  const index = path.join(dir, "index.html");

  // Vite's content-hashed bundles: immutable. A missing hashed file is a real 404, never index.html.
  router.use(
    "/assets",
    express.static(path.join(dir, "assets"), {
      index: false,
      fallthrough: true,
      setHeaders: (res) => res.setHeader("Cache-Control", `public, max-age=${YEAR}, immutable`),
    }),
    (_req: Request, res: Response) => {
      res.status(404).type("text/plain").send("Not found");
    }
  );

  // Other top-level files (icons, manifest, sw.js, robots…): short cache, always revalidated for the
  // service worker and manifest so updates reach installed apps.
  router.use(
    express.static(dir, {
      index: false,
      setHeaders: (res, file) => {
        const name = path.basename(file);
        if (name === "sw.js" || name === "index.html" || name.endsWith(".webmanifest")) res.setHeader("Cache-Control", NO_CACHE);
        else res.setHeader("Cache-Control", "public, max-age=86400");
        if (name === "sw.js") res.setHeader("Service-Worker-Allowed", "/");
      },
    })
  );

  // SPA fallback for client-side routes (/explore, /album/…, /p/…). The API keeps its JSON 404s.
  router.get(/^(?!\/api(?:\/|$)).*/, (req: Request, res: Response, next) => {
    if (path.extname(req.path) && !req.path.endsWith(".html")) return next(); // a missing file, not a route
    res.setHeader("Cache-Control", NO_CACHE);
    res.sendFile(index, (err) => err && next(err));
  });

  return router;
}
