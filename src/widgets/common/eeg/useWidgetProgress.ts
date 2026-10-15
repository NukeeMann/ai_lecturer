'use client';

// React wrapper around progress.ts:
//   const progress = useWidgetProgress(progressKey);
//   progress.saveNow({ done: true, widgetState, score });   // on Check/Submit
//   progress.saveDebounced({ done, widgetState });           // settings changes (≥ 800 ms)
// A pending debounced save is flushed on unmount and on `pagehide`.
// Without a progressKey (static export, previews) nothing is written.

import { useEffect, useMemo, useRef } from 'react';

import { createProgressSaver, SETTINGS_SAVE_DEBOUNCE_MS, type WidgetProgress } from './progress';
import type { EegProgressKey } from './types';

export interface UseWidgetProgressResult {
  saveNow(state: WidgetProgress): Promise<boolean>;
  saveDebounced(state: WidgetProgress): void;
  flush(): Promise<boolean>;
  /** True when a progressKey is present (i.e. saving is possible). */
  enabled: boolean;
}

export function useWidgetProgress(
  progressKey: EegProgressKey | null | undefined,
  delayMs = SETTINGS_SAVE_DEBOUNCE_MS,
): UseWidgetProgressResult {
  const saver = useMemo(() => createProgressSaver(delayMs), [delayMs]);
  const keyRef = useRef(progressKey);
  useEffect(() => {
    keyRef.current = progressKey;
  }, [progressKey]);

  useEffect(() => {
    const onHide = () => {
      if (saver.pending) void saver.flush({ keepalive: true });
    };
    if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide);
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide);
      if (saver.pending) void saver.flush({ keepalive: true });
    };
  }, [saver]);

  const courseSlug = progressKey?.courseSlug;
  const lessonSlug = progressKey?.lessonSlug;
  const sectionId = progressKey?.sectionId;
  return useMemo(
    () => ({
      saveNow: (state: WidgetProgress) => saver.saveNow(keyRef.current, state),
      saveDebounced: (state: WidgetProgress) => saver.save(keyRef.current, state),
      flush: () => saver.flush(),
      enabled: !!(courseSlug && lessonSlug && sectionId),
    }),
    [saver, courseSlug, lessonSlug, sectionId],
  );
}
