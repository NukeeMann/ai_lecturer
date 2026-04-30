import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { LessonSchema } from '@/lib/schemas/lesson';
import { atomicWriteJson } from '@/lib/server/atomic';
import { InvalidSlugError, lessonFile } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string; lessonSlug: string }> };

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

  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
    }
    throw err;
  }

  try {
    const json: unknown = JSON.parse(raw);
    const parsed = LessonSchema.parse(json);
    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json(
      { error: 'Stored lesson is invalid', detail: String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request, { params }: RouteCtx) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = LessonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid Lesson', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await atomicWriteJson(file, parsed.data);
  return NextResponse.json(parsed.data);
}
