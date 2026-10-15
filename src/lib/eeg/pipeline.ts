// Montage derivation + display filtering (zero-phase by default), with a small LRU cache
// so paging / sensitivity / zoom changes only re-decimate and redraw.
//
// Pure TypeScript, Node-safe.

import { applyDisplayFilters, type DisplayFilterSettings } from './dsp';
import { deriveChannels, type DerivedChannel, type DeriveOptions, type Montage } from './montages';
import type { DecodedRecording } from './recording';

/**
 * Derive `montage` from `rec` and apply the display filters (see dsp.ts) to
 * every available channel. Unavailable channels pass through untouched.
 */
export function prepareDisplayChannels(
  rec: DecodedRecording,
  montage: Montage,
  filters: DisplayFilterSettings,
  opts: DeriveOptions = {},
): DerivedChannel[] {
  const derived = deriveChannels(rec, montage, opts);
  return derived.map((ch) =>
    ch.available ? { ...ch, data: applyDisplayFilters(ch.data, filters, rec.sampleRate) } : ch,
  );
}

/** Stable cache key of a montage + filter + derive-options combination. */
export function displayKey(
  montage: Montage,
  filters: DisplayFilterSettings,
  opts: DeriveOptions = {},
): string {
  const ex = opts.excludeFromAverage ?? montage.excludeFromAverage ?? [];
  return [
    montage.id,
    montage.channels.map((c) => `${c.plus}>${c.minus}`).join(','),
    [...ex].sort().join('+'),
    filters.lffHz ?? 'off',
    filters.hffHz ?? 'off',
    filters.notchHz ?? 'off',
    filters.phase ?? 'zero',
  ].join('|');
}

export interface DisplayCache {
  /** Cached {@link prepareDisplayChannels}. */
  get(
    rec: DecodedRecording,
    montage: Montage,
    filters: DisplayFilterSettings,
    opts?: DeriveOptions,
  ): DerivedChannel[];
  clear(): void;
  /** Number of cached entries (all recordings). */
  readonly size: number;
}

/**
 * LRU cache of prepared display channels (≈ 0.6 MB per 30 s × 18 ch entry).
 * Entries are keyed by recording object identity and {@link displayKey}.
 */
export function createDisplayCache(capacity = 4): DisplayCache {
  const cap = Math.max(1, Math.floor(capacity));
  const recIds = new WeakMap<DecodedRecording, number>();
  let nextId = 1;
  const entries = new Map<string, DerivedChannel[]>();
  return {
    get(rec, montage, filters, opts = {}) {
      let id = recIds.get(rec);
      if (id === undefined) {
        id = nextId++;
        recIds.set(rec, id);
      }
      const key = `${id}#${displayKey(montage, filters, opts)}`;
      const hit = entries.get(key);
      if (hit) {
        entries.delete(key);
        entries.set(key, hit);
        return hit;
      }
      const value = prepareDisplayChannels(rec, montage, filters, opts);
      entries.set(key, value);
      while (entries.size > cap) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return value;
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
