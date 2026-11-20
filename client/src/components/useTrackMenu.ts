import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { tt, useT } from "../i18n";
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
    items.push({ label: tt("menu.license", { license: licenseLabel(url) }), onSelect: () => openExternal(url) });
  }
  if (t.shareUrl) {
    const url = t.shareUrl;
    items.push({ label: tt("common.openJamendo"), onSelect: () => openExternal(url) });
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
  const t = useT();
  const { prompt } = useDialogs();
  const { createPlaylist } = useLibrary();
  const { requireSignIn } = useAuth();
  return useCallback(
    async (trackIds: string[] = []) => {
      if (!requireSignIn("signin.what.playlists")) return null;
      const name = await prompt({
        title: t("playlistDialog.newTitle"),
        label: t("playlistDialog.nameLabel"),
        initial: t("playlistDialog.defaultName"),
        confirmLabel: t("playlistDialog.create"),
      });
      return name ? createPlaylist(name, trackIds) : null;
    },
    [prompt, createPlaylist, requireSignIn, t]
  );
}

/** Builds the kebab menu for a track row (shared by every track list). */
export function useTrackMenu() {
  const t = useT();
  const { userPlaylists, playlists, toggleTrackLike, addToPlaylist, removeFromPlaylist, notifyInfo } = useLibrary();
  const { playTrack, playNext, addToQueue, current } = usePlayer();
  const navigate = useNavigate();
  const newPlaylist = useNewPlaylist();

  return useCallback(
    (tr: Track, o: TrackMenuOptions = {}): MenuItem[] => {
      const items: MenuItem[] = [];
      if (!o.hidePlayback) {
        items.push({ label: t("menu.play"), onSelect: () => playTrack(tr.id, o.queue) });
        const isCurrent = current?.id === tr.id;
        items.push(
          {
            label: t("menu.playNext"),
            disabled: isCurrent,
            onSelect: () => {
              playNext(tr.id);
              notifyInfo(t("menu.willPlayNext", { title: tr.title }));
            },
          },
          {
            label: t("menu.addToQueue"),
            disabled: isCurrent,
            onSelect: () => {
              addToQueue(tr.id);
              notifyInfo(t("menu.addedToQueue", { title: tr.title }));
            },
          }
        );
      }
      items.push({
        label: t("menu.addToPlaylist"),
        submenu: [
          ...userPlaylists.map((p) => {
            const has = p.trackIds.includes(tr.id);
            return {
              label: has ? t("menu.added", { name: p.name }) : p.name,
              disabled: has,
              onSelect: () => void addToPlaylist(p.id, tr.id),
            };
          }),
          { label: t("menu.newPlaylist"), onSelect: () => void newPlaylist([tr.id]) },
        ],
      });
      if (tr.albumId) {
        const albumId = tr.albumId;
        items.push({ label: t("menu.goToAlbum"), onSelect: () => navigate(`/album/${encodeURIComponent(albumId)}`) });
      }
      if (tr.artistId) {
        const artistId = tr.artistId;
        items.push({ label: t("menu.goToArtist"), onSelect: () => navigate(`/artist/${encodeURIComponent(artistId)}`) });
      }
      items.push({ label: tr.liked ? t("menu.removeFavourite") : t("menu.addFavourite"), onSelect: () => toggleTrackLike(tr.id) });
      const p = o.playlistId ? playlists.find((x) => x.id === o.playlistId) : undefined;
      // (On Favourites, "Remove from favourites" above already does this.)
      if (p && p.kind === "user") {
        items.push({
          label: t("menu.removeFromPlaylist"),
          danger: true,
          onSelect: () => void removeFromPlaylist(p.id, tr.id),
        });
      }
      items.push(...attributionItems(tr));
      return items;
    },
    [
      t,
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
