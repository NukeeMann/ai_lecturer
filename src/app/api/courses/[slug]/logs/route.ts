import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { InvalidSlugError, assertSafeSlug, genLogsDir } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string }> };

// Returns the list of per-stage generation logs that exist on disk for this
// course. Used by /create's Stage 6 panel to seed completed-stage scrollback
// when the page is opened mid-run (or after a server restart). See US-105.
export async function GET(_req: Request, { params }: RouteCtx) {
  const { slug } = await params;

  let dir: string;
  try {
    assertSafeSlug(slug);
    dir = genLogsDir(slug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ stages: [] });
    }
    throw err;
  }

  const stages: { stage: string; bytes: number; modifiedAt: string }[] = [];
  for (const name of entries) {
    if (!name.endsWith('.log')) continue;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    stages.push({
      stage: name.slice(0, -'.log'.length),
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  }
  stages.sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt));

  return NextResponse.json({ stages });
}
