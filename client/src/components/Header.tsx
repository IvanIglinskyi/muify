import { Bell, Search, Settings } from "lucide-react";
import { Logo } from "./common";

interface HeaderProps {
  query: string;
  onQueryChange: (q: string) => void;
}

export function Header({ query, onQueryChange }: HeaderProps) {
  return (
    <header className="app-header">
      <a href="/" className="brand" aria-label="Muify home">
        <Logo />
      </a>
      <div className="header-right">
        <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            placeholder="Navigate"
            aria-label="Search tracks in Daily Mix"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </form>
        <button type="button" className="icon-btn" aria-label="Notifications">
          <Bell size={20} />
        </button>
        <button type="button" className="icon-btn" aria-label="Settings">
          <Settings size={20} />
        </button>
        <button type="button" className="avatar" aria-label="Account">
          <span aria-hidden="true">AK</span>
        </button>
      </div>
    </header>
  );
}
