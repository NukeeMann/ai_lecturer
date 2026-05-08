import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { LessonSchema } from '@/lib/schemas/lesson';
import { RegenerateLessonRequestSchema } from '@/lib/schemas/regenerateLesson';
import { readCourse } from '@/lib/server/courses';
import {
  RegenerateLessonAgentParseError,
  RegenerateLessonAgentSpawnError,
  runRegenerateLessonAgent,
  truncateForError,
} from '@/lib/server/regenerateLesson';
import { getActiveRunSummary } from '@/lib/server/generation';
import { InvalidSlugError, lessonFile } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = {
  params: Promise<{ slug: string; lessonSlug: string }>;
};

// US-148: full-lesson regenerate. Snapshots existing lesson.json to
// <lessonSlug>.lesson-prev.json before overwriting, so the companion undo
// route can restore it. Only ONE level of undo by design — a second
// regenerate's snapshot is the previous regenerate's output.
export async function POST(req: Request, { params }: RouteCtx) {
  const { slug, lessonSlug } = await params;

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

  const parsedBody = RegenerateLessonRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsedBody.error.issues },
      { status: 400 },
    );
  }

  // Refuse while a generation is active for this slug — regenerating a
  // whole lesson mid-generation would race the spawned children writing
  // into the same lesson file. Same gate the extend / regenerate-section
  // routes use.
  const summary = await getActiveRunSummary();
  if (summary.active && summary.slug === slug) {
    return NextResponse.json(
      { error: 'busy', message: 'Cannot regenerate while generation is active' },
      { status: 409 },
    );
  }

  let course;
  try {
    course = await readCourse(slug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Stored course.json is invalid', detail: String(err) },
      { status: 500 },
    );
  }
  if (!course) {
    return NextResponse.json({ error: 'Course not found' }, { status: 404 });
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

  let currentLesson;
  try {
    const json: unknown = JSON.parse(raw);
    currentLesson = LessonSchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: 'Stored lesson is invalid', detail: String(err) },
      { status: 500 },
    );
  }

  let response;
  try {
    response = await runRegenerateLessonAgent({
      courseSchema: course,
      currentLesson,
      instruction: parsedBody.data.instruction,
    });
  } catch (err) {
    if (err instanceof RegenerateLessonAgentParseError) {
      return NextResponse.json(
        {
          error: 'agent-output-invalid',
          message:
            'regenerate_lesson agent returned output that did not match RegenerateLessonResponseSchema',
          rawOutput: truncateForError(err.rawOutput),
        },
        { status: 422 },
      );
    }
    if (err instanceof RegenerateLessonAgentSpawnError) {
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

  const { newLesson } = response;
  if (newLesson.slug !== currentLesson.slug) {
    return NextResponse.json(
      {
        error: 'agent-output-invalid',
        message: `Agent returned newLesson.slug=${JSON.stringify(newLesson.slug)}, expected ${JSON.stringify(currentLesson.slug)}`,
      },
      { status: 422 },
    );
  }
  if (newLesson.title !== currentLesson.title) {
    return NextResponse.json(
      {
        error: 'agent-output-invalid',
        message: `Agent returned newLesson.title=${JSON.stringify(newLesson.title)}, expected ${JSON.stringify(currentLesson.title)}`,
      },
      { status: 422 },
    );
  }
  if (newLesson.moduleId !== currentLesson.moduleId) {
    return NextResponse.json(
      {
        error: 'agent-output-invalid',
        message: `Agent returned newLesson.moduleId=${JSON.stringify(newLesson.moduleId)}, expected ${JSON.stringify(currentLesson.moduleId)}`,
      },
      { status: 422 },
    );
  }
  if (newLesson.courseSlug !== currentLesson.courseSlug) {
    return NextResponse.json(
      {
        error: 'agent-output-invalid',
        message: `Agent returned newLesson.courseSlug=${JSON.stringify(newLesson.courseSlug)}, expected ${JSON.stringify(currentLesson.courseSlug)}`,
      },
      { status: 422 },
    );
  }

  // Snapshot then overwrite. The snapshot is the byte-for-byte content of
  // the existing lesson.json (the same `raw` we already read), NOT a
  // re-serialised LessonSchema parse — we want exactly what's on disk so
  // the undo route restores the file the user knew. Two sequential file
  // ops; failure between them leaves the snapshot orphaned, which is OK
  // (undo is a UX nicety, not a transactional guarantee — see story AC).
  const snapshotPath = `${file.slice(0, -'.json'.length)}.lesson-prev.json`;
  await fs.writeFile(snapshotPath, raw, 'utf8');
  await fs.writeFile(file, `${JSON.stringify(newLesson, null, 2)}\n`, 'utf8');

  return NextResponse.json({ newLesson, hasUndo: true });
}
