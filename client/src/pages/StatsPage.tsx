import { ArrowLeft, BarChart3, Clock, Headphones, Heart, Mic2, PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ArtistLink } from "../components/ArtistLink";
import { TrackTable } from "../components/TrackTable";
import { useT } from "../i18n";
import { errorText } from "../lib/errors";
import { formatDate, formatListening, formatNumber, formatWeekday } from "../lib/format";
import { useLibrary } from "../store/LibraryContext";
import type { ListeningStats } from "../types";
import { EmptyState } from "./LibraryPage";
import { useDocumentTitle } from "./shell";

/** /stats — listening statistics computed from the real play history. */
export function StatsPage() {
  const t = useT();
  useDocumentTitle(t("statsPage.title"));
  const { historyVersion, mergeTracks, tracks } = useLibrary();
  const [stats, setStats] = useState<ListeningStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .getListeningStats(ctrl.signal)
      .then((s) => {
        mergeTracks(s.topTracks.map((x) => x.track));
        setStats(s);
        setError(null);
      })
      .catch((e: Error) => e.name !== "AbortError" && setError(errorText(e)));
    return () => ctrl.abort();
  }, [historyVersion, mergeTracks]);

  const head = (
    <>
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> {t("common.home")}
      </Link>
      <div className="page-head">
        <h1 className="page-title">{t("statsPage.title")}</h1>
        <p className="page-sub">
          {stats?.firstPlayedAt ? t("statsPage.since", { date: formatDate(stats.firstPlayedAt) }) : t("statsPage.sub")}
        </p>
      </div>
    </>
  );

  if (error && !stats) {
    return (
      <div className="page">
        {head}
        <p className="inline-error" role="alert">
          {t("statsPage.loadError", { error })}
        </p>
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="page" aria-busy="true">
        {head}
        <ul className="stat-tiles stats-page-tiles">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="stat-tile skeleton" style={{ minHeight: 110 }} />
          ))}
        </ul>
      </div>
    );
  }

  const tiles = [
    { icon: Clock, value: formatListening(stats.totalSeconds), label: t("statsPage.listening") },
    { icon: PlayCircle, value: formatNumber(stats.plays), label: t("statsPage.plays") },
    { icon: Headphones, value: formatNumber(stats.uniqueTracks), label: t("statsPage.tracksPlayed") },
    { icon: Heart, value: formatNumber(stats.likedTracks + stats.likedAlbums), label: t("statsPage.likes") },
  ];
  const maxDay = Math.max(1, ...stats.last7Days.map((d) => d.seconds));
  // Live like state for the top tracks table.
  const topTracks = stats.topTracks.map((x) => tracks[x.track.id] ?? x.track);
  const playsById = new Map(stats.topTracks.map((x) => [x.track.id, x]));

  return (
    <div className="page stats-page">
      {head}
      <ul className="stat-tiles stats-page-tiles">
        {tiles.map(({ icon: Icon, value, label }) => (
          <li key={label} className="stat-tile">
            <Icon size={20} aria-hidden="true" />
            <strong>{value}</strong>
            <span>{label}</span>
          </li>
        ))}
      </ul>

      {stats.plays === 0 ? (
        <EmptyState icon={<BarChart3 size={28} />} title={t("statsPage.noPlays")}>
          <p>{t("statsPage.noPlaysText")}</p>
          <Link to="/explore" className="pill-btn">
            {t("common.exploreMusic")}
          </Link>
        </EmptyState>
      ) : (
        <>
          <section className="card chart-panel" aria-labelledby="week-title">
            <h2 id="week-title" className="section-title small">
              {t("statsPage.last7")}
            </h2>
            <ol className="day-bars">
              {stats.last7Days.map((d) => (
                <li key={d.date} title={t("statsPage.dayTitle", { date: formatDate(`${d.date}T12:00:00`), time: formatListening(d.seconds), plays: t("common.playsCount", { count: d.plays }) })}>
                  <span className="day-bar-track">
                    <span className="day-bar" style={{ height: `${Math.max(d.seconds ? 4 : 0, (d.seconds / maxDay) * 100)}%` }} />
                  </span>
                  <span className="day-label">{formatWeekday(d.date)}</span>
                  <span className="sr-only">
                    {formatListening(d.seconds)}, {t("common.playsCount", { count: d.plays })}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <div className="stats-columns">
            <section className="card chart-panel" aria-labelledby="top-tracks-title">
              <h2 id="top-tracks-title" className="section-title small">
                {t("statsPage.topTracks")}
              </h2>
              <div className="chart-scroll">
                <TrackTable
                  tracks={topTracks}
                  showRank
                  hideAlbum
                  caption={t("statsPage.topTracksCaption")}
                  extraColumn={{ header: t("statsPage.plays"), render: (x) => playsById.get(x.id)?.plays ?? 0 }}
                />
              </div>
            </section>

            <section className="card chart-panel" aria-labelledby="top-artists-title">
              <h2 id="top-artists-title" className="section-title small">
                {t("statsPage.topArtists")}
              </h2>
              <ol className="artist-list">
                {stats.topArtists.map((a, i) => (
                  <li key={a.artist}>
                    <span className="artist-rank">{i + 1}</span>
                    <span className="artist-icon" aria-hidden="true">
                      <Mic2 size={16} />
                    </span>
                    <ArtistLink className="artist-name" name={a.artist} id={a.artistId} />
                    <span className="artist-meta">
                      {t("common.playsCount", { count: a.plays })} · {formatListening(a.seconds)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
