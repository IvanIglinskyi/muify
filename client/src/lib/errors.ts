// Localised text for failed API calls. Server messages are English developer texts; listeners
// get a message in their language based on the HTTP status / reason code instead.
import { ApiRequestError } from "../api";
import { tt, type MessageKey } from "../i18n/core";

export function errorText(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.code === "rate-limited" || e.status === 429) return tt("error.rateLimited");
    if (e.code === "requires-recent-login") return tt("authErr.recentLogin");
    if (e.status === 401) return tt("error.unauthorized");
    if (e.status === 403) return tt("error.forbidden");
    if (e.status === 404) return tt("error.notFound");
    if (e.status === 409) return tt("error.conflict");
    if (e.status >= 500) return tt("error.server");
    return e.message || tt("error.unknown");
  }
  if (e instanceof TypeError) return tt("error.network"); // fetch() network failure
  if (e instanceof Error && e.name === "AbortError") return "";
  return tt("error.unknown");
}

/** "Could not add to playlist: Not found." */
export function failedText(what: MessageKey, e: unknown): string {
  return tt("error.withReason", { what: tt(what), reason: errorText(e) });
}
