import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { LessonSchema } from '@/lib/schemas/lesson';
import { ApplySectionRequestSchema } from '@/lib/schemas/regenerateSection';
import { atomicWriteJson } from '@/lib/server/atomic';
import { getActiveRunSummary } from '@/lib/server/generation';
import { InvalidSlugError, lessonFile } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = {
  params: Promise<{ slug: string; lessonSlug: string; sectionId: string }>;
};

export async function POST(req: Request, { params }: RouteCtx) {
  const { slug, lessonSlug, sectionId } = await params;

  let file: string;
  try {
    file = lessonFile(slug, lessonSlug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsedBody = ApplySectionRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsedBody.error.issues },
      { status: 422 },
    );
  }

  // Refuse while a generation is active for this slug — applying a section
  // mid-generation would race the spawned children writing into the same
  // lesson file. Same gate the extend / regenerate routes use.
  const summary = await getActiveRunSummary();
  if (summary.active && summary.slug === slug) {
    return NextResponse.json(
      { error: 'busy', message: 'Cannot apply while generation is active' },
      { status: 409 },
    );
  }

  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
    }
    throw err;
  }

  let lesson;
  try {
    const json: unknown = JSON.parse(raw);
    lesson = LessonSchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: 'Stored lesson is invalid', detail: String(err) },
      { status: 500 },
    );
  }

  const idx = lesson.sections.findIndex((s) => s.id === sectionId);
  if (idx === -1) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 });
  }

  const oldSection = lesson.sections[idx];
  const { newSection } = parsedBody.data;

  if (newSection.id !== sectionId) {
    return NextResponse.json(
      {
        error: 'id-mismatch',
        message: `newSection.id=${JSON.stringify(newSection.id)}, expected ${JSON.stringify(sectionId)}`,
      },
      { status: 422 },
    );
  }
  if (newSection.type !== oldSection.type) {
    return NextResponse.json(
      {
        error: 'kind-mismatch',
        message: `newSection.type=${JSON.stringify(newSection.type)}, expected ${JSON.stringify(oldSection.type)}`,
      },
      { status: 422 },
    );
  }

  const updatedLesson = {
    ...lesson,
    sections: lesson.sections.map((s, i) => (i === idx ? newSection : s)),
  };

  // Re-validate the whole lesson against LessonSchema before writing — the
  // section was already validated, but a discriminated-union .parse on the
  // full lesson is the cheapest belt-and-braces against future schema drift.
  const reparsed = LessonSchema.safeParse(updatedLesson);
  if (!reparsed.success) {
    return NextResponse.json(
      {
        error: 'Updated lesson failed schema validation',
        issues: reparsed.error.issues,
      },
      { status: 422 },
    );
  }

  await atomicWriteJson(file, reparsed.data);
  return NextResponse.json(reparsed.data);
}
