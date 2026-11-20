// Display names of the built-in categories (curated playlists, genres) in the UI language.
// User playlists and catalogue items keep their own names.
import { en, type MessageKey } from "../i18n/en";
import { tt } from "../i18n/core";
import type { Genre, Playlist } from "../types";

const has = (key: string): key is MessageKey => Object.prototype.hasOwnProperty.call(en, key);

export function playlistName(p: Pick<Playlist, "id" | "name" | "kind">): string {
  if (p.kind === "user") return p.name;
  const key = `playlist.${p.id}`;
  return has(key) ? tt(key) : p.name;
}

export function genreName(g: Pick<Genre, "id" | "name">): string {
  const key = `genre.${g.id}`;
  return has(key) ? tt(key) : g.name;
}
