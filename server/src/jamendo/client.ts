// Minimal Jamendo API v3.0 client with an in-memory response cache.
// The client id is read from process.env on every call and only ever sent to Jamendo.
import type { JamendoResponse } from "./types.js";

const DEFAULT_BASE = "https://api.jamendo.com/v3.0";
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;
const MAX_CACHE_ENTRIES = 500;

export type JamendoPath = "tracks" | "albums" | "albums/tracks";
export type JamendoParams = Record<string, string | number | undefined | null>;

export class JamendoError extends Error {
  override name = "JamendoError";
}

export function jamendoClientId(): string | null {
  return process.env.JAMENDO_CLIENT_ID?.trim() || null;
}

function apiBase(): string {
  return (process.env.JAMENDO_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

interface CacheEntry {
  expires: number;
  value: Promise<unknown[]>;
}

const cache = new Map<string, CacheEntry>();

function prune(now: number) {
  for (const [k, e] of cache) if (e.expires <= now) cache.delete(k);
  // Still too big: drop the oldest entries (Map keeps insertion order).
  for (const k of cache.keys()) {
    if (cache.size <= MAX_CACHE_ENTRIES) break;
    cache.delete(k);
  }
}

/**
 * GET {base}/{path}/?client_id=…&format=json&… → `results`.
 * Jamendo reports errors with HTTP 200 and headers.status = "failed", so both are checked.
 * Concurrent identical requests share one in-flight promise; failures are not cached.
 */
export function jamendoGet<T>(path: JamendoPath, params: JamendoParams): Promise<T[]> {
  const clientId = jamendoClientId();
  if (!clientId) return Promise.reject(new JamendoError("JAMENDO_CLIENT_ID is not set"));

  const sp = new URLSearchParams({ format: "json" });
  for (const [k, v] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const key = `${path}?${sp}`; // cache key never includes the client id

  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T[]>;

  sp.set("client_id", clientId);
  const url = `${apiBase()}/${path}/?${sp}`;

  const value = (async () => {
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      const err = e as Error;
      throw new JamendoError(err.name === "TimeoutError" ? `request timed out after ${TIMEOUT_MS} ms` : `network error (${err.message})`);
    }
    if (!res.ok) throw new JamendoError(`HTTP ${res.status} from /${path}`);
    let body: JamendoResponse<T>;
    try {
      body = (await res.json()) as JamendoResponse<T>;
    } catch {
      throw new JamendoError(`invalid JSON from /${path}`);
    }
    if (body?.headers?.status !== "success") {
      const h = body?.headers;
      throw new JamendoError(`/${path} failed (code ${h?.code ?? "?"}: ${h?.error_message || "unknown error"})`);
    }
    return Array.isArray(body.results) ? body.results : [];
  })();

  prune(now);
  cache.set(key, { expires: now + CACHE_TTL_MS, value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}
