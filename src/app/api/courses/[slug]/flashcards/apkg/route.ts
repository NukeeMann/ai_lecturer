// GET /api/courses/<slug>/flashcards/apkg
//   200 application/apkg attachment — the whole course as one Anki package
//       (parent deck = course, one subdeck per module). Rebuilt from the
//       module JSON files when they changed since the last build.
//   404 course not found, or no module has flashcards yet.

import { promises as fs } from 'node:fs';
import { NextResponse } from 'next/server';
import { readCourse } from '@/lib/server/courses';
import { apkgDownloadNames, ensureCourseApkg } from '@/lib/server/flashcards';
import { InvalidSlugError } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: RouteCtx) {
  const { slug } = await params;
  try {
    const course = await readCourse(slug);
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const file = await ensureCourseApkg(slug);
    if (!file) {
      return NextResponse.json({ error: 'This course has no flashcards yet' }, { status: 404 });
    }
    const data = await fs.readFile(file);
    const names = apkgDownloadNames(course.title);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/apkg',
        'Content-Length': String(data.length),
        'Content-Disposition': `attachment; filename="${names.ascii}"; filename*=UTF-8''${encodeURIComponent(names.utf8)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Failed to build the Anki deck', detail: String(err) },
      { status: 500 },
    );
  }
}
