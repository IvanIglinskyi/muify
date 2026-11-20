import { useState } from "react";
import { ACCENT_COLORS, initialsOf, useAuth } from "../store/AuthContext";

/** Google photo, or initials on the chosen accent colour. Decorative: callers provide labels. */
export function UserAvatar({ size = 44, accentOverride, usePhotoOverride }: { size?: number; accentOverride?: string | null; usePhotoOverride?: boolean }) {
  const { user, me } = useAuth();
  const [broken, setBroken] = useState<string | null>(null);
  const photo = me?.photoURL ?? user?.photoURL ?? null;
  const usePhoto = usePhotoOverride ?? me?.usePhoto ?? true;
  const accent = (accentOverride !== undefined ? accentOverride : me?.accentColor) || ACCENT_COLORS[0];
  const name = me?.displayName ?? user?.displayName;
  const email = me?.email ?? user?.email;

  if (photo && usePhoto && broken !== photo) {
    return (
      <img
        className="user-avatar"
        src={photo}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBroken(photo)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="user-avatar is-initials"
      aria-hidden="true"
      style={{ width: size, height: size, background: accent, fontSize: Math.round(size * 0.38) }}
    >
      {initialsOf(name, email)}
    </span>
  );
}
