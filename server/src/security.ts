// Basic hardening: security headers (helmet + a CSP that works with Firebase Auth popups and
// redirects, Google Fonts and Jamendo artwork), a small in-memory rate limiter, and the
// `trust proxy` setting. Everything is configurable through env variables (see README → Deploy).
import type { NextFunction, Request, RequestHandler, Response } from "express";
import helmet from "helmet";

const list = (v: string | undefined) =>
  (v ?? "")
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * TRUST_PROXY → Express "trust proxy": unset/"false" = off (default), "true" = trust every hop,
 * a number = that many hops (e.g. "1" behind one reverse proxy), anything else is passed through
 * ("loopback", "10.0.0.0/8, 127.0.0.1", …).
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY): boolean | number | string {
  const v = raw?.trim().toLowerCase() ?? "";
  if (!v || v === "false") return false;
  if (v === "true") return true;
  if (/^\d+$/.test(v)) return Number(v);
  return raw!.trim();
}

/** Content-Security-Policy directives for the built client (the API only returns JSON / audio). */
export function cspDirectives(env: NodeJS.ProcessEnv = process.env): Record<string, string[]> {
  const authDomains = list(env.FIREBASE_AUTH_DOMAIN).map((d) => (d.startsWith("http") ? d : `https://${d}`));
  return {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    // Firebase Auth's popup/redirect helper loads gapi from apis.google.com.
    "script-src": ["'self'", "https://apis.google.com"],
    "script-src-attr": ["'none'"],
    // React sets a few inline style attributes (CSS variables); Google Fonts stylesheet.
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    // Jamendo covers / artist photos, Google profile photos, generated data: URIs.
    "img-src": ["'self'", "data:", "blob:", "https://*.jamendo.com", "https://*.googleusercontent.com", ...list(env.CSP_IMG_SRC)],
    // Audio always streams through our own /api/tracks/:id/stream proxy.
    "media-src": ["'self'", "blob:"],
    // Firebase Auth REST endpoints (sign-in, token refresh, account lookup).
    "connect-src": [
      "'self'",
      "https://identitytoolkit.googleapis.com",
      "https://securetoken.googleapis.com",
      "https://www.googleapis.com",
      "https://apis.google.com",
      ...authDomains,
      ...list(env.CSP_CONNECT_SRC),
    ],
    // Firebase Auth uses a hidden iframe on the auth domain (<project>.firebaseapp.com by default).
    "frame-src": ["'self'", "https://*.firebaseapp.com", "https://*.web.app", "https://accounts.google.com", ...authDomains],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
  };
}

export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        ...cspDirectives(),
        // Only behind HTTPS (CSP_UPGRADE_INSECURE=true): plain-http local runs would break otherwise.
        ...(process.env.CSP_UPGRADE_INSECURE === "true" ? { "upgrade-insecure-requests": [] } : {}),
      },
    },
    // Popups must keep their opener: Firebase signInWithPopup talks to this window.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    // Covers / profile photos come from other origins.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // HSTS only makes sense once the app is served over HTTPS (opt-in).
    strictTransportSecurity: process.env.HSTS === "true" ? { maxAge: 15_552_000, includeSubDomains: false } : false,
  });
}

// ---------------------------------------------------------------------------
// Rate limiting (fixed window, in memory, per client IP — fine for one instance)
// ---------------------------------------------------------------------------
interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Name of the limit (separate counters per name). */
  name: string;
  windowMs: number;
  /** Max requests per window; read lazily so env changes (and tests) take effect. 0 = off. */
  max: () => number;
  /** Which requests count (default: all that reach the middleware). */
  applies?: (req: Request) => boolean;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000;

function sweep(now: number) {
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/** Test hook. */
export function resetRateLimits() {
  buckets.clear();
}

export function rateLimit(o: RateLimitOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const max = o.max();
    if (!max || (o.applies && !o.applies(req))) return next();
    const now = Date.now();
    const key = `${o.name}|${req.ip ?? req.socket.remoteAddress ?? "?"}`;
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      if (buckets.size >= MAX_BUCKETS) sweep(now);
      b = { count: 0, resetAt: now + o.windowMs };
      buckets.set(key, b);
    }
    b.count++;
    const remaining = Math.max(0, max - b.count);
    const resetS = Math.ceil((b.resetAt - now) / 1000);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetS));
    if (b.count > max) {
      res.setHeader("Retry-After", String(resetS));
      res.status(429).json({ error: "Too many requests — please slow down and try again shortly.", code: "rate-limited" });
      return;
    }
    next();
  };
}

const envInt = (name: string, fallback: number) => {
  const v = process.env[name]?.trim();
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** POST/PUT/PATCH/DELETE under /api: RATE_LIMIT_WRITES per minute (default 300). */
export const writeLimiter = rateLimit({
  name: "writes",
  windowMs: 60_000,
  max: () => envInt("RATE_LIMIT_WRITES", 300),
  applies: (req) => MUTATING.has(req.method),
});

/** Account endpoints (delete, sign out everywhere, export): RATE_LIMIT_ACCOUNT per 10 minutes (default 20). */
export const accountLimiter = rateLimit({
  name: "account",
  windowMs: 10 * 60_000,
  max: () => envInt("RATE_LIMIT_ACCOUNT", 20),
  applies: (req) => req.method !== "GET" || req.path.endsWith("/export"),
});

/** Search fans out to Jamendo: RATE_LIMIT_SEARCH per minute (default 60). */
export const searchLimiter = rateLimit({
  name: "search",
  windowMs: 60_000,
  max: () => envInt("RATE_LIMIT_SEARCH", 60),
});
