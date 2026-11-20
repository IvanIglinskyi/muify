import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { licenseLabel, openExternal } from "../lib/license";
import { useLibrary } from "../store/LibraryContext";
import { usePlayer } from "../store/PlayerContext";
import type { Track } from "../types";
import type { MenuItem } from "./common";
import { useDialogs } from "./Dialogs";
import { useAuth } from "../store/AuthContext";

/** "License (CC …)" and "Open on Jamendo" menu entries for Creative Commons tracks. */
export function attributionItems(t: Track): MenuItem[] {
  const items: MenuItem[] = [];
  if (t.licenseUrl) {
    const url = t.licenseUrl;
    items.push({ label: `License: ${licenseLabel(url)}`, onSelect: () => openExternal(url) });
  }
  if (t.shareUrl) {
    const url = t.shareUrl;
    items.push({ label: "Open on Jamendo", onSelect: () => openExternal(url) });
  }
  return items;
}

export interface TrackMenuOptions {
  /** Queue used by "Play" (defaults to just this track / the current queue). */
  queue?: string[];
  /** Playlist the track is shown in: adds "Remove from this playlist" when editable. */
  playlistId?: string;
  /** Hide "Play" / queue entries (e.g. inside the queue panel itself). */
  hidePlayback?: boolean;
}

/** Ask for a name, create the playlist, optionally with a first track. */
export function useNewPlaylist() {
  const { prompt } = useDialogs();
  const { createPlaylist } = useLibrary();
  const { requireSignIn } = useAuth();
  return useCallback(
    async (trackIds: string[] = []) => {
      if (!requireSignIn("create playlists")) return null;
      const name = await prompt({
        title: "New playlist",
        label: "Playlist name",
        initial: "My playlist",
        confirmLabel: "Create",
      });
      return name ? createPlaylist(name, trackIds) : null;
    },
    [prompt, createPlaylist, requireSignIn]
  );
}

/** Builds the kebab menu for a track row (shared by every track list). */
export function useTrackMenu() {
  const { userPlaylists, playlists, toggleTrackLike, addToPlaylist, removeFromPlaylist, notifyInfo } = useLibrary();
  const { playTrack, playNext, addToQueue, current } = usePlayer();
  const navigate = useNavigate();
  const newPlaylist = useNewPlaylist();

  return useCallback(
    (t: Track, o: TrackMenuOptions = {}): MenuItem[] => {
      const items: MenuItem[] = [];
      if (!o.hidePlayback) {
        items.push({ label: "Play", onSelect: () => playTrack(t.id, o.queue) });
        const isCurrent = current?.id === t.id;
        items.push(
          {
            label: "Play next",
            disabled: isCurrent,
            onSelect: () => {
              playNext(t.id);
              notifyInfo(`“${t.title}” will play next`);
            },
          },
          {
            label: "Add to queue",
            disabled: isCurrent,
            onSelect: () => {
              addToQueue(t.id);
              notifyInfo(`Added “${t.title}” to the queue`);
            },
          }
        );
      }
      items.push({
        label: "Add to playlist",
        submenu: [
          ...userPlaylists.map((p) => {
            const has = p.trackIds.includes(t.id);
            return {
              label: has ? `${p.name} (added)` : p.name,
              disabled: has,
              onSelect: () => void addToPlaylist(p.id, t.id),
            };
          }),
          { label: "+ New playlist…", onSelect: () => void newPlaylist([t.id]) },
        ],
      });
      if (t.albumId) {
        const albumId = t.albumId;
        items.push({ label: "Go to album", onSelect: () => navigate(`/album/${encodeURIComponent(albumId)}`) });
      }
      if (t.artistId) {
        const artistId = t.artistId;
        items.push({ label: "Go to artist", onSelect: () => navigate(`/artist/${encodeURIComponent(artistId)}`) });
      }
      items.push({ label: t.liked ? "Remove from favourites" : "Add to favourites", onSelect: () => toggleTrackLike(t.id) });
      const p = o.playlistId ? playlists.find((x) => x.id === o.playlistId) : undefined;
      // (On Favourites, "Remove from favourites" above already does this.)
      if (p && p.kind === "user") {
        items.push({
          label: "Remove from this playlist",
          danger: true,
          onSelect: () => void removeFromPlaylist(p.id, t.id),
        });
      }
      items.push(...attributionItems(t));
      return items;
    },
    [
      userPlaylists,
      playlists,
      current,
      playTrack,
      playNext,
      addToQueue,
      toggleTrackLike,
      addToPlaylist,
      removeFromPlaylist,
      navigate,
      newPlaylist,
      notifyInfo,
    ]
  );
}
