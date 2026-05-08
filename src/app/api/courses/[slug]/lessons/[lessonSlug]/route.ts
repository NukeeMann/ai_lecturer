import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { LessonSchema } from '@/lib/schemas/lesson';
import { atomicWriteJson } from '@/lib/server/atomic';
import { InvalidSlugError, courseDir, lessonFile } from '@/lib/server/paths';

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

  // US-155: AudioPlayer audioPath must point at a file under courses/<slug>/assets/audio/
  const audioRoot = path.join(courseDir(slug), 'assets', 'audio');
  for (const section of parsed.data.sections) {
    if (section.type !== 'audioPlayer') continue;
    const rel = section.data.audioPath.replace(/^\/+/, '');
    if (rel.includes('..') || rel.includes('\\') || rel.includes('\0') || rel.length === 0) {
      return NextResponse.json(
        {
          error: 'Invalid audioPath',
          message: `Section ${section.id}: audioPath must be a non-empty relative path under assets/audio/`,
        },
        { status: 400 },
      );
    }
    const filePath = path.join(audioRoot, rel);
    const resolved = path.resolve(filePath);
    const resolvedAudioRoot = path.resolve(audioRoot);
    if (
      !resolved.startsWith(resolvedAudioRoot + path.sep) &&
      resolved !== resolvedAudioRoot
    ) {
      return NextResponse.json(
        {
          error: 'Invalid audioPath',
          message: `Section ${section.id}: audioPath escapes assets/audio/`,
        },
        { status: 400 },
      );
    }
    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json(
        {
          error: 'Audio file missing',
          message: `Section ${section.id}: audio file not found at courses/${slug}/assets/audio/${rel}`,
        },
        { status: 400 },
      );
    }
  }

  await atomicWriteJson(file, parsed.data);
  return NextResponse.json(parsed.data);
}
