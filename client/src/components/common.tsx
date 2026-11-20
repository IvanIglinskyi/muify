import { Heart, MoreVertical } from "lucide-react";
import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";

export function Logo({ className }: { className?: string }) {
  return <span className={className ? `logo ${className}` : "logo"}>Muify</span>;
}

interface HeartButtonProps {
  liked: boolean;
  onToggle: () => void;
  label: string;
  size?: number;
  className?: string;
}

export function HeartButton({ liked, onToggle, label, size = 20, className }: HeartButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn heart-btn${liked ? " is-liked" : ""}${className ? ` ${className}` : ""}`}
      aria-label={liked ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
      aria-pressed={liked}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Heart size={size} fill={liked ? "currentColor" : "none"} strokeWidth={1.8} />
    </button>
  );
}

export function SectionHeader({
  title,
  action,
  onAction,
  level = 2,
}: {
  title: ReactNode;
  action?: string;
  onAction?: () => void;
  level?: 2 | 3;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="section-header">
      <H className="section-title">{title}</H>
      {action && (
        <button type="button" className="link-btn" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
}

/** Kebab (⋮) button with a small popup menu; closes on outside click / Escape. */
export function KebabMenu({ items, label, className }: { items: MenuItem[]; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`kebab${className ? ` ${className}` : ""}`} ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <MoreVertical size={18} />
      </button>
      {open && (
        <ul className="kebab-menu" role="menu">
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Styled range input: natively draggable + keyboard accessible, orange fill via CSS var. */
export function RangeSlider({
  value,
  max,
  step,
  onChange,
  label,
  valueText,
  className,
}: {
  value: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  valueText?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <input
      type="range"
      className={`range${className ? ` ${className}` : ""}`}
      min={0}
      max={max}
      step={step ?? 1}
      value={value}
      aria-label={label}
      aria-valuetext={valueText}
      style={{ "--fill": `${pct}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
