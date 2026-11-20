import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n";
import { useLibrary } from "../store/LibraryContext";
import { SectionHeader } from "./common";
import { TrackTable } from "./TrackTable";

export function DailyMix({ query }: { query: string }) {
  const t = useT();
  const { dailyMixIds, tracks, loading, mixPersonalised, mixBasedOn } = useLibrary();
  const [expanded, setExpanded] = useState(false);

  const q = query.trim().toLowerCase();
  const list = dailyMixIds
    .map((id) => tracks[id])
    .filter(Boolean)
    .filter((x) => !q || `${x.title} ${x.artist} ${x.album}`.toLowerCase().includes(q));

  return (
    <section className="card daily-mix" aria-labelledby="daily-mix-title">
      <SectionHeader
        title={<span id="daily-mix-title">{t("mix.title")}</span>}
        action={expanded ? t("mix.collapse") : t("mix.exploreAll")}
        onAction={() => setExpanded((e) => !e)}
      />
      {mixPersonalised && (
        <p className="mix-note">
          <Sparkles size={13} aria-hidden="true" /> {t("mix.madeForYou")}
          {mixBasedOn.length > 0 && <> · {t("mix.basedOn", { names: mixBasedOn.join(", ") })}</>}
        </p>
      )}
      <div className={`mix-scroll${expanded ? " is-expanded" : ""}`}>
        <TrackTable tracks={list} empty={loading ? undefined : t("common.noMatch", { q: query.trim() })} />
      </div>
    </section>
  );
}
