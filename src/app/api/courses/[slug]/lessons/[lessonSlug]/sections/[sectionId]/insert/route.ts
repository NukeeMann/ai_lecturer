import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { LessonSchema } from '@/lib/schemas/lesson';
import { InsertSectionRequestSchema } from '@/lib/schemas/insertSection';
import {
  InsertSectionAgentParseError,
  InsertSectionAgentSpawnError,
  makeUniqueSectionId,
  runInsertSectionAgent,
  truncateForError,
} from '@/lib/server/insertSection';
import { atomicWriteJson } from '@/lib/server/atomic';
import { getActiveRunSummary } from '@/lib/server/generation';
import { InvalidSlugError, lessonFile } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = {
  params: Promise<{ slug: string; lessonSlug: string; sectionId: string }>;
};

// US-208: insert a brand-new section directly AFTER the anchor section. The
// agent generates exactly one section; the route assigns it a collision-free
// id, snapshots the existing lesson to <lessonSlug>.lesson-prev.json (so the
// companion undo route can restore it), then writes the spliced lesson
// atomically. A timeout / invalid agent output returns a structured error
// WITHOUT touching the lesson file (we only write after the agent succeeds and
// the spliced lesson re-validates).
export async function POST(req: Request, { params }: RouteCtx) {
  const { slug, lessonSlug, sectionId } = await params;

  // Slug + lessonSlug build a filesystem path; assertSafeSlug (inside
  // lessonFile) is the gatekeeper. sectionId is NOT a path component — it's
  // only a string compare against in-memory data.
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

  const parsedBody = InsertSectionRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsedBody.error.issues },
      { status: 400 },
    );
  }

  // Refuse while a generation is active for this slug — inserting a section
  // mid-generation would race the spawned children writing into the same
  // lesson file. Same gate the extend / regenerate routes use.
  const summary = await getActiveRunSummary();
  if (summary.active && summary.slug === slug) {
    return NextResponse.json(
      { error: 'busy', message: 'Cannot insert while generation is active' },
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

  const anchorIdx = lesson.sections.findIndex((s) => s.id === sectionId);
  if (anchorIdx === -1) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 });
  }

  let response;
  try {
    response = await runInsertSectionAgent({
      lessonContext: lesson,
      anchorSectionId: sectionId,
      instruction: parsedBody.data.instruction,
    });
  } catch (err) {
    if (err instanceof InsertSectionAgentParseError) {
      return NextResponse.json(
        {
          error: 'agent-output-invalid',
          message:
            'insert_section agent returned output that did not match InsertSectionResponseSchema',
          rawOutput: truncateForError(err.rawOutput),
        },
        { status: 422 },
      );
    }
    if (err instanceof InsertSectionAgentSpawnError) {
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

  // Assign a collision-free id derived from the agent's proposal. Existing
  // sections keep their ids untouched, so progress/navigation state survives.
  const existingIds = lesson.sections.map((s) => s.id);
  const uniqueId = makeUniqueSectionId(existingIds, response.newSection.id);
  const insertedSection = { ...response.newSection, id: uniqueId };

  // Splice the new section in directly AFTER the anchor. Existing sections
  // stay byte-identical and keep their relative order.
  const updatedLesson = {
    ...lesson,
    sections: [
      ...lesson.sections.slice(0, anchorIdx + 1),
      insertedSection,
      ...lesson.sections.slice(anchorIdx + 1),
    ],
  };

  // Re-validate the whole lesson before writing — the section was already
  // validated, but a discriminated-union .parse on the full lesson is the
  // cheapest belt-and-braces against future schema drift.
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

  // Snapshot the existing lesson byte-for-byte (the same `raw` we read) BEFORE
  // overwriting, so the undo route restores exactly what the user had. Then
  // write the spliced lesson atomically. Two sequential ops; a failure between
  // them leaves the snapshot orphaned, which is OK (undo is a UX nicety, not a
  // transactional guarantee — same contract as regenerateLesson).
  const snapshotPath = `${file.slice(0, -'.json'.length)}.lesson-prev.json`;
  await fs.writeFile(snapshotPath, raw, 'utf8');
  await atomicWriteJson(file, reparsed.data);

  return NextResponse.json({
    lesson: reparsed.data,
    newSection: insertedSection,
    hasUndo: true,
  });
}
