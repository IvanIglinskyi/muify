import { ArrowLeft, BarChart3, Clock, Headphones, Heart, Mic2, PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ArtistLink } from "../components/ArtistLink";
import { TrackTable } from "../components/TrackTable";
import { formatListening, formatNumber } from "../lib/format";
import { useLibrary } from "../store/LibraryContext";
import type { ListeningStats } from "../types";
import { EmptyState } from "./LibraryPage";
import { useDocumentTitle } from "./shell";

const weekday = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" });

/** /stats — listening statistics computed from the real play history. */
export function StatsPage() {
  useDocumentTitle("Statistics");
  const { historyVersion, mergeTracks, tracks } = useLibrary();
  const [stats, setStats] = useState<ListeningStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .getListeningStats(ctrl.signal)
      .then((s) => {
        mergeTracks(s.topTracks.map((t) => t.track));
        setStats(s);
        setError(null);
      })
      .catch((e: Error) => e.name !== "AbortError" && setError(e.message));
    return () => ctrl.abort();
  }, [historyVersion, mergeTracks]);

  const head = (
    <>
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> Home
      </Link>
      <div className="page-head">
        <h1 className="page-title">Statistics</h1>
        <p className="page-sub">
          {stats?.firstPlayedAt
            ? `Computed from your play history since ${new Date(stats.firstPlayedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
            : "Computed from your play history"}
        </p>
      </div>
    </>
  );

  if (error && !stats) {
    return (
      <div className="page">
        {head}
        <p className="inline-error" role="alert">
          Could not load statistics: {error}
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
    { icon: Clock, value: formatListening(stats.totalSeconds), label: "Listening time" },
    { icon: PlayCircle, value: formatNumber(stats.plays), label: "Plays" },
    { icon: Headphones, value: formatNumber(stats.uniqueTracks), label: "Tracks played" },
    { icon: Heart, value: formatNumber(stats.likedTracks + stats.likedAlbums), label: "Likes (tracks + albums)" },
  ];
  const maxDay = Math.max(1, ...stats.last7Days.map((d) => d.seconds));
  // Live like state for the top tracks table.
  const topTracks = stats.topTracks.map((t) => tracks[t.track.id] ?? t.track);
  const playsById = new Map(stats.topTracks.map((t) => [t.track.id, t]));

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
        <EmptyState icon={<BarChart3 size={28} />} title="No plays yet">
          <p>Listen to any track for at least 10 seconds and your statistics will start filling in.</p>
          <Link to="/explore" className="pill-btn">
            Explore music
          </Link>
        </EmptyState>
      ) : (
        <>
          <section className="card chart-panel" aria-labelledby="week-title">
            <h2 id="week-title" className="section-title small">
              Last 7 days
            </h2>
            <ol className="day-bars">
              {stats.last7Days.map((d) => (
                <li key={d.date} title={`${d.date}: ${formatListening(d.seconds)}, ${d.plays} plays`}>
                  <span className="day-bar-track">
                    <span className="day-bar" style={{ height: `${Math.max(d.seconds ? 4 : 0, (d.seconds / maxDay) * 100)}%` }} />
                  </span>
                  <span className="day-label">{weekday(d.date)}</span>
                  <span className="sr-only">
                    {formatListening(d.seconds)}, {d.plays} plays
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <div className="stats-columns">
            <section className="card chart-panel" aria-labelledby="top-tracks-title">
              <h2 id="top-tracks-title" className="section-title small">
                Top tracks
              </h2>
              <div className="chart-scroll">
                <TrackTable
                  tracks={topTracks}
                  showRank
                  hideAlbum
                  caption="Your top tracks"
                  extraColumn={{ header: "Plays", render: (t) => playsById.get(t.id)?.plays ?? 0 }}
                />
              </div>
            </section>

            <section className="card chart-panel" aria-labelledby="top-artists-title">
              <h2 id="top-artists-title" className="section-title small">
                Top artists
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
                      {a.plays} play{a.plays === 1 ? "" : "s"} · {formatListening(a.seconds)}
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
