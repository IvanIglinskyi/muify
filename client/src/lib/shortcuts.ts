// Global keyboard shortcuts: which key does what, and when to stay out of the way.
// Kept free of React so it can be unit-tested.

export type ShortcutAction =
  | "toggle-play"
  | "next"
  | "prev"
  | "seek-forward"
  | "seek-back"
  | "volume-up"
  | "volume-down"
  | "mute"
  | "like"
  | "search"
  | "help";

export interface ShortcutHelp {
  keys: string[];
  label: string;
}

/** For the "?" help dialog. */
export const SHORTCUTS: ShortcutHelp[] = [
  { keys: ["Space"], label: "Play / pause" },
  { keys: ["Shift", "→"], label: "Next track" },
  { keys: ["Shift", "←"], label: "Previous track" },
  { keys: ["→"], label: "Seek forward 5 seconds" },
  { keys: ["←"], label: "Seek back 5 seconds" },
  { keys: ["↑"], label: "Volume up" },
  { keys: ["↓"], label: "Volume down" },
  { keys: ["M"], label: "Mute / unmute" },
  { keys: ["L"], label: "Like / unlike the current track" },
  { keys: ["/"], label: "Focus search" },
  { keys: ["?"], label: "Show this help" },
];

/** Input types you don't type text into. */
const NON_TEXT_INPUTS = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);

/** Typing targets: shortcuts never fire there. */
export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return (el as HTMLElement).isContentEditable === true || el.closest("[contenteditable=''],[contenteditable='true']") !== null;
}

/** Widgets that use the arrow keys themselves (sliders, menus, tabs, lists…). */
const ARROW_WIDGETS =
  "input[type=range],[role=slider],[role=menu],[role=menubar],[role=listbox],[role=tablist],[role=radiogroup],[role=grid],[role=tree],[role=spinbutton],select";

/** Elements that Space activates natively (buttons, links, switches…). */
const SPACE_TARGETS =
  "button,a[href],summary,input,select,textarea,[role=button],[role=switch],[role=checkbox],[role=menuitem],[role=tab],[role=option],[role=radio],[role=slider]";

export interface KeyLike {
  key: string;
  code?: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
}

/**
 * The action for a keydown, or null to let the browser / the focused widget handle it.
 * `target` is the focused element (event target). Letter keys also match by physical key
 * (`code`), so they work with non-Latin keyboard layouts.
 */
export function shortcutFor(e: KeyLike, target: Element | null): ShortcutAction | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTextField(target)) return null;
  // A modal (dialog) owns the keyboard while it is open.
  if (target?.closest("dialog[open]") || (typeof document !== "undefined" && document.querySelector("dialog[open]"))) return null;

  const inArrowWidget = Boolean(target?.closest(ARROW_WIDGETS));
  const code = e.code ?? "";
  switch (e.key) {
    case " ":
    case "Spacebar":
      if (target?.closest(SPACE_TARGETS)) return null;
      return "toggle-play";
    case "ArrowRight":
      if (inArrowWidget) return null;
      return e.shiftKey ? "next" : "seek-forward";
    case "ArrowLeft":
      if (inArrowWidget) return null;
      return e.shiftKey ? "prev" : "seek-back";
    case "ArrowUp":
      if (inArrowWidget || e.shiftKey) return null;
      return "volume-up";
    case "ArrowDown":
      if (inArrowWidget || e.shiftKey) return null;
      return "volume-down";
    case "?":
      return "help";
    case "/":
      return e.shiftKey ? "help" : "search";
  }
  if (code === "KeyM" || e.key === "m" || e.key === "M") return "mute";
  if (code === "KeyL" || e.key === "l" || e.key === "L") return "like";
  if (code === "Slash") return e.shiftKey ? "help" : "search";
  return null;
}

export const SEEK_STEP_S = 5;
export const VOLUME_STEP = 0.05;
