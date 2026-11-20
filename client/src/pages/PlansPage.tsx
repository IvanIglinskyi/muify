import { ArrowLeft, Check, Crown, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useLibrary } from "../store/LibraryContext";
import { useDocumentTitle } from "./shell";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "€0",
    period: "forever",
    features: ["Stream the whole catalogue", "Likes, playlists and history", "Standard sound quality"],
    current: true,
  },
  {
    id: "premium",
    name: "Premium",
    price: "€9.99",
    period: "per month",
    features: ["Everything in Free", "No interruptions", "High-quality sound", "Offline listening", "Unlimited skips"],
    current: false,
  },
];

/** /plans — "View Plan" from the promo card. Purely illustrative: nothing can be bought. */
export function PlansPage() {
  useDocumentTitle("Plans");
  const { notifyInfo } = useLibrary();

  return (
    <div className="page plans-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> Home
      </Link>
      <div className="page-head">
        <h1 className="page-title">Make Every Beat Count</h1>
        <p className="page-sub">Choose the plan that fits your listening.</p>
      </div>
      <p className="demo-banner" role="note">
        <Info size={16} aria-hidden="true" />
        <span>
          <strong>Demo only.</strong> Muify is a demo app — there are no real subscriptions and no payment is
          taken.
        </span>
      </p>
      <ul className="plan-grid">
        {PLANS.map((p) => (
          <li key={p.id} className={`card plan-card${p.id === "premium" ? " is-premium" : ""}`}>
            <div className="plan-head">
              <h2 className="plan-name">
                {p.id === "premium" && <Crown size={18} aria-hidden="true" />} {p.name}
              </h2>
              {p.current && <span className="badge">Current plan</span>}
            </div>
            <p className="plan-price">
              <strong>{p.price}</strong> <span>{p.period}</span>
            </p>
            <ul className="plan-features">
              {p.features.map((f) => (
                <li key={f}>
                  <Check size={15} aria-hidden="true" /> {f}
                </li>
              ))}
            </ul>
            {p.current ? (
              <button type="button" className="ghost-btn" disabled>
                Your current plan
              </button>
            ) : (
              <button
                type="button"
                className="pill-btn"
                onClick={() => notifyInfo("Demo only — no purchase was made.")}
                aria-describedby="demo-note"
              >
                Get Premium (demo)
              </button>
            )}
          </li>
        ))}
      </ul>
      <p id="demo-note" className="sr-only">
        Demo: this button does not purchase anything.
      </p>
    </div>
  );
}
