import { BarChart3, Headphones, Heart, Volume2 } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { formatHoursMinutes, formatNumber } from "../lib/format";
import { useAuth } from "../store/AuthContext";
import { useLibrary } from "../store/LibraryContext";
import { SectionHeader } from "./common";

/** Home statistics: the listener's real totals; guests get a sign-in card instead. */
export function Statistics() {
  const t = useT();
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
            {t("stats.guestTitle")}
          </h3>
          <p>{t("stats.guestText")}</p>
        </div>
        <Link to={`/login?next=${encodeURIComponent(pathname)}`} className="pill-btn small">
          {t("common.signIn")}
        </Link>
      </section>
    );
  }

  const tiles = [
    { icon: Volume2, value: stats ? formatHoursMinutes(stats.totalSeconds) : null, label: t("stats.totalTime"), live: false },
    { icon: Heart, value: stats ? formatNumber(stats.likes) : null, label: t("stats.likes"), live: true },
    { icon: Headphones, value: stats ? formatNumber(stats.tracks) : null, label: t("stats.tracks"), live: false },
  ];

  return (
    <section className="statistics" aria-labelledby="stats-title" aria-busy={!stats}>
      <SectionHeader title={<span id="stats-title">{t("stats.title")}</span>} action={t("common.seeAll")} onAction={() => navigate("/stats")} level={3} />
      <ul className="stat-tiles">
        {tiles.map(({ icon: Icon, value, label, live }) => (
          <li key={label} className={`stat-tile${value === null ? " skeleton" : ""}`}>
            <Icon size={20} aria-hidden="true" />
            <strong aria-live={live ? "polite" : undefined}>{value ?? " "}</strong>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
