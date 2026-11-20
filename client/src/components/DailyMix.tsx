import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useLibrary } from "../store/LibraryContext";
import { SectionHeader } from "./common";
import { TrackTable } from "./TrackTable";

export function DailyMix({ query }: { query: string }) {
  const { dailyMixIds, tracks, loading, mixPersonalised, mixBasedOn } = useLibrary();
  const [expanded, setExpanded] = useState(false);

  const q = query.trim().toLowerCase();
  const list = dailyMixIds
    .map((id) => tracks[id])
    .filter(Boolean)
    .filter((t) => !q || `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q));

  return (
    <section className="card daily-mix" aria-labelledby="daily-mix-title">
      <SectionHeader
        title={<span id="daily-mix-title">Daily Mix</span>}
        action={expanded ? "Collapse" : "Explore All"}
        onAction={() => setExpanded((e) => !e)}
      />
      {mixPersonalised && (
        <p className="mix-note">
          <Sparkles size={13} aria-hidden="true" /> Made for you
          {mixBasedOn.length > 0 && <> · based on {mixBasedOn.join(", ")}</>}
        </p>
      )}
      <div className={`mix-scroll${expanded ? " is-expanded" : ""}`}>
        <TrackTable tracks={list} empty={loading ? undefined : <>No tracks match “{query}”.</>} />
      </div>
    </section>
  );
}
