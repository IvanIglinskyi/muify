// Lightweight in-house i18n: typed flat message dictionaries, {placeholder} interpolation and
// plural forms chosen with Intl.PluralRules (Ukrainian: one / few / many / other).
// React bindings live in ./index.tsx; this file has no React so it can be used anywhere.
import { en, type MessageKey } from "./en";
import { uk } from "./uk";

export type Lang = "uk" | "en";
export const LANGS: readonly Lang[] = ["uk", "en"];

/** Plural variants of one message. `other` is required; `one`/`few`/`many` as the language needs. */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}
export type Message = string | PluralForms;
export type Dict = Record<MessageKey, Message>;

export const dictionaries: Record<Lang, Dict> = { en, uk };

/** BCP-47 locales used for Intl formatting. */
export const LOCALES: Record<Lang, string> = { en: "en-GB", uk: "uk-UA" };
/** Numbers keep the mockup's "2,523" style in English. */
export const NUMBER_LOCALES: Record<Lang, string> = { en: "en-US", uk: "uk-UA" };

export type Params = Record<string, string | number>;

const pluralRules = new Map<Lang, Intl.PluralRules>();
function pluralCategory(lang: Lang, n: number): Intl.LDMLPluralRule {
  let r = pluralRules.get(lang);
  if (!r) {
    r = new Intl.PluralRules(LOCALES[lang]);
    pluralRules.set(lang, r);
  }
  return r.select(n);
}

const numberFormats = new Map<Lang, Intl.NumberFormat>();
export function formatNumberIn(lang: Lang, n: number): string {
  let f = numberFormats.get(lang);
  if (!f) {
    f = new Intl.NumberFormat(NUMBER_LOCALES[lang]);
    numberFormats.set(lang, f);
  }
  return f.format(n);
}

/** Picks the plural form for `count` (falls back to `other`). */
export function selectPlural(lang: Lang, forms: PluralForms, count: number): string {
  const cat = pluralCategory(lang, count);
  return forms[cat] ?? forms.other;
}

/** "{name}" → params.name (numbers are locale-formatted). Unknown placeholders stay visible. */
export function interpolate(lang: Lang, text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    if (v === undefined) return m;
    return typeof v === "number" ? formatNumberIn(lang, v) : v;
  });
}

export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const msg: Message | undefined = dictionaries[lang][key] ?? dictionaries.en[key];
  if (msg === undefined) return key;
  if (typeof msg === "string") return interpolate(lang, msg, params);
  const count = typeof params?.count === "number" ? params.count : 0;
  return interpolate(lang, selectPlural(lang, msg, count), params);
}

// ---- Current language (module level, for non-React code: formatting, error texts) ----
let current: Lang = "en";
const listeners = new Set<(l: Lang) => void>();

export const getLang = (): Lang => current;

export function setCurrentLang(l: Lang) {
  if (l === current) return;
  current = l;
  listeners.forEach((fn) => fn(l));
}

export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Translate in the current language (outside components). */
export const tt = (key: MessageKey, params?: Params) => translate(current, key, params);

export const isLang = (v: unknown): v is Lang => v === "uk" || v === "en";

/** Browser default: Ukrainian for uk-*, otherwise English. */
export function browserLang(languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]): Lang {
  const first = (languages[0] ?? "").toLowerCase();
  return first === "uk" || first.startsWith("uk-") ? "uk" : "en";
}

export const LANG_STORAGE_KEY = "muify:lang";

export function storedLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

export function storeLang(l: Lang) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, l);
  } catch {
    /* private mode */
  }
}

export type { MessageKey };
