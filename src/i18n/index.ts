import { en, type Dictionary, type TranslationKey } from "./en";
import { de } from "./de";

/**
 * Languages.
 *
 * English is default and fallback; the browser language is not consulted.
 * Every locale is typed against English, so a missing key shows up at build
 * time.
 *
 * What gets saved is language-independent: `tIn("en", ...)` for anything that
 * goes into the manifest.
 */

export type Locale = "en" | "de";

const DICTIONARIES: Record<Locale, Dictionary> = { en, de };

/** Display names in each language's own words, so anyone can find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
};

export const LOCALES = Object.keys(DICTIONARIES) as Locale[];

const FALLBACK: Locale = "en";
const STORAGE_KEY = "guided-face-capture.locale";

let current: Locale = FALLBACK;
const listeners = new Set<() => void>();

function isLocale(value: string): value is Locale {
  return (LOCALES as string[]).includes(value);
}

/**
 * The chosen language, otherwise English. `navigator.languages` is not
 * consulted - if it should be, this is where it goes.
 */
function detect(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isLocale(stored)) return stored;
  } catch {
    // No storage: fall back to the default.
  }
  return FALLBACK;
}

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

/** Translates into the current display language. */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  return fill(DICTIONARIES[current][key] ?? en[key], vars);
}

/** Translates into a given language - for anything that gets saved. */
export function tIn(
  locale: Locale,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  return fill(DICTIONARIES[locale][key] ?? en[key], vars);
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Not storable - then it applies to this page view only.
  }
  document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

/** Fires on every language change. Returns the unsubscribe function. */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Fills the texts in the markup.
 *
 * `data-i18n` sets text content, `data-i18n-title` the tooltip. The attributes
 * stay in the HTML so the same place can be refilled on a language change.
 */
export function applyTranslations(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = node.dataset["i18n"];
    if (key) node.textContent = t(key as TranslationKey);
  }
  for (const node of root.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    const key = node.dataset["i18nTitle"];
    if (key) node.title = t(key as TranslationKey);
  }
  document.title = `${t("app.title")} - ${t("app.tag")}`;
}

export function initLocale(): void {
  current = detect();
  document.documentElement.lang = current;
}

export type { TranslationKey };
