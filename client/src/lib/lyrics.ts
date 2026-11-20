// Lyrics lookups with a small in-memory cache shared by the player button and the lyrics panel.
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Track } from "../types";

type Entry = string | null;
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<Entry>>();
const MAX = 300;

/** Jamendo tracks may have lyrics; seed tracks never do. `false` = known to have none. */
export function mayHaveLyrics(t: Pick<Track, "source" | "hasLyrics"> | null | undefined): boolean {
  return Boolean(t && t.source === "jamendo" && t.hasLyrics !== false);
}

export function fetchLyrics(trackId: string): Promise<Entry> {
  if (cache.has(trackId)) return Promise.resolve(cache.get(trackId)!);
  let p = pending.get(trackId);
  if (!p) {
    p = api
      .getLyrics(trackId)
      .then((r) => {
        if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
        cache.set(trackId, r.lyrics);
        return r.lyrics;
      })
      .finally(() => pending.delete(trackId));
    pending.set(trackId, p);
  }
  return p;
}

export type LyricsState = { status: "none" } | { status: "loading" } | { status: "ready"; text: string } | { status: "error" };

/** Lyrics of `track` ("none" when there are none or the track can't have any). */
export function useLyrics(track: Track | null, enabled = true): LyricsState {
  const id = track && mayHaveLyrics(track) ? track.id : null;
  const [state, setState] = useState<LyricsState>(() =>
    id && cache.has(id) ? toState(cache.get(id)!) : id ? { status: "loading" } : { status: "none" }
  );

  useEffect(() => {
    if (!id || !enabled) {
      setState({ status: "none" });
      return;
    }
    if (cache.has(id)) {
      setState(toState(cache.get(id)!));
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetchLyrics(id).then(
      (text) => !cancelled && setState(toState(text)),
      () => !cancelled && setState({ status: "error" })
    );
    return () => {
      cancelled = true;
    };
  }, [id, enabled]);

  return state;
}

function toState(text: Entry): LyricsState {
  return text ? { status: "ready", text } : { status: "none" };
}
