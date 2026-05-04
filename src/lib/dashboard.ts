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
