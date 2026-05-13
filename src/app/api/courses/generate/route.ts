import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import {
  CancellationCooldownError,
  ClaudeUnavailableError,
  GenerationConflictError,
  enqueueGeneration,
  getRunById,
} from '@/lib/server/generation';
import { InvalidSlugError, assertSafeSlug, courseSpecFile } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const slug = (body as { slug?: unknown } | null)?.slug;
  try {
    assertSafeSlug(slug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // The course-spec.json was written by US-026's POST /api/courses; require it
  // to exist before we hand off to the agent chain.
  try {
    await fs.access(courseSpecFile(slug));
  } catch {
    return NextResponse.json(
      { error: `course-spec.json not found for slug "${slug}"` },
      { status: 404 },
    );
  }

  try {
    // US-107: enqueueGeneration replaces the bare startGeneration call. When
    // a different slug is already running, the request is appended to a
    // FIFO queue persisted in ~/.ai-lecturer/generation-queue.json instead
    // of returning 409. Same-slug requests still attach to the existing run
    // (US-105) — that idempotency lives inside enqueueGeneration too.
    const result = await enqueueGeneration(slug);
    if (result.kind === 'started') {
      return NextResponse.json(
        { id: result.run.id, slug: result.run.slug },
        { status: 202 },
      );
    }
    return NextResponse.json(
      { queued: true, slug: result.slug, position: result.position, total: result.total },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof GenerationConflictError) {
      // Defensive only — enqueueGeneration shouldn't throw conflict in the
      // US-107 flow, but the error class still exists for code paths that
      // call startGeneration directly.
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof CancellationCooldownError) {
      return NextResponse.json({ error: 'recently-cancelled' }, { status: 409 });
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

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }
  const run = getRunById(id);
  if (!run) {
    return NextResponse.json({ error: 'Unknown generation id' }, { status: 404 });
  }
  await run.cancel();
  return NextResponse.json({ ok: true });
}
