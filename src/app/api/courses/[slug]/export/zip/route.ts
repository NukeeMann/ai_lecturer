// US-150: streaming ZIP export of a course directory.
//
// GET /api/courses/<slug>/export/zip
//   200 application/zip — body is an `archiver`-produced ZIP stream wrapping
//        a single root folder named `<slug>/` whose contents mirror
//        /courses/<slug>/ EXCEPT for generation-state, marker, event-log, and
//        per-lesson snapshot files (matched by basename — see isExcluded).
//   400  invalid slug.
//   404  course directory missing.
//   409  a generation is active for this slug — taking a snapshot mid-run
//        could capture inconsistent state, so we fail loudly rather than
//        silently produce a half-baked ZIP.
//   500  unexpected error before streaming starts. Once headers are written
//        and chunks are flowing, archiver errors propagate via the stream
//        and the client sees a truncated body — there is no mid-stream HTTP
//        error code we can swap in without buffering the whole archive in
//        memory first.

import archiver from 'archiver';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { getActiveRunSummary } from '@/lib/server/generation';
import {
  InvalidSlugError,
  assertSafeSlug,
  courseDir,
} from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string }> };

// Files NOT included in the export: per-AC, generation-state markers,
// event-log streams (including rotated `.N.ndjson` variants), the in-flight
// `.generating.json` marker, and per-lesson regenerate snapshots. Note that
// `coherence-report.md` is NOT excluded — it is meaningful course output.
export function isExcluded(basename: string): boolean {
  if (basename === '.generation-state.json') return true;
  if (basename === '.generating.json') return true;
  if (basename === '.generation-events.ndjson') return true;
  if (basename.startsWith('.generation-events.') && basename.endsWith('.ndjson')) {
    return true;
  }
  if (basename.endsWith('.lesson-prev.json')) return true;
  return false;
}

async function addDirRecursive(
  archive: archiver.Archiver,
  srcDir: string,
  destPrefix: string,
): Promise<void> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = `${destPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await addDirRecursive(archive, src, dest);
    } else if (entry.isFile()) {
      if (isExcluded(entry.name)) continue;
      archive.file(src, { name: dest });
    }
  }
}

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

  const dir = courseDir(slug);
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Failed to stat course directory', detail: String(err) },
      { status: 500 },
    );
  }

  const summary = await getActiveRunSummary();
  if (summary.active && summary.slug === slug) {
    return NextResponse.json(
      { error: 'generation-active', message: 'Cannot export while generation is active' },
      { status: 409 },
    );
  }

  const archive = archiver('zip', { zlib: { level: 6 } });

  // Surface archive errors to stderr — the stream itself will close, the
  // client sees a truncated body. archiver emits 'warning' for non-blocking
  // issues (e.g. ENOENT on a vanished file mid-walk); ENOENT is recoverable,
  // anything else we re-throw to abort the stream.
  archive.on('warning', (err) => {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      archive.emit('error', err);
    }
  });

  try {
    await addDirRecursive(archive, dir, slug);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to enumerate course directory', detail: String(err) },
      { status: 500 },
    );
  }

  void archive.finalize();

  // archiver is a Node Readable; convert to a Web ReadableStream for the
  // Next.js Response body. Node 18+ has Readable.toWeb.
  const body = Readable.toWeb(archive) as ReadableStream<Uint8Array>;

  const isoDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `${slug}-${isoDate}.zip`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
