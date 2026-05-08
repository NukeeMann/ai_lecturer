import { NextResponse } from 'next/server';
import {
  ClaudeUnavailableError,
  GenerationConflictError,
  GenerationStateMissingError,
  resumeGeneration,
} from '@/lib/server/generation';
import { InvalidSlugError, assertSafeSlug } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string }> };

export async function POST(_req: Request, { params }: RouteCtx) {
  const { slug } = await params;

  try {
    assertSafeSlug(slug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    const run = await resumeGeneration(slug);
    return NextResponse.json({ runId: run.id, slug: run.slug });
  } catch (err) {
    if (err instanceof GenerationStateMissingError) {
      return NextResponse.json({ error: 'no-resumable-state' }, { status: 409 });
    }
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
}
