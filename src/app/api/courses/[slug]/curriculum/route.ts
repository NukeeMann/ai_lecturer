import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';

import { CourseSpecSchema } from '@/lib/schemas/courseSpec';
import { readCourse } from '@/lib/server/courses';
import {
  InvalidSlugError,
  assertSafeSlug,
  courseSpecFile,
} from '@/lib/server/paths';
import { slugify } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string }> };

export interface CurriculumLesson {
  slug: string;
  title: string;
  moduleId: string | null;
  moduleTitle: string;
  index: number;
}

export interface CurriculumResponse {
  source: 'course' | 'spec';
  total: number;
  lessons: CurriculumLesson[];
}

/**
 * Returns the planned lesson list for a course in stable order. Used by
 * /create's Stage 6 progress slider (US-108) to pre-render every lesson
 * placeholder before per-lesson generation begins. Prefers the realised
 * `course.json` (with stable slugs); falls back to `course-spec.json`
 * (`draftStructure.modules[].lessons[]`) when init_course has not finished
 * yet — in that case slugs are derived from titles via `slugify()` so the
 * UI can still match `lesson:<slug>` SSE events to slots.
 */
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

  // Path 1: realised course.json — preferred, has the canonical lesson slugs
  // that the per-lesson SSE stage events use.
  try {
    const course = await readCourse(slug);
    if (course) {
      const lessons: CurriculumLesson[] = [];
      let i = 0;
      for (const m of course.modules) {
        for (const l of m.lessons) {
          lessons.push({
            slug: l.slug,
            title: l.title,
            moduleId: m.id,
            moduleTitle: m.title,
            index: i++,
          });
        }
      }
      const body: CurriculumResponse = {
        source: 'course',
        total: lessons.length,
        lessons,
      };
      return NextResponse.json(body);
    }
  } catch {
    // course.json exists but is malformed — fall through to spec fallback so
    // the user still sees placeholders, then this path will be retried on
    // the next stage:done refresh.
  }

  // Path 2: pre-init_course fallback — read course-spec.json so the UI can
  // render the planned count before the architect has written course.json.
  let raw: string;
  try {
    raw = await fs.readFile(courseSpecFile(slug), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    throw err;
  }
  let parsed;
  try {
    parsed = CourseSpecSchema.safeParse(JSON.parse(raw));
  } catch {
    return NextResponse.json(
      { error: 'course-spec.json is not valid JSON' },
      { status: 500 },
    );
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'course-spec.json failed schema validation' },
      { status: 500 },
    );
  }

  const lessons: CurriculumLesson[] = [];
  let i = 0;
  for (const m of parsed.data.draftStructure.modules) {
    for (const l of m.lessons) {
      const lessonSlug = slugify(l.title);
      lessons.push({
        slug: lessonSlug,
        title: l.title,
        moduleId: null,
        moduleTitle: m.title,
        index: i++,
      });
    }
  }
  const body: CurriculumResponse = {
    source: 'spec',
    total: lessons.length,
    lessons,
  };
  return NextResponse.json(body);
}
