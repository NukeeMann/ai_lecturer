// US-109 — pure helpers for the Stage-5 lesson progress slider on
// `src/app/create/page.tsx`. Kept separate from the page so vitest (node
// env, *.test.ts only) can cover them without rendering React.

export type LessonSlotStatus = 'pending' | 'started' | 'done' | 'error';

/**
 * Filter the slider input down to slots that are visible to the user.
 * AC: pending / not-yet-started lessons are hidden; only 'started', 'done',
 * and 'error' slots remain. Order is preserved so `index` labels still line
 * up with the source curriculum.
 */
export function visibleLessonSlots<T extends { slug: string }>(
  lessons: ReadonlyArray<T>,
  statuses: ReadonlyMap<string, LessonSlotStatus>,
): T[] {
  const out: T[] = [];
  for (const lesson of lessons) {
    const status = statuses.get(lesson.slug) ?? 'pending';
    if (status === 'pending') continue;
    out.push(lesson);
  }
  return out;
}

/**
 * Compute whether the slider's horizontal scroll position is at the start
 * or the end (used to disable the L/R arrow buttons). A small tolerance
 * absorbs sub-pixel rounding from `scrollIntoView({behavior:'smooth'})`.
 */
export function computeSliderEdges(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  tolerance = 2,
): { atStart: boolean; atEnd: boolean } {
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  if (maxScroll <= tolerance) {
    return { atStart: true, atEnd: true };
  }
  return {
    atStart: scrollLeft <= tolerance,
    atEnd: scrollLeft >= maxScroll - tolerance,
  };
}
