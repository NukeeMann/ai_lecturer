import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { InvalidSlugError, lessonFile } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = {
  params: Promise<{ slug: string; lessonSlug: string }>;
};

// US-149: report whether <lessonSlug>.lesson-prev.json exists for the given
// lesson. The lesson page calls this on mount to decide whether to show the
// "Lesson regenerated. [Undo]" banner — covers the case where the user
// regenerated, navigated away, and came back before consuming the snapshot.
export async function GET(_req: Request, { params }: RouteCtx) {
  const { slug, lessonSlug } = await params;

  let file: string;
  try {
    file = lessonFile(slug, lessonSlug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const snapshotPath = `${file.slice(0, -'.json'.length)}.lesson-prev.json`;

  try {
    await fs.access(snapshotPath);
    return NextResponse.json({ hasUndo: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ hasUndo: false });
    }
    throw err;
  }
}
