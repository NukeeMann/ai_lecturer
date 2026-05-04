import type { Course } from '@/lib/schemas/course';
import type { Lesson } from '@/lib/schemas/lesson';
import type { LessonProgress } from '@/lib/schemas/progress';

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
