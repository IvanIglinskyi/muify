import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../types";
import { KeyboardShortcuts } from "./KeyboardShortcuts";

const current: Track = {
  id: "t1",
  title: "Song",
  artist: "Ann",
  album: "A",
  duration: 200,
  liked: false,
  genres: [],
  plays: 0,
  source: "seed",
};

const player = {
  current: current as Track | null,
  isPlaying: false,
  duration: 200,
  volume: 0.5,
  muted: false,
  togglePlay: vi.fn(),
  next: vi.fn(),
  prev: vi.fn(),
  seekBy: vi.fn(),
  setVolume: vi.fn(),
  toggleMute: vi.fn(),
};
const library = { toggleTrackLike: vi.fn(), tracks: { t1: current } };

vi.mock("../store/PlayerContext", () => ({ usePlayer: () => player, usePlaybackPosition: () => 42 }));
vi.mock("../store/LibraryContext", () => ({ useLibrary: () => library }));

const press = (key: string, init: KeyboardEventInit = {}, target: Element = document.body) =>
  act(() => {
    fireEvent.keyDown(target, { key, ...init });
  });

beforeEach(() => {
  player.current = current;
  render(
    <>
      <header className="app-header">
        <form className="search">
          <input type="search" aria-label="Search" />
        </form>
      </header>
      <input type="range" aria-label="Volume" />
      <KeyboardShortcuts />
    </>
  );
});
afterEach(cleanup);

describe("KeyboardShortcuts", () => {
  it("controls the player", () => {
    press(" ");
    expect(player.togglePlay).toHaveBeenCalledTimes(1);
    press("ArrowRight", { shiftKey: true });
    expect(player.next).toHaveBeenCalled();
    press("ArrowLeft", { shiftKey: true });
    expect(player.prev).toHaveBeenCalled();
    press("ArrowRight");
    expect(player.seekBy).toHaveBeenCalledWith(5);
    press("ArrowLeft");
    expect(player.seekBy).toHaveBeenCalledWith(-5);
    press("ArrowUp");
    expect(player.setVolume).toHaveBeenCalledWith(0.55);
    press("ArrowDown");
    expect(player.setVolume).toHaveBeenCalledWith(0.45);
    press("m");
    expect(player.toggleMute).toHaveBeenCalled();
    press("l");
    expect(library.toggleTrackLike).toHaveBeenCalledWith("t1");
  });

  it("shows a short confirmation", () => {
    press("ArrowUp");
    expect(screen.getByRole("status").textContent).toBe("Volume 55%");
  });

  it("does nothing while typing, and leaves arrows to sliders", () => {
    const search = screen.getByRole("searchbox");
    press(" ", {}, search);
    press("m", {}, search);
    expect(player.togglePlay).not.toHaveBeenCalled();
    expect(player.toggleMute).not.toHaveBeenCalled();
    press("ArrowRight", {}, screen.getByRole("slider"));
    expect(player.seekBy).not.toHaveBeenCalled();
  });

  it("focuses search with /", () => {
    press("/");
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  it("opens the help dialog with ?", () => {
    press("?", { shiftKey: true });
    // (jsdom has no showModal(): query the dialog's content directly, not via the a11y tree.)
    const dialog = document.querySelector("dialog.shortcuts-modal");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("shortcuts-title");
    expect(dialog?.querySelector("h2")?.textContent).toContain("Keyboard shortcuts");
    expect(screen.getByText("Like / unlike the current track")).toBeTruthy();
    expect(dialog?.querySelectorAll("kbd").length).toBeGreaterThan(10);
  });

  it("lets the page scroll when nothing is loaded", () => {
    player.current = null;
    const ev = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(false);
    expect(player.togglePlay).not.toHaveBeenCalled();
  });
});
