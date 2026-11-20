// React bindings for the in-house i18n (see ./core.ts).
import { createContext, Fragment, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  browserLang,
  getLang,
  LOCALES,
  setCurrentLang,
  storedLang,
  storeLang,
  translate,
  type Lang,
  type MessageKey,
  type Params,
} from "./core";

export type TFunction = (key: MessageKey, params?: Params) => string;

interface I18nApi {
  lang: Lang;
  /** BCP-47 locale for Intl APIs ("uk-UA" / "en-GB"). */
  locale: string;
  t: TFunction;
  /** Switches the UI language (persisted in localStorage; the account is synced by LanguageSync). */
  setLang: (l: Lang) => void;
}

const fallback: I18nApi = {
  lang: "en",
  locale: LOCALES.en,
  t: (key, params) => translate("en", key, params),
  setLang: () => {},
};

// Without a provider (unit tests of single components) everything renders in English.
const I18nContext = createContext<I18nApi>(fallback);

export function initialLang(): Lang {
  return storedLang() ?? browserLang();
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const l = initial ?? initialLang();
    setCurrentLang(l);
    return l;
  });

  useEffect(() => {
    setCurrentLang(lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    storeLang(l);
    setCurrentLang(l); // before re-render: formatting helpers read the module-level language
    setLangState(l);
  }, []);

  const value = useMemo<I18nApi>(
    () => ({ lang, locale: LOCALES[lang], t: (key, params) => translate(lang, key, params), setLang }),
    [lang, setLang]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nApi {
  return useContext(I18nContext);
}

export function useT(): TFunction {
  return useContext(I18nContext).t;
}

/**
 * A message with React nodes in its placeholders: <Trans k="verify.text" values={{ email: <strong>…</strong> }} />.
 * String/number values are interpolated as text.
 */
export function Trans({ k, values = {} }: { k: MessageKey; values?: Record<string, ReactNode> }) {
  const { lang } = useI18n();
  const plain: Params = {};
  for (const [name, v] of Object.entries(values)) if (typeof v === "string" || typeof v === "number") plain[name] = v;
  const text = translate(lang, k, plain);
  const parts = text.split(/(\{\w+\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{(\w+)\}$/.exec(part);
        return <Fragment key={i}>{m && values[m[1]] !== undefined ? values[m[1]] : part}</Fragment>;
      })}
    </>
  );
}

export { getLang, tt } from "./core";
export type { Lang, MessageKey };
