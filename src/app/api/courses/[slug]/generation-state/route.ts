// US-140: best-effort delete of every artifact written by a partial
// generation run for `slug` so the user can pick "Cancel and restart from
// scratch" in the resume banner. Wipes:
//   - `<courseDir>/.generation-state.json`            (US-136)
//   - `<courseDir>/.generating.json`                  (US-106 PID marker)
//   - `<courseDir>/.generation-events.ndjson`         (US-138 active log)
//   - `<courseDir>/.generation-events.<...>.ndjson`   (US-138 rotated logs)
//   - every file under `<courseDir>/lessons/`
// Intentionally untouched: course.json, course-spec.json, research.md,
// sources.md, sources/ uploads, logs/. The fresh run kicked off after this
// route returns 204 will reuse those init artifacts.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getActiveRun } from '@/lib/server/generation';
import { readGenerationState } from '@/lib/server/generationState';
import { InvalidSlugError, assertSafeSlug, courseDir } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string }> };

// Snapshot of `.generation-state.json` for the create-page hydration path.
// The wizard reads this on mount so pending lessons (which may have stale
// `.log` files left over from earlier aborted runs) don't get rendered as
// 'done' in the progress bar. Returns 404 when no state file is present.
export async function GET(_req: Request, { params }: RouteCtx) {
  const { slug } = await params;

  try {
    assertSafeSlug(slug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const state = await readGenerationState(slug);
  if (!state) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  return NextResponse.json({
    research: state.research,
    design: state.design,
    lessons: state.lessons.map((l) => ({ slug: l.slug, status: l.status })),
  });
}

async function unlinkIgnoreMissing(file: string): Promise<void> {
  try {
    await fs.unlink(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Best-effort wipe: a leftover marker is preferable to surfacing a
      // partial-failure 500 when the user has already confirmed the destroy.
    }
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const { slug } = await params;

  try {
    assertSafeSlug(slug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // Refuse if the slug is the live in-memory run — the user must cancel
  // first via the existing flow so the spawned child is reaped cleanly.
  const live = getActiveRun();
  if (live && !live.finished && live.slug === slug) {
    return NextResponse.json({ error: 'generation-active' }, { status: 409 });
  }

  const dir = courseDir(slug);

  // Wipe the four flat marker files. Rotated event logs share a prefix +
  // suffix; enumerate the dir so we don't have to guess at stamp/seq values.
  await unlinkIgnoreMissing(path.join(dir, '.generation-state.json'));
  await unlinkIgnoreMissing(path.join(dir, '.generating.json'));
  await unlinkIgnoreMissing(path.join(dir, '.generation-events.ndjson'));

  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    // Course dir doesn't exist — nothing to wipe, treat as success.
    return new NextResponse(null, { status: 204 });
  }
  for (const name of entries) {
    if (name.startsWith('.generation-events.') && name.endsWith('.ndjson')) {
      await unlinkIgnoreMissing(path.join(dir, name));
    }
  }

  // Wipe every file under lessons/ (top-level only — lessons are flat JSON
  // files; per-lesson subdirs do not exist in this layout).
  const lessonsDir = path.join(dir, 'lessons');
  let lessonEntries: import('node:fs').Dirent[] = [];
  try {
    lessonEntries = await fs.readdir(lessonsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Best-effort — log-and-continue rather than 500
    }
  }
  for (const entry of lessonEntries) {
    if (!entry.isFile()) continue;
    await unlinkIgnoreMissing(path.join(lessonsDir, entry.name));
  }

  return new NextResponse(null, { status: 204 });
}
