import { Clock, ListMusic, Mic2, Search as SearchIcon, X } from "lucide-react";
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigationType, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { AlbumCard } from "../components/AlbumCard";
import { artistPath } from "../components/ArtistLink";
import { Cover } from "../components/Cover";
import { TrackTable } from "../components/TrackTable";
import { useT, type MessageKey } from "../i18n";
import { errorText } from "../lib/errors";
import { playlistName } from "../lib/names";
import { playlistIcon } from "../lib/playlistIcons";
import { useAuth } from "../store/AuthContext";
import { useLibrary } from "../store/LibraryContext";
import type { Artist, Playlist, SearchType } from "../types";
import { EmptyState } from "./LibraryPage";
import { matchesQuery, useDebounced, useDocumentTitle } from "./shell";

export const searchPath = (q: string, tab: SearchType = "all") =>
  `/search?q=${encodeURIComponent(q)}${tab === "all" ? "" : `&tab=${tab}`}`;

const TABS: { id: SearchType; label: MessageKey; what: MessageKey }[] = [
  { id: "all", label: "search.tab.all", what: "search.what.tracks" },
  { id: "tracks", label: "search.tab.tracks", what: "search.what.tracks" },
  { id: "albums", label: "search.tab.albums", what: "search.what.albums" },
  { id: "artists", label: "search.tab.artists", what: "search.what.artists" },
  { id: "playlists", label: "search.tab.playlists", what: "search.what.playlists" },
];
const isTab = (v: string | null): v is SearchType => TABS.some((x) => x.id === v);

const ALL_PREVIEW_TRACKS = 5;
const GUEST_KEY = "muify:recent-searches";
const MAX_RECENT = 10;

// ---------------------------------------------------------------------------
// Recent searches: the account (members) or this browser (guests)
// ---------------------------------------------------------------------------
function readLocal(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(GUEST_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}
function writeLocal(list: string[]) {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    /* private mode */
  }
}

function useRecentSearches() {
  const { canSave, identityKey } = useAuth();
  const [list, setList] = useState<string[]>([]);

  useEffect(() => {
    if (identityKey === null) return;
    if (!canSave) {
      setList(readLocal());
      return;
    }
    const ctrl = new AbortController();
    api.getRecentSearches(ctrl.signal).then(setList, () => {});
    return () => ctrl.abort();
  }, [canSave, identityKey]);

  const add = useCallback(
    (q: string) => {
      const clean = q.replace(/\s+/g, " ").trim();
      if (!clean) return;
      const next = [clean, ...list.filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_RECENT);
      setList(next);
      if (canSave) api.addRecentSearch(clean).then(setList, () => {});
      else writeLocal(next);
    },
    [list, canSave]
  );

  const remove = useCallback(
    (q?: string) => {
      const next = q ? list.filter((x) => x !== q) : [];
      setList(next);
      if (canSave) api.clearRecentSearches(q).then(setList, () => {});
      else writeLocal(next);
    },
    [list, canSave]
  );

  return { list, add, remove };
}

interface Results {
  q: string;
  type: SearchType;
  trackIds: string[];
  albumIds: string[];
  artists: Artist[];
  playlists: Playlist[];
}

