import { tt } from "../i18n/core";

/**
 * "http://creativecommons.org/licenses/by-nc-sa/3.0/" → "CC BY-NC-SA 3.0".
 * Falls back to "License" for anything that isn't a recognisable CC URL.
 */
export function licenseLabel(url: string | undefined, { short = false } = {}): string {
  if (!url) return tt("license.generic");
  const m = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/?([\d.]+)?/i.exec(url);
  if (!m) return tt("license.generic");
  if (m[1].toLowerCase() === "publicdomain") return m[2].toLowerCase() === "zero" ? "CC0" : tt("license.publicDomain");
  return `CC ${m[2].toUpperCase()}${m[3] && !short ? ` ${m[3]}` : ""}`;
}

/** Opens an external page in a new tab without giving it access to this window. */
export function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}
