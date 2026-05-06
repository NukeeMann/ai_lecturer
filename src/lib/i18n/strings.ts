/**
 * Single source-of-truth for chrome / UI strings.
 *
 * Course content (lesson titles, widget content, generated text) is NOT
 * stored here — that comes from the per-course JSON authored at generation
 * time and is intentionally allowed to be in any language.
 *
 * Introduced in US-119 to consolidate hard-coded UI strings; expanded in
 * US-121 with a Polish (pl) dictionary and a locale-aware lookup so the
 * Settings Language toggle can swap the language at runtime.
 */
import { useEffect, useState } from 'react';

export type Locale = 'en' | 'pl';

export const LOCALES: readonly Locale[] = ['en', 'pl'] as const;
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'aiLecturer.locale';
// Dispatched by SettingsMenu whenever the locale changes so co-resident
// components subscribed via useLocaleStrings can re-read the persisted value
// within the same tab. (The native `storage` event only fires across tabs.)
export const LOCALE_CHANGE_EVENT = 'aiLecturer:locale-change';

const en = {
  dashboard: {
    newCourse: 'New course',
  },
  resumeBanner: {
    generatingPrefix: 'Generating course',
    inQueueSuffix: 'in queue',
    resumeCta: 'Back to generation',
  },
  generation: {
    queuedHeading: 'Your generation is queued',
    queuedDescription:
      'Another course is currently being generated. Yours will start automatically as soon as that one finishes.',
    queuePositionPrefix: 'In queue —',
  },
  sources: {
    heading: 'Sources',
  },
  settings: {
    languageGroupLabel: 'Language',
    languageOptionEn: 'English',
    languageOptionPl: 'Polski',
  },
} as const;

type WidenStringLeaves<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends Record<string, unknown>
      ? WidenStringLeaves<T[K]>
      : T[K];
};

export type Strings = WidenStringLeaves<typeof en>;

const pl: Strings = {
  dashboard: {
    newCourse: 'Nowy kurs',
  },
  resumeBanner: {
    generatingPrefix: 'Trwa generacja kursu',
    inQueueSuffix: 'w kolejce',
    resumeCta: 'Wróć do generacji',
  },
  generation: {
    queuedHeading: 'Twoja generacja czeka w kolejce',
    queuedDescription:
      'Inny kurs jest właśnie generowany. Twój start nastąpi automatycznie, gdy tamten się zakończy.',
    queuePositionPrefix: 'W kolejce —',
  },
  sources: {
    heading: 'Źródła',
  },
  settings: {
    languageGroupLabel: 'Język',
    languageOptionEn: 'English',
    languageOptionPl: 'Polski',
  },
};

const DICTIONARIES: Record<Locale, Strings> = { en, pl };

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'pl';
}

export function stringsFor(locale: Locale): Strings {
  return DICTIONARIES[locale];
}

export function readLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const v = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(v)) return v;
  } catch {
    // localStorage may be unavailable; fall through to default.
  }
  return DEFAULT_LOCALE;
}

/**
 * Static EN export retained so call sites that don't yet (or shouldn't)
 * subscribe to runtime locale changes — e.g. server-rendered surfaces, tests
 * — still get a sensible default. Client components that need the live locale
 * should call useLocaleStrings() instead.
 */
export const strings: Strings = en;

/**
 * Subscribe a client component to the active locale.
 *
 * - Returns the dictionary matching the persisted locale (falls back to EN).
 * - On mount, re-reads from localStorage so SSR-default state replaces
 *   correctly (avoiding flash); afterwards listens for LOCALE_CHANGE_EVENT
 *   (same-tab) and the native `storage` event (cross-tab).
 */
export function useLocaleStrings(): Strings {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocale(readLocale());
    function refresh() {
      setLocale(readLocale());
    }
    window.addEventListener(LOCALE_CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(LOCALE_CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return stringsFor(locale);
}
