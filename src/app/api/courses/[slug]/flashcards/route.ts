// Anki flashcards for a course.
//
// GET  /api/courses/<slug>/flashcards
//   200 FlashcardsSummary — card counts per module + the on-demand job's
//       progress (null when no job ran since the server started).
//   404 course not found.
//
// POST /api/courses/<slug>/flashcards   body: { regenerate?: boolean }
//   202 FlashcardsJobStatus — background generation started for every
//       module without valid flashcards (all modules with regenerate=true).
//   409 a flashcards job or the course generation is already running.
//   404 course not found.

import { NextResponse } from 'next/server';
import { getFlashcardsSummary } from '@/lib/server/flashcards';
import {
  FlashcardsJobConflictError,
  getFlashcardsJob,
  startFlashcardsJob,
} from '@/lib/server/flashcardsJob';
import { InvalidSlugError, assertSafeSlug } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: RouteCtx) {
  const { slug } = await params;
  try {
    assertSafeSlug(slug);
    const summary = await getFlashcardsSummary(slug, getFlashcardsJob(slug));
    if (!summary) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Failed to read flashcards', detail: String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, { params }: RouteCtx) {
  const { slug } = await params;
  let regenerate = false;
  try {
    const body = (await req.json()) as { regenerate?: unknown };
    regenerate = body?.regenerate === true;
  } catch {
    /* empty body → defaults */
  }
  try {
    assertSafeSlug(slug);
    const status = await startFlashcardsJob(slug, { regenerate });
    return NextResponse.json(status, { status: 202 });
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof FlashcardsJobConflictError) {
      return NextResponse.json({ error: 'busy', message: err.message }, { status: 409 });
    }
    if (err instanceof Error && err.message === 'Course not found') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Failed to start flashcards generation', detail: String(err) },
      { status: 500 },
    );
  }
}
