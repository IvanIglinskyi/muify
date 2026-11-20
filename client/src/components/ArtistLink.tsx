import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n";

export const artistPath = (id: string) => `/artist/${encodeURIComponent(id)}`;

interface ArtistLinkProps {
  name: string;
  /** Artist page id; without one the name is plain text. */
  id?: string | null;
  className?: string;
  children?: ReactNode;
}

/**
 * Artist name that opens the artist page. It is its own click/focus target: clicks don't bubble
 * to a surrounding row or card (rows play on click, cards open the album).
 */
export function ArtistLink({ name, id, className, children }: ArtistLinkProps) {
  const t = useT();
  const cls = ["artist-link", className].filter(Boolean).join(" ");
  if (!id) return <span className={className}>{children ?? name}</span>;
  return (
    <Link
      to={artistPath(id)}
      className={cls}
      title={`${t("menu.goToArtist")}: ${name}`}
      onClick={(e: MouseEvent) => e.stopPropagation()}
    >
      {children ?? name}
    </Link>
  );
}
