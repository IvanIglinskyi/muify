import { useState } from "react";
import { useLibrary } from "../store/LibraryContext";
import { SectionHeader } from "./common";
import { TrackTable } from "./TrackTable";

export function DailyMix({ query }: { query: string }) {
  const { dailyMixIds, tracks, loading } = useLibrary();
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
      <div className={`mix-scroll${expanded ? " is-expanded" : ""}`}>
        <TrackTable tracks={list} empty={loading ? undefined : <>No tracks match “{query}”.</>} />
      </div>
    </section>
  );
}
