import { afterEach, describe, expect, it } from "vitest";
import { isTextField, shortcutFor, type KeyLike } from "./shortcuts";

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("shortcutFor", () => {
  it("maps the documented keys when focus is on the page", () => {
    const body = document.body;
    expect(shortcutFor(key(" "), body)).toBe("toggle-play");
    expect(shortcutFor(key("ArrowRight", { shiftKey: true }), body)).toBe("next");
    expect(shortcutFor(key("ArrowLeft", { shiftKey: true }), body)).toBe("prev");
    expect(shortcutFor(key("ArrowRight"), body)).toBe("seek-forward");
    expect(shortcutFor(key("ArrowLeft"), body)).toBe("seek-back");
    expect(shortcutFor(key("ArrowUp"), body)).toBe("volume-up");
    expect(shortcutFor(key("ArrowDown"), body)).toBe("volume-down");
    expect(shortcutFor(key("m"), body)).toBe("mute");
    expect(shortcutFor(key("L", { shiftKey: true }), body)).toBe("like");
    expect(shortcutFor(key("/"), body)).toBe("search");
    expect(shortcutFor(key("?", { shiftKey: true }), body)).toBe("help");
    expect(shortcutFor(key("x"), body)).toBeNull();
  });

  it("works with non-Latin layouts via the physical key", () => {
    expect(shortcutFor(key("ь", { code: "KeyM" }), document.body)).toBe("mute");
    expect(shortcutFor(key("д", { code: "KeyL" }), document.body)).toBe("like");
    expect(shortcutFor(key(".", { code: "Slash" }), document.body)).toBe("search");
    expect(shortcutFor(key(",", { code: "Slash", shiftKey: true }), document.body)).toBe("help");
  });

  it("never fires in text fields", () => {
    for (const html of ['<input type="search">', "<textarea></textarea>", '<div contenteditable="true"></div>', '<input type="email">']) {
      const el = mount(html);
      expect(isTextField(el), html).toBe(true);
      expect(shortcutFor(key(" "), el)).toBeNull();
      expect(shortcutFor(key("m"), el)).toBeNull();
      expect(shortcutFor(key("/"), el)).toBeNull();
    }
  });

  it("leaves arrows to sliders and menus, Space to buttons", () => {
    const range = mount('<input type="range">');
    expect(isTextField(range)).toBe(false);
    expect(shortcutFor(key("ArrowRight"), range)).toBeNull();
    expect(shortcutFor(key("ArrowUp"), range)).toBeNull();
    expect(shortcutFor(key("m"), range)).toBe("mute");

    const item = mount('<ul role="menu"><li><button role="menuitem">Play</button></li></ul>').querySelector("button")!;
    expect(shortcutFor(key("ArrowDown"), item)).toBeNull();
    expect(shortcutFor(key(" "), item)).toBeNull();

    const button = mount("<button>Play</button>");
    expect(shortcutFor(key(" "), button)).toBeNull();
    expect(shortcutFor(key("ArrowRight"), button)).toBe("seek-forward");
  });

  it("ignores modified keys, handled events and open dialogs", () => {
    expect(shortcutFor(key("ArrowRight", { ctrlKey: true }), document.body)).toBeNull();
    expect(shortcutFor(key("m", { metaKey: true }), document.body)).toBeNull();
    expect(shortcutFor(key(" ", { defaultPrevented: true }), document.body)).toBeNull();
    mount("<dialog open><p>Hi</p></dialog>");
    expect(shortcutFor(key(" "), document.body)).toBeNull();
  });
});
