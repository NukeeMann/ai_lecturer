import { NextResponse } from 'next/server';
import { ExtendRequestSchema } from '@/lib/schemas/extend';
import { readCourse } from '@/lib/server/courses';
import {
  ExtendAgentParseError,
  ExtendAgentSpawnError,
  buildAgentInputCourse,
  readLessonDescriptions,
  runExtendAgent,
  truncateForError,
} from '@/lib/server/extend';
import { getActiveRunSummary } from '@/lib/server/generation';
import { InvalidSlugError } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const { slug } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsedBody = ExtendRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsedBody.error.issues },
      { status: 400 },
    );
  }

  // Refuse while a generation is active for this slug — extending mid-generation
  // would race the spawned init/lesson children writing into the same dir.
  const summary = await getActiveRunSummary();
  if (summary.active && summary.slug === slug) {
    return NextResponse.json(
      { error: 'busy', message: 'Cannot extend while generation is active' },
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

  const descriptions = await readLessonDescriptions(slug, course);
  const currentSchema = buildAgentInputCourse(course, descriptions);

  try {
    const response = await runExtendAgent({
      currentSchema,
      instruction: parsedBody.data.instruction,
      refinements: parsedBody.data.refinements,
    });
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof ExtendAgentParseError) {
      return NextResponse.json(
        {
          error: 'agent-output-invalid',
          message: 'extend_course agent returned output that did not match ExtendResponseSchema',
          rawOutput: truncateForError(err.rawOutput),
        },
        { status: 422 },
      );
    }
    if (err instanceof ExtendAgentSpawnError) {
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
