import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";

/** State owned by the persistent app shell and handed to pages via <Outlet context>. */
export interface ShellContext {
  /** Raw text of the header "Navigate" search box. */
  query: string;
  showPromo: boolean;
  closePromo: () => void;
}

export function useShell(): ShellContext {
  return useOutletContext<ShellContext>();
}

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Muify` : "Muify";
  }, [title]);
}

/** Case-insensitive "contains" across several fields. */
export function matchesQuery(q: string, ...fields: string[]): boolean {
  const needle = q.trim().toLowerCase();
  return !needle || fields.join(" ").toLowerCase().includes(needle);
}
