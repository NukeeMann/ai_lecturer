import type { Course } from '@/lib/schemas/course';
import type { Progress } from '@/lib/schemas/progress';

export function allCoursesComplete(
  courses: Course[],
  progress: Progress | null,
): boolean {
  if (courses.length === 0) return false;
  if (!progress) return false;
  for (const course of courses) {
    const lessons = course.modules.flatMap((m) => m.lessons);
    if (lessons.length === 0) return false;
    const cp = progress.courses?.[course.slug];
    if (!cp) return false;
    for (const lesson of lessons) {
      if (cp.lessons?.[lesson.slug]?.status !== 'finished') return false;
    }
  }
  return true;
}

// US-118 — when the dashboard search bar yields no matches and the user
// presses ENTER, jump them straight into the wizard with the query as the
// pre-filled topic. Returns the target href, or null when the legacy no-op
// (blur only) should be preserved (empty query / has matches / pre-load).
export function searchEnterTarget(
  query: string,
  hasMatches: boolean,
  coursesLoaded: boolean,
): string | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;
  if (!coursesLoaded) return null;
  if (hasMatches) return null;
  return `/create?topic=${encodeURIComponent(trimmed)}`;
}
