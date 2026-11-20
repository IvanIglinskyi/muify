import { Bell, Search, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { Logo } from "./common";

interface HeaderProps {
  query: string;
  onQueryChange: (q: string) => void;
  /** Accessible name of the search box; depends on what the current page searches. */
  searchLabel: string;
}

export function Header({ query, onQueryChange, searchLabel }: HeaderProps) {
  return (
    <header className="app-header">
      <Link to="/" className="brand" aria-label="Muify home">
        <Logo />
      </Link>
      <div className="header-right">
        <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            placeholder="Navigate"
            aria-label={searchLabel}
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
