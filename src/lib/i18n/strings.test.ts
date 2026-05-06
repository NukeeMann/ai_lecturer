import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isLocale,
  readLocale,
  stringsFor,
  strings as enStrings,
  type Strings,
} from './strings';

describe('strings — locale dictionaries', () => {
  test('default locale is English', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });

  test('isLocale narrows valid + rejects invalid values', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('pl')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });

  test('en + pl dictionaries are exposed via stringsFor()', () => {
    const en = stringsFor('en');
    const pl = stringsFor('pl');
    expect(en).toBe(enStrings); // EN export === en dictionary
    expect(en.dashboard.newCourse).toBe('New course');
    expect(pl.dashboard.newCourse).toBe('Nowy kurs');
  });

  test('PL dictionary covers every nested key from US-119', () => {
    const en = stringsFor('en');
    const pl = stringsFor('pl');
    // Walk every key path; require pl[key] to be a non-empty string for each
    // string-leaf in en, with no missing branches.
    function walk(a: unknown, b: unknown, path: string) {
      if (typeof a === 'string') {
        expect(typeof b, `pl missing leaf at ${path}`).toBe('string');
        expect((b as string).length, `pl empty at ${path}`).toBeGreaterThan(0);
        return;
      }
      expect(typeof b).toBe('object');
      expect(b).not.toBeNull();
      const aObj = a as Record<string, unknown>;
      const bObj = b as Record<string, unknown>;
      for (const k of Object.keys(aObj)) {
        expect(Object.hasOwn(bObj, k), `pl missing branch ${path}.${k}`).toBe(
          true,
        );
        walk(aObj[k], bObj[k], `${path}.${k}`);
      }
    }
    walk(en, pl, '$');
  });

  test('PL translations differ from EN for every chrome string US-119 extracted', () => {
    const en = stringsFor('en');
    const pl = stringsFor('pl');
    // Every key US-119 introduced (the ones where a Polish original existed
    // before US-119's English sweep) MUST have a distinct PL translation now.
    const expectations: Array<{ path: string; en: string; pl: string }> = [
      {
        path: 'dashboard.newCourse',
        en: en.dashboard.newCourse,
        pl: pl.dashboard.newCourse,
      },
      {
        path: 'resumeBanner.generatingPrefix',
        en: en.resumeBanner.generatingPrefix,
        pl: pl.resumeBanner.generatingPrefix,
      },
      {
        path: 'resumeBanner.inQueueSuffix',
        en: en.resumeBanner.inQueueSuffix,
        pl: pl.resumeBanner.inQueueSuffix,
      },
      {
        path: 'resumeBanner.resumeCta',
        en: en.resumeBanner.resumeCta,
        pl: pl.resumeBanner.resumeCta,
      },
      {
        path: 'generation.queuedHeading',
        en: en.generation.queuedHeading,
        pl: pl.generation.queuedHeading,
      },
      {
        path: 'generation.queuedDescription',
        en: en.generation.queuedDescription,
        pl: pl.generation.queuedDescription,
      },
      {
        path: 'generation.queuePositionPrefix',
        en: en.generation.queuePositionPrefix,
        pl: pl.generation.queuePositionPrefix,
      },
      {
        path: 'sources.heading',
        en: en.sources.heading,
        pl: pl.sources.heading,
      },
    ];
    for (const { path, en: e, pl: p } of expectations) {
      expect(e, `${path} en empty`).not.toBe('');
      expect(p, `${path} pl empty`).not.toBe('');
      expect(p, `${path} not translated`).not.toBe(e);
    }
  });
});

describe('readLocale()', () => {
  const originalWindow = (
    globalThis as unknown as { window?: typeof globalThis }
  ).window;

  function installFakeWindow(stored: string | null): void {
    const store = new Map<string, string>();
    if (stored !== null) store.set(LOCALE_STORAGE_KEY, stored);
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
      },
    };
  }

  beforeEach(() => {
    // ensure clean window between tests
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  afterEach(() => {
    if (originalWindow) {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    } else {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });

  test('returns DEFAULT_LOCALE when window is undefined (SSR)', () => {
    expect(readLocale()).toBe(DEFAULT_LOCALE);
  });

  test('returns stored locale when valid', () => {
    installFakeWindow('pl');
    expect(readLocale()).toBe('pl');
    installFakeWindow('en');
    expect(readLocale()).toBe('en');
  });

  test('falls back to default when stored value is invalid or missing', () => {
    installFakeWindow(null);
    expect(readLocale()).toBe(DEFAULT_LOCALE);
    installFakeWindow('de');
    expect(readLocale()).toBe(DEFAULT_LOCALE);
    installFakeWindow('');
    expect(readLocale()).toBe(DEFAULT_LOCALE);
  });

  test('swallows localStorage exceptions and returns default', () => {
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: vi.fn(() => {
          throw new Error('quota');
        }),
      },
    };
    expect(readLocale()).toBe(DEFAULT_LOCALE);
  });
});

// Compile-time guard: the Strings type is the shape of the EN dict.
type _StringsMatchesEn = Strings extends typeof enStrings
  ? typeof enStrings extends Strings
    ? true
    : false
  : false;
const _typeCheck: _StringsMatchesEn = true;
void _typeCheck;
