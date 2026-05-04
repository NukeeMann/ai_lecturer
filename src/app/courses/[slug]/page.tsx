import { notFound, redirect } from 'next/navigation';

import { pickEntryLessonSlug } from '@/lib/lessons/entryRedirect';
import { readCourse } from '@/lib/server/courses';
import { InvalidSlugError } from '@/lib/server/paths';
import { readOrInitProgress } from '@/lib/server/progress';

export const dynamic = 'force-dynamic';

interface RouteParams {
  slug: string;
}

export default async function CourseEntryPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { slug } = await params;

  let course;
  try {
    course = await readCourse(slug);
  } catch (err) {
    if (err instanceof InvalidSlugError) notFound();
    throw err;
  }
  if (!course) notFound();

  const progress = await readOrInitProgress();
  const courseProgress = progress.courses?.[slug];

  const lessonSlug = pickEntryLessonSlug(course, courseProgress);
  if (!lessonSlug) notFound();

  redirect(`/courses/${slug}/lessons/${lessonSlug}`);
}
