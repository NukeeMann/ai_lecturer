// US-194: POST /api/courses/<slug>/pause — kill the active generation child
// tree for `slug` and flip `.generation-state.json` to `paused`. The
// in-flight lesson's partial JSON is unlinked so a subsequent Resume
// restarts that lesson from a clean attempt 0. Returns 409 when the slug
// isn't the currently active run (no run, or a different slug is running).

import { NextResponse } from 'next/server';
import { getActiveRun } from '@/lib/server/generation';
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

  const run = getActiveRun();
  if (!run || run.finished || run.slug !== slug) {
    return NextResponse.json({ error: 'no-active-run' }, { status: 409 });
  }

  // Fire-and-forget: pause() sends SIGTERM, the pipeline detects `paused`
  // after the child exits and persists the paused snapshot via
  // finalizePaused(). The route returns 202 immediately so the UI can
  // transition to its `paused` rendering without blocking on the child's
  // exit signal.
  await run.pause();
  return NextResponse.json({ ok: true }, { status: 202 });
}
