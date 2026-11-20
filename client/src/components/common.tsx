import { ChevronLeft, ChevronRight, Heart, MoreVertical } from "lucide-react";
import {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

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
        e.preventDefault();
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
  onSelect?: () => void;
  /** Opens a nested list in place of the menu ("Add to playlist ▸"). */
  submenu?: MenuItem[];
  disabled?: boolean;
  /** Destructive action (red). */
  danger?: boolean;
}

/** Closes on outside pointerdown / Escape. `refs` = elements that count as "inside". */
function useDismiss(open: boolean, refs: React.RefObject<HTMLElement>[], onClose: (viaEscape: boolean) => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!refs.some((r) => r.current?.contains(e.target as Node))) closeRef.current(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

const MENU_W = 220;

/**
 * Kebab (⋮) button with a popup menu rendered in a portal (so scrolling tables never clip it).
 * Arrow keys move between items, Escape closes (or leaves a submenu), focus returns to the button.
 */
export function KebabMenu({ items, label, className }: { items: MenuItem[]; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<number | null>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setSub(null);
    if (restoreFocus) btnRef.current?.focus();
  }, []);

  useDismiss(open, [btnRef, menuRef], () => close(false));

  // Position next to the button; flip up / left when there is no room.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      const m = menuRef.current;
      if (!r || !m) return;
      const h = m.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const left = Math.max(8, Math.min(r.right - MENU_W, vw - MENU_W - 8));
      const below = r.bottom + 4;
      const top = below + h > vh - 8 && r.top - h - 4 > 8 ? r.top - h - 4 : Math.min(below, Math.max(8, vh - h - 8));
      setPos({ top, left, width: MENU_W });
    };
    place();
    // Menus are fixed-positioned: close on scroll instead of drifting away from the button.
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, sub, close]);

  // Focus the first item whenever the menu (or a submenu) opens — once it is positioned
  // (a visibility:hidden element can't take focus).
  const placed = pos.top !== undefined;
  useEffect(() => {
    if (!open || !placed) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open, sub, placed]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // don't also close a panel/dialog behind the menu
      if (sub !== null) setSub(null);
      else close(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = buttons.length;
      if (n) buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + n) % n].focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      buttons[e.key === "Home" ? 0 : buttons.length - 1]?.focus();
    } else if (e.key === "ArrowLeft" && sub !== null) {
      e.preventDefault();
      setSub(null);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const list = sub !== null ? items[sub]?.submenu ?? [] : items;

  return (
    <div className={`kebab${className ? ` ${className}` : ""}`}>
      <button
        ref={btnRef}
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (open) close(false);
          else setOpen(true);
        }}
      >
        <MoreVertical size={18} />
      </button>
      {open &&
        createPortal(
          <ul
            ref={menuRef}
            className="kebab-menu"
            role="menu"
            aria-label={sub !== null ? items[sub]?.label : label}
            style={{ position: "fixed", ...pos, visibility: pos.top === undefined ? "hidden" : undefined }}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
          >
            {sub !== null && (
              <li role="none">
                <button type="button" role="menuitem" className="menu-back" onClick={() => setSub(null)}>
                  <ChevronLeft size={15} aria-hidden="true" /> {items[sub]?.label}
                </button>
              </li>
            )}
            {sub !== null && <li role="separator" className="menu-sep" />}
            {list.map((item, idx) => (
              <li key={`${item.label}-${idx}`} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={item.danger ? "is-danger" : undefined}
                  disabled={item.disabled}
                  aria-haspopup={item.submenu ? "menu" : undefined}
                  onClick={() => {
                    if (item.submenu) {
                      setSub(idx);
                      return;
                    }
                    close(true);
                    item.onSelect?.();
                  }}
                >
                  <span className="menu-label">{item.label}</span>
                  {item.submenu && <ChevronRight size={15} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )}
    </div>
  );
}

/**
 * Icon button that toggles a small anchored panel (settings, notifications).
 * Closes on outside click / Escape (focus returns to the button).
 */
export function Popover({
  icon,
  label,
  title,
  children,
  className,
  onOpen,
}: {
  icon: ReactNode;
  label: string;
  title?: string;
  children: (close: () => void) => ReactNode;
  className?: string;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [wrapRef], close);

  useEffect(() => {
    if (!open) return;
    onOpen?.();
    panelRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div
      className={`popover-wrap${className ? ` ${className}` : ""}`}
      ref={wrapRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          btnRef.current?.focus();
        }
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className="icon-btn"
        aria-label={label}
        title={title ?? label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label={label} ref={panelRef} tabIndex={-1}>
          {children(() => {
            setOpen(false);
            btnRef.current?.focus();
          })}
        </div>
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
