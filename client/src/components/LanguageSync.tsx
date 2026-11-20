// Keeps the UI language in step with the account: a signed-in listener's saved language wins on
// sign-in; switching the language saves it to the account (server profile) and to localStorage.
import { useCallback, useEffect, useRef } from "react";
import { api } from "../api";
import { useI18n, type Lang } from "../i18n";
import { firebaseAuth } from "../lib/firebase";
import { useAuth } from "../store/AuthContext";

export function LanguageSync() {
  const { me } = useAuth();
  const { lang, setLang } = useI18n();
  const appliedFor = useRef<string | null>(null);

  // The account's language, once per signed-in user (later changes come from this client).
  useEffect(() => {
    if (!me) {
      appliedFor.current = null;
      return;
    }
    if (appliedFor.current === me.uid) return;
    appliedFor.current = me.uid;
    if (me.language && me.language !== lang) setLang(me.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  // Firebase emails (verification, password reset) in the same language.
  useEffect(() => {
    if (firebaseAuth) firebaseAuth.languageCode = lang;
  }, [lang]);

  return null;
}

/** Switches the language and remembers it (account for members, this browser for everyone). */
export function useChangeLanguage() {
  const { setLang } = useI18n();
  const { phase, setMe } = useAuth();
  return useCallback(
    (l: Lang) => {
      setLang(l);
      if (phase === "user" || phase === "local") {
        api.updateMe({ language: l }).then(
          (m) => phase === "user" && setMe(m),
          () => {
            /* kept locally anyway */
          }
        );
      }
    },
    [setLang, phase, setMe]
  );
}

/** Radio-button language switch (Settings menu and /account). */
export function LanguageSwitch({ compact }: { compact?: boolean }) {
  const { lang, t } = useI18n();
  const change = useChangeLanguage();
  const options: Lang[] = ["uk", "en"];
  return (
    <div
      className={`lang-switch${compact ? " is-compact" : ""}`}
      role="radiogroup"
      aria-label={t("lang.label")}
      onKeyDown={(e) => {
        // Radio group keyboard pattern: arrows move (and select) between the options.
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
        e.preventDefault();
        const i = options.indexOf(lang);
        const next = options[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + options.length) % options.length];
        const group = e.currentTarget;
        change(next);
        window.requestAnimationFrame(() => group.querySelector<HTMLElement>(`[lang="${next}"]`)?.focus());
      }}
    >
      {options.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          tabIndex={lang === l ? 0 : -1}
          lang={l}
          className={`lang-option${lang === l ? " is-on" : ""}`}
          onClick={() => lang !== l && change(l)}
        >
          {t(l === "uk" ? "lang.uk" : "lang.en")}
        </button>
      ))}
    </div>
  );
}
