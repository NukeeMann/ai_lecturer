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
