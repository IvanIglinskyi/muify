import { BookOpen, Compass, Dumbbell, Flower2, Footprints, Heart, LucideIcon, PartyPopper } from "lucide-react";

const PLAYLIST_ICONS: Record<string, LucideIcon> = {
  "p-favourites": Heart,
  "p-gym": Dumbbell,
  "p-pre-party": PartyPopper,
  "p-reading": BookOpen,
  "p-meditation": Flower2,
  "p-walk": Footprints,
};

export function playlistIcon(id: string): LucideIcon {
  return PLAYLIST_ICONS[id] ?? Compass;
}
