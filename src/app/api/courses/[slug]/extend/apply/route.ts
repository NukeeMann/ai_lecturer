// US-144: Apply route for the Extend modal. Persists the agent-proposed
// schema produced by US-143 to disk and queues the new lessons for
// generation. Read the partner story US-143 / US-144 for the upstream
// shape; this endpoint is intentionally independent of `runExtendAgent` so
// the UI can call Apply long after the proposal was generated.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CourseSchema, type Course } from '@/lib/schemas/course';
import { readCourse } from '@/lib/server/courses';
import { atomicWriteJson } from '@/lib/server/atomic';
import { courseFile } from '@/lib/server/paths';
import { InvalidSlugError } from '@/lib/server/paths';
import {
  ClaudeUnavailableError,
  GenerationConflictError,
  getActiveRunSummary,
  resumeGeneration,
} from '@/lib/server/generation';
import { writeGenerationState } from '@/lib/server/generationState';

const ApplyRequestSchema = z.object({
  proposedSchema: CourseSchema,
});

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string }> };

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function POST(req: Request, { params }: RouteCtx) {
  const { slug } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsedBody = ApplyRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsedBody.error.issues },
      { status: 400 },
    );
  }
  const proposedSchema = parsedBody.data.proposedSchema;

  // Refuse mid-generation for this slug — writing course.json under a live
  // run would race the spawned children. Same guard as the extend route.
  const summary = await getActiveRunSummary();
  if (summary.active && summary.slug === slug) {
    return NextResponse.json(
      { error: 'busy', message: 'Cannot apply while generation is active' },
      { status: 409 },
    );
  }

  let course: Course | null;
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

  if (proposedSchema.slug !== slug) {
    return NextResponse.json(
      { error: 'slug-mismatch', message: 'proposedSchema.slug does not match URL slug' },
      { status: 422 },
    );
  }

  // Preservation invariant: every pre-existing module ID and lesson slug
  // must still appear in the proposed schema. Renames or removals are
  // rejected — the AC says editing is out of scope for this story.
  const existingModuleIds = new Set(course.modules.map((m) => m.id));
  const existingLessonSlugs = new Set(
    course.modules.flatMap((m) => m.lessons.map((l) => l.slug)),
  );
  const proposedModuleIds = new Set(proposedSchema.modules.map((m) => m.id));
  const proposedLessonSlugs = new Set(
    proposedSchema.modules.flatMap((m) => m.lessons.map((l) => l.slug)),
  );

  const droppedModuleIds = [...existingModuleIds].filter(
    (id) => !proposedModuleIds.has(id),
  );
  const droppedLessonSlugs = [...existingLessonSlugs].filter(
    (s) => !proposedLessonSlugs.has(s),
  );

  if (droppedModuleIds.length > 0 || droppedLessonSlugs.length > 0) {
    return NextResponse.json(
      {
        error: 'preexisting-id-missing',
        message:
          'proposedSchema must preserve every pre-existing module ID and lesson slug',
        droppedModuleIds,
        droppedLessonSlugs,
      },
      { status: 422 },
    );
  }

  const newLessonSlugs = [...proposedLessonSlugs].filter(
    (s) => !existingLessonSlugs.has(s),
  );

  // Persist the schema. updatedAt is bumped to now so downstream views can
  // tell that the course was reshaped without reading the modules array.
  const persisted: Course = {
    ...proposedSchema,
    updatedAt: new Date().toISOString(),
  };

  try {
    await atomicWriteJson(courseFile(slug), persisted);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to write course.json', detail: String(err) },
      { status: 500 },
    );
  }

  if (newLessonSlugs.length === 0) {
    return NextResponse.json({ enqueuedLessonSlugs: [] });
  }

  // Drive the generation pipeline in "append mode" by seeding a state file
  // with init_course already done and only the new lessons listed as
  // pending; resumeGeneration honours both. US-139's idempotency guard
  // would skip the existing lessons regardless, but listing only the new
  // ones keeps progress events clean for the UI.
  const lessonMaxRetries = parseNonNegativeInt(process.env.LESSON_MAX_RETRIES, 2);
  const lessonTimeoutMs =
    parseNonNegativeInt(process.env.LESSON_TIMEOUT_SEC, 1800) * 1000;
  const now = new Date().toISOString();
  await writeGenerationState(slug, {
    schemaVersion: 1,
    slug,
    startedAt: now,
    lastUpdatedAt: now,
    initCourse: { status: 'done' },
    lessons: newLessonSlugs.map((s) => ({
      slug: s,
      status: 'pending' as const,
      attempts: 0,
    })),
    config: { lessonMaxRetries, lessonTimeoutMs },
  });

  try {
    await resumeGeneration(slug);
  } catch (err) {
    if (err instanceof GenerationConflictError) {
      return NextResponse.json({ error: 'busy' }, { status: 409 });
    }
    if (err instanceof ClaudeUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  return NextResponse.json({ enqueuedLessonSlugs: newLessonSlugs });
}
