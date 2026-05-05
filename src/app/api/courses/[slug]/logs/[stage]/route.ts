import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  InvalidSlugError,
  assertSafeSlug,
  genLogsDir,
  stageLogFile,
} from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string; stage: string }> };

// Lazy-load the persisted log for one generation stage. The wizard's log
// panel calls this on first expand of a completed stage so the user can
// review what claude actually decided after the pipeline has moved on.
// See US-105.
export async function GET(_req: Request, { params }: RouteCtx) {
  const { slug, stage } = await params;

  let filePath: string;
  let logsRoot: string;
  try {
    assertSafeSlug(slug);
    assertSafeSlug(stage);
    filePath = stageLogFile(slug, stage);
    logsRoot = genLogsDir(slug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // Defence-in-depth: ensure the resolved log path lives inside logs/ even
  // if a future change relaxes assertSafeSlug.
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(logsRoot);
  if (!resolved.startsWith(resolvedRoot + path.sep)) {
    return NextResponse.json({ error: 'Invalid stage path' }, { status: 400 });
  }

  let body: string;
  try {
    body = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'Stage log not found' }, { status: 404 });
    }
    throw err;
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
