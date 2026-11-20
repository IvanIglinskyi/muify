import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../types";
import { TrackTable } from "./TrackTable";

const player = {
  current: null as Track | null,
  isPlaying: false,
  playTrack: vi.fn(),
  togglePlay: vi.fn(),
};
const library = { toggleTrackLike: vi.fn() };

vi.mock("../store/PlayerContext", () => ({ usePlayer: () => player }));
vi.mock("../store/LibraryContext", () => ({ useLibrary: () => library }));
vi.mock("./useTrackMenu", () => ({
  useTrackMenu: () => () => [{ label: "Play" }],
  attributionItems: () => [],
}));

const track = (id: string, title: string, artist: string, artistId?: string): Track => ({
  id,
  title,
  artist,
  artistId,
  album: "Album",
  duration: 200,
  liked: false,
  genres: [],
  plays: 0,
  source: "seed",
});

const tracks = [track("t1", "First", "Ann", "sa-ann"), track("t2", "Second", "Bob"), track("t3", "Third", "Cy", "sa-cy")];

function renderTable(props: Partial<Parameters<typeof TrackTable>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<TrackTable tracks={tracks} caption="Test tracks" {...props} />} />
        <Route path="/artist/:id" element={<p>Artist page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  player.current = null;
  player.isPlaying = false;
});
afterEach(cleanup);

describe("TrackTable", () => {
  it("renders one row per track with title, artist and time", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Test tracks" });
    expect(within(table).getAllByRole("row")).toHaveLength(1 + tracks.length);
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getAllByText("3:20m")).toHaveLength(3);
  });

  it("plays a track with the visible list as queue", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Play Second by Bob" }));
    expect(player.playTrack).toHaveBeenCalledWith("t2", ["t1", "t2", "t3"]);
  });

  it("toggles instead of restarting the current track", () => {
    player.current = tracks[0];
    player.isPlaying = true;
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Pause First by Ann" }));
    expect(player.togglePlay).toHaveBeenCalled();
    expect(player.playTrack).not.toHaveBeenCalled();
  });

  it("artist names are separate links that don't start playback", () => {
    renderTable();
    const link = screen.getByRole("link", { name: "Ann" });
    expect(link.getAttribute("href")).toBe("/artist/sa-ann");
    expect(screen.queryByRole("link", { name: "Bob" })).toBeNull(); // no artist id → plain text
    fireEvent.click(link);
    expect(player.playTrack).not.toHaveBeenCalled();
    expect(screen.getByText("Artist page")).toBeTruthy();
  });

  it("offers Move up / Move down in the menu when reordering is enabled", () => {
    const onMove = vi.fn();
    renderTable({ reorder: { onMove } });
    fireEvent.click(screen.getByRole("button", { name: "More options for Second" }));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Move down" }));
    expect(onMove).toHaveBeenCalledWith(1, 2);

    fireEvent.click(screen.getByRole("button", { name: "More options for First" }));
    const up = within(screen.getByRole("menu")).getByRole("menuitem", { name: "Move up" }) as HTMLButtonElement;
    expect(up.disabled).toBe(true);
  });

  it("reorders by drag and drop", () => {
    const onMove = vi.fn();
    renderTable({ reorder: { onMove } });
    const rows = screen.getAllByRole("row").slice(1);
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(rows[2], { dataTransfer });
    fireEvent.dragOver(rows[0], { dataTransfer });
    fireEvent.drop(rows[0], { dataTransfer });
    expect(onMove).toHaveBeenCalledWith(2, 0);
    // A drop that didn't start in this table (e.g. a file) is ignored.
    onMove.mockClear();
    fireEvent.drop(rows[1], { dataTransfer });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("shows the empty message", () => {
    render(
      <MemoryRouter>
        <TrackTable tracks={[]} empty="Nothing here" />
      </MemoryRouter>
    );
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });
});
