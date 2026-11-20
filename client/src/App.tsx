import { X } from "lucide-react";
import { useState } from "react";
import { AlbumOfTheDay } from "./components/AlbumOfTheDay";
import { AlbumsOfWeek } from "./components/AlbumsOfWeek";
import { DailyMix } from "./components/DailyMix";
import { Header } from "./components/Header";
import { PlayerBar } from "./components/PlayerBar";
import { Promo } from "./components/Promo";
import { Sidebar } from "./components/Sidebar";
import { Statistics } from "./components/Statistics";
import { LibraryProvider, useLibrary } from "./store/LibraryContext";
import { PlayerProvider } from "./store/PlayerContext";

function ErrorToast() {
  const { error, dismissError } = useLibrary();
  if (!error) return null;
  return (
    <div className="toast" role="alert">
      <span>{error}</span>
      <button type="button" className="icon-btn" aria-label="Dismiss error" onClick={dismissError}>
        <X size={16} />
      </button>
    </div>
  );
}

function Shell() {
  const [query, setQuery] = useState("");
  const [showPromo, setShowPromo] = useState(true);

  return (
    <div className="app">
      <Header query={query} onQueryChange={setQuery} />
      <Sidebar />
      <main className="main" id="main">
        <div className="row row-top">
          <AlbumOfTheDay />
          <AlbumsOfWeek />
        </div>
        <div className="row row-bottom">
          <DailyMix query={query} />
          <div className="side-col">
            {showPromo && <Promo onClose={() => setShowPromo(false)} />}
            <Statistics />
          </div>
        </div>
      </main>
      <PlayerBar />
      <ErrorToast />
    </div>
  );
}

export default function App() {
  return (
    <LibraryProvider>
      <PlayerProvider>
        <Shell />
      </PlayerProvider>
    </LibraryProvider>
  );
}
