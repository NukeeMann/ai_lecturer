// Auto-mark a static section as "done" once the learner has actually had it
// on screen for a beat. Pattern mirrors what Coursera / Udemy do for reading
// material: an IntersectionObserver detects when the section is N% in the
// viewport, and a short dwell timer makes sure a fast scroll doesn't count
// as "viewed".
//
// Interactive widgets (quiz, code, dragMatch, codeCloze, transcriptCloze)
// already fire their own `onComplete` callback from a real success signal —
// they do NOT use this hook.

import { useEffect, type RefObject } from 'react';

interface Opts {
  /** When false, the observer is not installed (e.g. section already done). */
  enabled: boolean;
  /** Called once when the dwell condition is satisfied. */
  onComplete: () => void;
  /** Viewport fraction required to count as "visible" (0..1). */
  threshold: number;
  /** Time the section must stay continuously visible before firing (ms). */
  minVisibleMs: number;
  /** Ref to the section's outer DOM node. */
  ref: RefObject<HTMLElement | null>;
}

export function useAutoCompleteOnView({
  enabled,
  onComplete,
  threshold,
  minVisibleMs,
  ref,
}: Opts) {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return; // old browser fallback: no-op

    let timer: ReturnType<typeof setTimeout> | null = null;
    let fired = false;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const visibleEnough =
            entry.isIntersecting && entry.intersectionRatio >= threshold;

          if (visibleEnough && !timer && !fired) {
            timer = setTimeout(() => {
              fired = true;
              onComplete();
              io.disconnect();
            }, minVisibleMs);
          } else if (!visibleEnough && timer) {
            // Scrolled away before the dwell elapsed — reset.
            clearTimeout(timer);
            timer = null;
          }
        }
      },
      { threshold: [threshold] },
    );

    io.observe(el);

    return () => {
      if (timer) clearTimeout(timer);
      io.disconnect();
    };
    // `onComplete` is a stable useCallback in SectionView; including it keeps
    // the lints happy without causing churn.
  }, [enabled, onComplete, threshold, minVisibleMs, ref]);
}
