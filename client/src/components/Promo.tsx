import { X } from "lucide-react";
import { Link } from "react-router-dom";
import { useT } from "../i18n";

export function Promo({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <section className="card promo" aria-labelledby="promo-title">
      <button type="button" className="promo-close" aria-label={t("promo.close")} onClick={onClose}>
        <X size={14} strokeWidth={3} />
      </button>
      <div className="promo-text">
        <h2 id="promo-title">{t("promo.title")}</h2>
        <p>{t("promo.text")}</p>
        <Link to="/plans" className="pill-btn">
          {t("promo.cta")}
        </Link>
      </div>
      <PromoShape />
    </section>
  );
}

/** Decorative 3D-ish spiral + star, drawn with SVG gradients. */
function PromoShape() {
  const rings = Array.from({ length: 7 }, (_, i) => i);
  return (
    <svg className="promo-shape" viewBox="0 0 160 200" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd27a" />
          <stop offset="0.35" stopColor="#ff9a1f" />
          <stop offset="0.65" stopColor="#c86bd6" />
          <stop offset="1" stopColor="#4fc3d9" />
        </linearGradient>
        <linearGradient id="starGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9be7f2" />
          <stop offset="1" stopColor="#1f7f9a" />
        </linearGradient>
      </defs>
      <path
        d="M70 18 L80 52 L112 62 L80 72 L70 106 L60 72 L28 62 L60 52 Z"
        fill="url(#starGrad)"
        transform="rotate(-18 70 62)"
      />
      {rings.map((i) => (
        <ellipse
          key={i}
          cx={108 - i * 2}
          cy={110 + i * 13}
          rx={40 + i * 3}
          ry={11 + i * 0.6}
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth={7}
          transform={`rotate(${-14 + i * 2} ${108 - i * 2} ${110 + i * 13})`}
          opacity={0.95 - i * 0.04}
        />
      ))}
    </svg>
  );
}
