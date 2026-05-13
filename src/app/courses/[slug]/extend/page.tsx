import { notFound } from 'next/navigation';

import { readCourse } from '@/lib/server/courses';
import { getActiveRunSummary } from '@/lib/server/generation';
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

  // US-172: read-only mode while generation is active for THIS slug. Matches
  // the same 409 reason the extend/apply endpoints use server-side.
  const summary = await getActiveRunSummary();
  const initialGenerationActive = summary.active && summary.slug === slug;

  return (
    <ExtendWizardClient
      course={course}
      initialGenerationActive={initialGenerationActive}
    />
  );
}