/** /search?q=&tab= — everything at once, or one kind of result. */
export function SearchPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navType = useNavigationType();
  const urlQ = (params.get("q") ?? "").trim();
  const tabParam = params.get("tab");
  const tab: SearchType = isTab(tabParam) ? tabParam : "all";
  const { tracks, albums, playlists, mergeTracks, mergeAlbums } = useLibrary();
  const { canSave } = useAuth();
  const recent = useRecentSearches();
  const [input, setInput] = useState(urlQ);
  const q = useDebounced(input.trim(), 300);
  const [results, setResults] = useState<Results | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useDocumentTitle(urlQ ? t("search.resultsFor", { q: urlQ }) : t("search.title"));

  // The header search (Enter) navigates here with a new ?q=: show it in our own box.
  useEffect(() => {
    setInput(urlQ);
  }, [urlQ]);

  // Typing updates the URL (replace: no history entry per keystroke).
  useEffect(() => {
    if (q === urlQ) return;
    const next = new URLSearchParams(params);
    if (q) next.set("q", q);
    else next.delete("q");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // A search the listener "committed" (Enter here or in the header, or opened by link) is remembered.
  const addRecent = recent.add;
  useEffect(() => {
    if (urlQ && navType !== "REPLACE") addRecent(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useEffect(() => {
    if (!urlQ) {
      setResults(null);
      setStatus("idle");
      return;
    }
    const ctrl = new AbortController();
    setStatus("loading");
    api
      .search(urlQ, tab, ctrl.signal)
      .then((r) => {
        setResults({
          q: r.q,
          type: r.type,
          trackIds: mergeTracks(r.tracks),
          albumIds: mergeAlbums(r.albums),
          artists: r.artists,
          playlists: r.playlists,
        });
        setStatus("ready");
        setError(null);
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(errorText(e));
        setStatus("error");
      });
    return () => ctrl.abort();
  }, [urlQ, tab, mergeTracks, mergeAlbums]);

  const selectTab = (id: SearchType) => {
    const next = new URLSearchParams(params);
    if (id === "all") next.delete("tab");
    else next.set("tab", id);
    setParams(next, { replace: true });
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const j = (to + TABS.length) % TABS.length;
    selectTab(TABS[j].id);
    tabRefs.current[j]?.focus();
  };

  // Live like state from the shared index.
  const trackList = (results?.trackIds ?? []).map((id) => tracks[id]).filter(Boolean);
  const albumList = (results?.albumIds ?? []).map((id) => albums[id]).filter(Boolean);
  // "Your playlists": the account's own playlists (server) + Favourites / curated ones by their shown name.
  const builtinMatches = canSave && urlQ ? playlists.filter((p) => p.kind !== "user" && matchesQuery(urlQ, playlistName(p))) : [];
  const playlistList = results ? [...builtinMatches, ...results.playlists.map((p) => playlists.find((x) => x.id === p.id) ?? p)] : [];
  const showTracks = tab === "all" || tab === "tracks";
  const showAlbums = tab === "all" || tab === "albums";
  const showArtists = tab === "all" || tab === "artists";
  const showPlaylists = tab === "all" || tab === "playlists";
  const total = trackList.length + albumList.length + (results?.artists.length ?? 0) + playlistList.length;
  const fresh = results?.q === urlQ && results.type === tab;

  return (
    <div className="page search-page">
      <div className="page-head">
        <h1 className="page-title">{t("search.title")}</h1>
      </div>
      <form
        className="search-box"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const v = input.trim();
          if (!v) return;
          const next = new URLSearchParams(params);
          next.set("q", v);
          setParams(next); // push: a committed search (remembered in recent searches)
        }}
      >
        <SearchIcon size={20} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("search.placeholder")}
          aria-label={t("search.inputLabel")}
          enterKeyHint="search"
          maxLength={100}
          autoFocus={!urlQ}
        />
        {input && (
          <button
            type="button"
            className="icon-btn"
            aria-label={t("common.close")}
            onClick={() => {
              setInput("");
              inputRef.current?.focus();
            }}
          >
            <X size={18} />
          </button>
        )}
        <button type="submit" className="pill-btn small">
          {t("search.submit")}
        </button>
      </form>

      <div className="tabs search-tabs" role="tablist" aria-label={t("search.tabs")}>
        {TABS.map((x, i) => (
          <button
            key={x.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`search-tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls="search-results"
            tabIndex={tab === x.id ? 0 : -1}
            className={`tab${tab === x.id ? " is-active" : ""}`}
            onClick={() => selectTab(x.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t(x.label)}
          </button>
        ))}
      </div>

      <div id="search-results" role="tabpanel" aria-labelledby={`search-tab-${tab}`} aria-busy={status === "loading"} className="search-results">
        <p className="sr-only" role="status" aria-live="polite">
          {status === "ready" && fresh ? (total ? t("search.resultsFor", { q: urlQ }) : t("search.noResults", { q: urlQ })) : ""}
        </p>

        {!urlQ && (
          <RecentSearches list={recent.list} onPick={(v) => setParams(new URLSearchParams({ q: v, ...(tab !== "all" ? { tab } : {}) }))} onRemove={recent.remove} />
        )}

        {urlQ && status === "error" && (
          <p className="inline-error" role="alert">
            {t("search.error", { error: error ?? "" })}
          </p>
        )}

        {urlQ && status === "loading" && !results && <div className="card chart-panel skeleton" style={{ minHeight: 220 }} />}

        {urlQ && results && (
          <div className={status === "loading" ? "is-busy" : undefined}>
            {status === "ready" && fresh && total === 0 && tab === "all" && (
              <EmptyState icon={<SearchIcon size={28} />} title={t("search.noResults", { q: urlQ })} />
            )}

            {showTracks && (tab !== "all" || trackList.length > 0) && (
              <section className="card chart-panel" aria-labelledby="sr-tracks">
                <div className="section-header">
                  <h2 id="sr-tracks" className="section-title small">
                    {t("search.tab.tracks")}
                  </h2>
                  {tab === "all" && trackList.length > ALL_PREVIEW_TRACKS && (
                    <button type="button" className="link-btn" onClick={() => selectTab("tracks")}>
                      {t("search.showAll")}
                    </button>
                  )}
                </div>
                <div className="chart-scroll">
                  <TrackTable
                    tracks={tab === "all" ? trackList.slice(0, ALL_PREVIEW_TRACKS) : trackList}
                    queue={trackList.map((x) => x.id)}
                    caption={t("search.tab.tracks")}
                    empty={status === "ready" ? t("search.noResultsTab", { q: urlQ, what: t("search.what.tracks") }) : undefined}
                  />
                </div>
              </section>
            )}

            {showAlbums && (tab !== "all" || albumList.length > 0) && (
              <section aria-labelledby="sr-albums" className="search-section">
                <div className="section-header">
                  <h2 id="sr-albums" className="section-title small">
                    {t("search.tab.albums")}
                  </h2>
                  {tab === "all" && albumList.length >= 8 && (
                    <button type="button" className="link-btn" onClick={() => selectTab("albums")}>
                      {t("search.showAll")}
                    </button>
                  )}
                </div>
                {albumList.length ? (
                  <ul className={tab === "all" ? "album-row" : "card-grid albums"}>
                    {albumList.map((a) => (
                      <AlbumCard key={a.id} album={a} showLike />
                    ))}
                  </ul>
                ) : (
                  status === "ready" && <p className="empty-inline">{t("search.noResultsTab", { q: urlQ, what: t("search.what.albums") })}</p>
                )}
              </section>
            )}

            {showArtists && (tab !== "all" || (results.artists.length ?? 0) > 0) && (
              <section aria-labelledby="sr-artists" className="search-section">
                <div className="section-header">
                  <h2 id="sr-artists" className="section-title small">
                    {t("search.tab.artists")}
                  </h2>
                  {tab === "all" && results.artists.length >= 8 && (
                    <button type="button" className="link-btn" onClick={() => selectTab("artists")}>
                      {t("search.showAll")}
                    </button>
                  )}
                </div>
                {results.artists.length ? (
                  <ul className="card-grid artist-grid">
                    {results.artists.map((a) => (
                      <li key={a.id} className="artist-card">
                        <Link to={artistPath(a.id)} className="artist-card-link" aria-label={t("search.artistCard", { name: a.name })}>
                          <span className="artist-card-art">
                            <Cover seed={a.id} src={a.imageUrl} />
                          </span>
                          <span className="artist-card-name">{a.name}</span>
                          <span className="track-artist">
                            <Mic2 size={12} aria-hidden="true" /> {t("artist.eyebrow")}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  status === "ready" && <p className="empty-inline">{t("search.noResultsTab", { q: urlQ, what: t("search.what.artists") })}</p>
                )}
              </section>
            )}

            {showPlaylists && (tab !== "all" || playlistList.length > 0) && (
              <section aria-labelledby="sr-playlists" className="search-section">
                <h2 id="sr-playlists" className="section-title small">
                  {t("search.tab.playlists")}
                </h2>
                {!canSave ? (
                  <p className="empty-inline">{t("search.playlistsGuest")}</p>
                ) : playlistList.length ? (
                  <ul className="card-grid">
                    {playlistList.map((p) => {
                      const Icon = playlistIcon(p.id);
                      const name = playlistName(p);
                      return (
                        <li key={p.id} className="playlist-card">
                          <Link to={`/library/playlists/${encodeURIComponent(p.id)}`} className="playlist-card-link" aria-label={t("library.openPlaylist", { name, count: p.trackIds.length })}>
                            <span className="playlist-art">
                              <Cover seed={p.id} src={tracks[p.trackIds[0]]?.coverUrl} />
                            </span>
                            <span className="playlist-card-text">
                              <span className="playlist-card-name">
                                <Icon size={16} aria-hidden="true" />
                                {name}
                              </span>
                              <span className="track-artist">{t("common.tracksCount", { count: p.trackIds.length })}</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  status === "ready" && <p className="empty-inline">{t("search.noResultsTab", { q: urlQ, what: t("search.what.playlists") })}</p>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RecentSearches({ list, onPick, onRemove }: { list: string[]; onPick: (q: string) => void; onRemove: (q?: string) => void }) {
  const t = useT();
  return (
    <section className="recent-searches" aria-labelledby="recent-searches-title">
      <div className="section-header">
        <h2 id="recent-searches-title" className="section-title small">
          <Clock size={16} aria-hidden="true" /> {t("search.recent")}
        </h2>
        {list.length > 0 && (
          <button type="button" className="link-btn" onClick={() => onRemove()}>
            {t("search.clearRecent")}
          </button>
        )}
      </div>
      {list.length ? (
        <ul className="recent-search-list">
          {list.map((q) => (
            <li key={q} className="recent-search">
              <button type="button" className="recent-search-q" onClick={() => onPick(q)}>
                <SearchIcon size={14} aria-hidden="true" /> {q}
              </button>
              <button type="button" className="icon-btn" aria-label={t("search.removeRecent", { q })} onClick={() => onRemove(q)}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<ListMusic size={28} />} title={t("search.start")}>
          <p>{t("search.noRecent")}</p>
        </EmptyState>
      )}
    </section>
  );
}
