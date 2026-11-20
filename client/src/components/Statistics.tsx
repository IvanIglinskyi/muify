import { Headphones, Heart, Volume2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatNumber } from "../lib/format";
import { useLibrary } from "../store/LibraryContext";
import { SectionHeader } from "./common";

export function Statistics() {
  const { stats } = useLibrary();
  const navigate = useNavigate();
  const tiles = stats
    ? [
        { icon: Volume2, value: `${stats.totalHours} hours`, label: "Total Time" },
        { icon: Heart, value: formatNumber(stats.likes), label: "Likes" },
        { icon: Headphones, value: formatNumber(stats.tracks), label: "Tracks" },
      ]
    : [];

  return (
    <section className="statistics" aria-labelledby="stats-title">
      <SectionHeader title={<span id="stats-title">Statistics</span>} action="See All" onAction={() => navigate("/stats")} level={3} />
      <ul className="stat-tiles">
        {tiles.map(({ icon: Icon, value, label }) => (
          <li key={label} className="stat-tile">
            <Icon size={20} aria-hidden="true" />
            <strong aria-live={label === "Likes" ? "polite" : undefined}>{value}</strong>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
