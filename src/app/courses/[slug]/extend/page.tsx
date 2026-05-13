import { notFound } from 'next/navigation';

import { readCourse } from '@/lib/server/courses';
import { InvalidSlugError } from '@/lib/server/paths';

import ExtendWizardClient from './ExtendWizardClient';

export const dynamic = 'force-dynamic';

interface RouteParams {
  slug: string;
}

export default async function CourseExtendPage({
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

  return <ExtendWizardClient course={course} />;
}
