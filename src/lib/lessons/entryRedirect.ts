import type { Course } from '@/lib/schemas/course';
import type { CourseProgress } from '@/lib/schemas/progress';

/**
 * Picks the lesson slug to redirect to when a learner enters /courses/<slug>.
 * Returns the earliest lesson (in flat module order) whose progress status is
 * not `'finished'`. Falls back to the first lesson if no progress exists for
 * the course, or the last lesson if every lesson is finished. Returns null
 * when the course has no lessons.
 */
export function pickEntryLessonSlug(
  course: Pick<Course, 'modules'>,
  courseProgress: CourseProgress | undefined,
): string | null {
  const flat = course.modules.flatMap((m) => m.lessons);
  if (flat.length === 0) return null;

  if (!courseProgress) return flat[0].slug;

  const lessons = courseProgress.lessons ?? {};
  for (const ref of flat) {
    if (lessons[ref.slug]?.status !== 'finished') return ref.slug;
  }
  return flat[flat.length - 1].slug;
}
