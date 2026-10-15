// Progress persistence for the EEG widgets: PATCH /api/progress with the
// FULL section state (`{ done, widgetState, score }`).
//
// The server replaces the whole per-section object on every PATCH, so a
// partial `{ widgetState }` would wipe `done`. Always send everything.
// Nothing is written when `progressKey` is absent (static export, previews).
//
// No React here (see useWidgetProgress.ts for the hook).

import type { ZodType } from 'zod';

import type { EegProgressKey } from './types';

/** Mirrors MAX_WIDGET_STATE_CHARS in src/lib/server/progress.ts (server rejects larger). */
export const WIDGET_STATE_MAX_CHARS = 64 * 1024;

/** Debounce for settings-only changes (spec: ≥ 800 ms). */
export const SETTINGS_SAVE_DEBOUNCE_MS = 800;

export interface WidgetProgress {
  done: boolean;
  /** Widget-owned JSON; version it yourself, e.g. `{ v: 1, … }`. */
  widgetState?: Record<string, unknown>;
  /** Integer counts (e.g. correct first attempts / gradable steps). */
  score?: { correct: number; total: number };
}

export interface SaveOptions {
  /** Use `keepalive` (page unload). */
  keepalive?: boolean;
  /** Injected fetch (tests). */
  fetchImpl?: typeof fetch;
}

/** Build the PATCH body (exported for tests / custom transports). */
export function buildProgressPatch(key: EegProgressKey, state: WidgetProgress): Record<string, unknown> {
  const section: Record<string, unknown> = { done: state.done === true };
  if (state.widgetState) {
    const size = JSON.stringify(state.widgetState).length;
    if (size <= WIDGET_STATE_MAX_CHARS) section.widgetState = state.widgetState;
    else if (typeof console !== 'undefined') {
      // Keep completion/score rather than have the server reject the whole PATCH.
      console.warn(`[eeg] widgetState is ${size} chars (limit ${WIDGET_STATE_MAX_CHARS}); saving without it`);
    }
  }
  if (state.score) {
    const correct = Math.max(0, Math.round(state.score.correct));
    const total = Math.max(correct, Math.round(state.score.total));
    section.score = { correct, total };
  }
  return {
    courseSlug: key.courseSlug,
    lessonSlug: key.lessonSlug,
    sectionState: { [key.sectionId]: section },
  };
}

/**
 * Persist the full section state. Resolves `true` when the server accepted
 * it; never throws (persistence is non-fatal). No-op without a key.
 */
export async function saveWidgetProgress(
  key: EegProgressKey | null | undefined,
  state: WidgetProgress,
  opts: SaveOptions = {},
): Promise<boolean> {
  if (!key) return false;
  const doFetch = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return false;
  try {
    const res = await doFetch('/api/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildProgressPatch(key, state)),
      keepalive: opts.keepalive,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ProgressSaver {
  /** Debounced save (latest state wins). */
  save(key: EegProgressKey | null | undefined, state: WidgetProgress): void;
  /** Immediate save; cancels any pending debounced save. */
  saveNow(key: EegProgressKey | null | undefined, state: WidgetProgress, opts?: SaveOptions): Promise<boolean>;
  /** Send a pending debounced save now (e.g. on unmount / pagehide). */
  flush(opts?: SaveOptions): Promise<boolean>;
  cancel(): void;
  readonly pending: boolean;
}

/** Debouncing wrapper around {@link saveWidgetProgress}. */
export function createProgressSaver(delayMs = SETTINGS_SAVE_DEBOUNCE_MS, base: SaveOptions = {}): ProgressSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { key: EegProgressKey; state: WidgetProgress } | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flush = async (opts: SaveOptions = {}) => {
    clear();
    const p = pending;
    pending = null;
    return p ? saveWidgetProgress(p.key, p.state, { ...base, ...opts }) : false;
  };
  return {
    save(key, state) {
      if (!key) return;
      pending = { key, state };
      clear();
      timer = setTimeout(() => void flush(), delayMs);
    },
    saveNow(key, state, opts = {}) {
      clear();
      pending = null;
      return saveWidgetProgress(key, state, { ...base, ...opts });
    },
    flush,
    cancel() {
      clear();
      pending = null;
    },
    get pending() {
      return pending !== null;
    },
  };
}

/** Validate persisted widget state (unknown JSON) against the widget's schema; null if absent/invalid. */
export function parseWidgetState<T>(raw: unknown, schema: ZodType<T>): T | null {
  if (raw === null || raw === undefined) return null;
  const r = schema.safeParse(raw);
  return r.success ? r.data : null;
}
