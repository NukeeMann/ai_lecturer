import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { LessonSchema } from '@/lib/schemas/lesson';
import { RegenerateSectionRequestSchema } from '@/lib/schemas/regenerateSection';
import {
  RegenerateSectionAgentParseError,
  RegenerateSectionAgentSpawnError,
  runRegenerateSectionAgent,
  truncateForError,
} from '@/lib/server/regenerateSection';
import { getActiveRunSummary } from '@/lib/server/generation';
import { InvalidSlugError, lessonFile } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = {
  params: Promise<{ slug: string; lessonSlug: string; sectionId: string }>;
};

export async function POST(req: Request, { params }: RouteCtx) {
  const { slug, lessonSlug, sectionId } = await params;

  // Slug + lessonSlug are used to build a filesystem path; assertSafeSlug
  // (called inside lessonFile) is the gatekeeper. sectionId is NOT a path
  // component — we only use it as a string compare against in-memory data.
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

  const parsedBody = RegenerateSectionRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsedBody.error.issues },
      { status: 400 },
    );
  }

  // Refuse while a generation is active for this slug — regenerating a
  // section mid-generation would race the spawned children writing into the
  // same lesson file (the writer wins, and the regenerate result vanishes
  // depending on Apply timing). Same gate the extend route uses (US-143).
  const summary = await getActiveRunSummary();
  if (summary.active && summary.slug === slug) {
    return NextResponse.json(
      { error: 'busy', message: 'Cannot regenerate while generation is active' },
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

  const oldSection = lesson.sections.find((s) => s.id === sectionId);
  if (!oldSection) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 });
  }

  try {
    const response = await runRegenerateSectionAgent({
      lessonContext: lesson,
      sectionId,
      instruction: parsedBody.data.instruction,
    });

    const { newSection } = response;
    if (newSection.id !== sectionId) {
      return NextResponse.json(
        {
          error: 'agent-output-invalid',
          message: `Agent returned newSection.id=${JSON.stringify(newSection.id)}, expected ${JSON.stringify(sectionId)}`,
        },
        { status: 422 },
      );
    }
    if (newSection.type !== oldSection.type) {
      return NextResponse.json(
        {
          error: 'agent-output-invalid',
          message: `Agent returned newSection.type=${JSON.stringify(newSection.type)}, expected ${JSON.stringify(oldSection.type)}`,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ newSection, oldSection });
  } catch (err) {
    if (err instanceof RegenerateSectionAgentParseError) {
      return NextResponse.json(
        {
          error: 'agent-output-invalid',
          message:
            'regenerate_section agent returned output that did not match RegenerateSectionResponseSchema',
          rawOutput: truncateForError(err.rawOutput),
        },
        { status: 422 },
      );
    }
    if (err instanceof RegenerateSectionAgentSpawnError) {
      return NextResponse.json(
        { error: 'agent-spawn-failed', message: err.message },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: 'Unexpected error', detail: String(err) },
      { status: 500 },
    );
  }
}
