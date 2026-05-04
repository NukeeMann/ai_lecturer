import { NextResponse } from 'next/server';
import { CourseSchema } from '@/lib/schemas/course';
import { atomicWriteJson } from '@/lib/server/atomic';
import { readCourse } from '@/lib/server/courses';
import { InvalidSlugError, courseFile } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: RouteCtx) {
  const { slug } = await params;
  try {
    const course = await readCourse(slug);
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    return NextResponse.json(course);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Stored course.json is invalid', detail: String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request, { params }: RouteCtx) {
  const { slug } = await params;
  let file: string;
  try {
    file = courseFile(slug);
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

  const parsed = CourseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid Course', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await atomicWriteJson(file, parsed.data);
  return NextResponse.json(parsed.data);
}
