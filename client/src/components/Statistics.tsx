import { BarChart3, Headphones, Heart, Volume2 } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { formatHoursMinutes, formatNumber } from "../lib/format";
import { useAuth } from "../store/AuthContext";
import { useLibrary } from "../store/LibraryContext";
import { SectionHeader } from "./common";

/** Home statistics: the listener's real totals; guests get a sign-in card instead. */
export function Statistics() {
  const { stats } = useLibrary();
  const { phase } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  if (phase === "guest") {
    return (
      <section className="statistics stats-guest card" aria-labelledby="stats-title">
        <BarChart3 size={22} aria-hidden="true" className="stats-guest-icon" />
        <div>
          <h3 id="stats-title" className="section-title small">
            Your statistics
          </h3>
          <p>Sign in to see your listening stats: time listened, likes and tracks played.</p>
        </div>
        <Link to={`/login?next=${encodeURIComponent(pathname)}`} className="pill-btn small">
          Sign in
        </Link>
      </section>
    );
  }

  const tiles = [
    { icon: Volume2, value: stats ? formatHoursMinutes(stats.totalSeconds) : null, label: "Total Time" },
    { icon: Heart, value: stats ? formatNumber(stats.likes) : null, label: "Likes" },
    { icon: Headphones, value: stats ? formatNumber(stats.tracks) : null, label: "Tracks" },
  ];

  return (
    <section className="statistics" aria-labelledby="stats-title" aria-busy={!stats}>
      <SectionHeader title={<span id="stats-title">Statistics</span>} action="See All" onAction={() => navigate("/stats")} level={3} />
      <ul className="stat-tiles">
        {tiles.map(({ icon: Icon, value, label }) => (
          <li key={label} className={`stat-tile${value === null ? " skeleton" : ""}`}>
            <Icon size={20} aria-hidden="true" />
            <strong aria-live={label === "Likes" ? "polite" : undefined}>{value ?? " "}</strong>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
