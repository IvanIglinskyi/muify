// New-release notifications: pure logic (no I/O), so it can be unit-tested.
//
// The catalogue (catalog.ts) looks up releases of the artists a listener follows — lazily, when the
// listener asks for notifications, at most every CHECK_INTERVAL_MS per listener (plus right after a
// new follow) — and these helpers decide which releases become notifications.
import type { AppNotification } from "./types.js";

/** A listener's full new-release lookup runs at most this often. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
/** After a failed lookup, try again this much later (instead of hammering Jamendo). */
export const RETRY_AFTER_FAILURE_MS = 10 * 60_000;
/** How long one artist's release list is shared between listeners. */
export const ARTIST_RELEASES_TTL_MS = 6 * 60 * 60_000;

export const WELCOME_ID = "welcome";

export interface ReleaseCandidate {
  albumId: string;
  albumTitle: string;
  artistId: string;
  artistName: string;
  coverUrl?: string;
  /** YYYY-MM-DD */
  releaseDate: string;
  /** Synthesised from the demo catalogue (no real release dates there). */
  demo?: boolean;
}

export const releaseNotificationId = (albumId: string) => `rel-${albumId}`;

/** UTC calendar day (YYYY-MM-DD) of a timestamp. */
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Whether the listener's releases should be looked up now: never checked, the interval has
 * passed, or an artist was followed after the last check.
 */
export function shouldCheck(checkedAt: number | null, followTimes: number[], now: number, interval = CHECK_INTERVAL_MS): boolean {
  if (followTimes.length === 0) return false;
  if (checkedAt === null) return true;
  if (now - checkedAt >= interval) return true;
  return followTimes.some((at) => at > checkedAt);
}

/**
 * Releases that become notifications: by a followed artist, released on or after the day the
 * listener followed them (demo releases count right away), and not notified before.
 * Oldest release first, so the newest ends up on top of the list.
 */
export function releaseNotifications(
  follows: ReadonlyMap<string, { at: number }>,
  releases: ReleaseCandidate[],
  existingIds: ReadonlySet<string>,
  now: number
): AppNotification[] {
  const seen = new Set<string>();
  const out: AppNotification[] = [];
  const sorted = [...releases].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.albumId.localeCompare(b.albumId));
  sorted.forEach((r, i) => {
    const follow = follows.get(r.artistId);
    if (!follow) return;
    const id = releaseNotificationId(r.albumId);
    if (existingIds.has(id) || seen.has(id)) return;
    if (!r.demo && !(/^\d{4}-\d{2}-\d{2}$/.test(r.releaseDate) && r.releaseDate >= dayOf(follow.at))) return;
    seen.add(id);
    out.push({
      id,
      kind: "release",
      // Keep the order stable when several arrive in one check.
      createdAt: new Date(now + 1 + i).toISOString(),
      read: false,
      albumId: r.albumId,
      albumTitle: r.albumTitle,
      artistId: r.artistId,
      artistName: r.artistName,
      releaseDate: r.releaseDate,
      ...(r.coverUrl ? { coverUrl: r.coverUrl } : {}),
      ...(r.demo ? { demo: true } : {}),
    });
  });
  return out;
}

export function welcomeNotification(now: number): AppNotification {
  return { id: WELCOME_ID, kind: "welcome", createdAt: new Date(now).toISOString(), read: false };
}

/** Newest first, as the API returns them. */
export function newestFirst(list: Iterable<AppNotification>): AppNotification[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
