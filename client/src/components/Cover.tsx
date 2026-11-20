import { useId, useMemo, useState } from "react";
import { artworkFor } from "../lib/art";

interface CoverProps {
  seed: string;
  /** Real artwork (e.g. Jamendo album image). Falls back to the generated cover if missing or broken. */
  src?: string;
  className?: string;
  /** Darken the art (used behind text). */
  dim?: boolean;
}

/** Cover art: the real image when there is one, else generative SVG art seeded per id. Decorative. */
export function Cover({ src, ...props }: CoverProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src && src !== failedSrc) {
    const cls = ["cover", "cover-img", props.className, props.dim ? "is-dim" : null].filter(Boolean).join(" ");
    return (
      <img
        className={cls}
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailedSrc(src)}
      />
    );
  }
  return <GeneratedCover {...props} />;
}

function GeneratedCover({ seed, className, dim }: Omit<CoverProps, "src">) {
  const art = useMemo(() => artworkFor(seed), [seed]);
  const uid = useId().replace(/:/g, "");
  const [c0, c1] = art.palette;

  return (
    <svg
      className={className ? `cover ${className}` : "cover"}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`bg${uid}`} gradientTransform={`rotate(${art.angle} 0.5 0.5)`}>
          <stop offset="0" stopColor={c0} />
          <stop offset="1" stopColor={c1} />
        </linearGradient>
        <filter id={`blur${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id={`grain${uid}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={art.angle} />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.18 0" />
        </filter>
      </defs>
      <rect width="100" height="100" fill={`url(#bg${uid})`} />
      <g filter={`url(#blur${uid})`}>
        {art.blobs.map((b, i) => (
          <circle key={i} cx={b.cx} cy={b.cy} r={b.r} fill={b.color} opacity={b.opacity} />
        ))}
      </g>
      {art.streaks.map((s, i) => (
        <path
          key={i}
          d={`M${s.x1} ${s.y1} Q50 ${(s.y1 + s.y2) / 2 + 12} ${s.x2} ${s.y2}`}
          stroke={s.color}
          strokeWidth={s.width}
          opacity={s.opacity}
          fill="none"
        />
      ))}
      <rect width="100" height="100" filter={`url(#grain${uid})`} />
      {dim && <rect width="100" height="100" fill="#000" opacity="0.35" />}
    </svg>
  );
}
