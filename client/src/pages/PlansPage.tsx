import { ArrowLeft, Check, Crown, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n, useT, type MessageKey } from "../i18n";
import { useLibrary } from "../store/LibraryContext";
import { useDocumentTitle } from "./shell";

const PLANS: { id: string; name: MessageKey; price: number; period: MessageKey; features: MessageKey[]; current: boolean }[] = [
  {
    id: "free",
    name: "plans.free",
    price: 0,
    period: "plans.forever",
    features: ["plans.f.catalogue", "plans.f.library", "plans.f.standard"],
    current: true,
  },
  {
    id: "premium",
    name: "plans.premium",
    price: 9.99,
    period: "plans.perMonth",
    features: ["plans.f.everything", "plans.f.noInterruptions", "plans.f.hq", "plans.f.offline", "plans.f.skips"],
    current: false,
  },
];

/** /plans — "View Plan" from the promo card. Purely illustrative: nothing can be bought. */
export function PlansPage() {
  const t = useT();
  const { locale } = useI18n();
  useDocumentTitle(t("plans.title"));
  const { notifyInfo } = useLibrary();
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: n % 1 ? 2 : 0 }).format(n);

  return (
    <div className="page plans-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> {t("common.home")}
      </Link>
      <div className="page-head">
        <h1 className="page-title">{t("plans.title")}</h1>
        <p className="page-sub">{t("plans.sub")}</p>
      </div>
      <p className="demo-banner" role="note">
        <Info size={16} aria-hidden="true" />
        <span>
          <strong>{t("plans.demoStrong")}</strong> {t("plans.demoText")}
        </span>
      </p>
      <ul className="plan-grid">
        {PLANS.map((p) => (
          <li key={p.id} className={`card plan-card${p.id === "premium" ? " is-premium" : ""}`}>
            <div className="plan-head">
              <h2 className="plan-name">
                {p.id === "premium" && <Crown size={18} aria-hidden="true" />} {t(p.name)}
              </h2>
              {p.current && <span className="badge">{t("plans.current")}</span>}
            </div>
            <p className="plan-price">
              <strong>{money(p.price)}</strong> <span>{t(p.period)}</span>
            </p>
            <ul className="plan-features">
              {p.features.map((f) => (
                <li key={f}>
                  <Check size={15} aria-hidden="true" /> {t(f)}
                </li>
              ))}
            </ul>
            {p.current ? (
              <button type="button" className="ghost-btn" disabled>
                {t("plans.yourCurrent")}
              </button>
            ) : (
              <button
                type="button"
                className="pill-btn"
                onClick={() => notifyInfo(t("plans.demoToast"))}
                aria-describedby="demo-note"
              >
                {t("plans.getPremium")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p id="demo-note" className="sr-only">
        {t("plans.demoNote")}
      </p>
    </div>
  );
}
