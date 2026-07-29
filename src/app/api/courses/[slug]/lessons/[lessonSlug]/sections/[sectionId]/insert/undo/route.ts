import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { LessonSchema } from '@/lib/schemas/lesson';
import { InvalidSlugError, lessonFile } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = {
  params: Promise<{ slug: string; lessonSlug: string; sectionId: string }>;
};

// US-208 companion undo route. Restores <lessonSlug>.lesson-prev.json (the
// snapshot the insert route wrote) onto lesson.json, then deletes the
// snapshot. Single-step by design — after a successful undo there is no
// further undo. sectionId is in the path for symmetry with the insert route
// but is not used (undo restores the whole lesson).
export async function POST(_req: Request, { params }: RouteCtx) {
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

  let snapshotRaw: string;
  try {
    snapshotRaw = await fs.readFile(snapshotPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'No snapshot to undo' }, { status: 404 });
    }
    throw err;
  }

  let restoredLesson;
  try {
    const json: unknown = JSON.parse(snapshotRaw);
    restoredLesson = LessonSchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: 'Snapshot is invalid', detail: String(err) },
      { status: 500 },
    );
  }

  // Restore byte-for-byte from the snapshot, not a re-serialised parse — the
  // snapshot file IS the previous lesson.json, so we put it back exactly as it
  // was. Then delete the snapshot to seal the single-undo contract.
  await fs.writeFile(file, snapshotRaw, 'utf8');
  await fs.unlink(snapshotPath);

  return NextResponse.json({ restoredLesson });
}
