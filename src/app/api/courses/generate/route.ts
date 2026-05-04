import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import {
  ClaudeUnavailableError,
  GenerationConflictError,
  getRunById,
  startGeneration,
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
    const run = await startGeneration(slug);
    return NextResponse.json({ id: run.id, slug: run.slug }, { status: 202 });
  } catch (err) {
    if (err instanceof GenerationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
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
