import type { Course } from '@/lib/schemas/course';
import type { Lesson } from '@/lib/schemas/lesson';
import type { LessonProgress, SectionState } from '@/lib/schemas/progress';

export type SectionDoneFlags = {
  persistedSectionState?: LessonProgress['sectionState'];
  manuallyCompleted?: LessonProgress['manuallyCompletedSections'];
  liveAutoDone?: Record<string, boolean>;
};

export function isSectionDone(
  sectionId: string,
  flags: SectionDoneFlags,
): boolean {
  if (flags.persistedSectionState?.[sectionId]?.done === true) return true;
  if (flags.manuallyCompleted?.[sectionId] === true) return true;
  if (flags.liveAutoDone?.[sectionId] === true) return true;
  return false;
}

export function areAllSectionsDone(
  lesson: Pick<Lesson, 'sections'>,
  flags: SectionDoneFlags,
): boolean {
  if (lesson.sections.length === 0) return false;
  return lesson.sections.every((s) => isSectionDone(s.id, flags));
}

export function countDoneSections(
  lesson: Pick<Lesson, 'sections'>,
  flags: SectionDoneFlags,
): { total: number; done: number } {
  const total = lesson.sections.length;
  let done = 0;
  for (const s of lesson.sections) {
    if (isSectionDone(s.id, flags)) done += 1;
  }
  return { total, done };
}

export type AutoAdvancePersistencePatch = {
  status: 'finished';
  sectionState: Record<string, { done: true }>;
};

/**
 * Computes the per-lesson progress patch to send when the auto-advance handler
 * fires (US-081). Marks the lesson `finished` and ensures every section that
 * is currently considered done — by any in-memory source — is persisted with
 * `done: true`, so re-entering the lesson keeps the completed state. Sections
 * already persisted as done are skipped to avoid redundant writes.
 *
 * `sectionState` lists only the fields to SET. Apply it as a per-section
 * merge — locally with `mergeSectionStates`, on the server via
 * `autoAdvanceRequestBody` (`mergeSectionState`) — never as a replacement:
 * widgets persist `widgetState`/`score`/`userCode` straight to the server, so
 * the page's in-memory copy of a section can be stale or empty, and replacing
 * the stored object with `{ done: true }` would wipe what the learner did.
 */
export function buildAutoAdvancePatch(
  sections: ReadonlyArray<{ id: string }>,
  flags: SectionDoneFlags,
): AutoAdvancePersistencePatch {
  const sectionState: Record<string, { done: true }> = {};
  for (const s of sections) {
    if (flags.persistedSectionState?.[s.id]?.done === true) continue;
    if (
      flags.liveAutoDone?.[s.id] === true ||
      flags.manuallyCompleted?.[s.id] === true
    ) {
      sectionState[s.id] = { done: true };
    }
  }
  return { status: 'finished', sectionState };
}

/**
 * Shallow-merges per-section field updates into a lesson's section states
 * (the local mirror of the server's `mergeSectionState`). Untouched sections
 * and every field the update does not name — `widgetState`, `score`,
 * `userCode`, … — are kept as they are. Pure: returns a new record.
 */
export function mergeSectionStates(
  existing: Readonly<Record<string, SectionState>> | undefined,
  updates: Readonly<Record<string, Partial<SectionState>>>,
): Record<string, SectionState> {
  const next: Record<string, SectionState> = { ...(existing ?? {}) };
  for (const [sectionId, fields] of Object.entries(updates)) {
    next[sectionId] = { ...(next[sectionId] ?? {}), ...fields };
  }
  return next;
}

export type AutoAdvanceRequestBody = {
  courseSlug: string;
  lessonSlug: string;
  status: 'finished';
  mergeSectionState: Record<string, { done: true }>;
};

/**
 * PATCH /api/progress body that persists an auto-advance patch. It sends the
 * sections as `mergeSectionState`, so the server sets `done: true` on top of
 * whatever it has stored for each section instead of replacing it.
 */
export function autoAdvanceRequestBody(
  courseSlug: string,
  lessonSlug: string,
  patch: AutoAdvancePersistencePatch,
): AutoAdvanceRequestBody {
  return {
    courseSlug,
    lessonSlug,
    status: patch.status,
    mergeSectionState: patch.sectionState,
  };
}

export type AdvanceTarget =
  | { kind: 'next-lesson'; courseSlug: string; lessonSlug: string }
  | { kind: 'my-courses' };

export function resolveAdvanceTarget(
  course: Pick<Course, 'slug' | 'modules'>,
  currentLessonSlug: string,
): AdvanceTarget {
  const flat = course.modules.flatMap((m) => m.lessons);
  const idx = flat.findIndex((l) => l.slug === currentLessonSlug);
  if (idx < 0 || idx >= flat.length - 1) {
    return { kind: 'my-courses' };
  }
  return {
    kind: 'next-lesson',
    courseSlug: course.slug,
    lessonSlug: flat[idx + 1].slug,
  };
}

export function pathForAdvanceTarget(target: AdvanceTarget): string {
  if (target.kind === 'my-courses') return '/';
  return `/courses/${target.courseSlug}/lessons/${target.lessonSlug}`;
}
