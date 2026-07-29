// US-152: streaming static-HTML export.
//
// GET /api/courses/<slug>/export/html
//   200 application/zip — body is an `archiver`-produced ZIP whose root
//        folder is `<slug>/`. Layout:
//          <slug>/index.html                    — course landing page
//          <slug>/lessons/<lessonSlug>.html     — per-lesson page
//          <slug>/lessons/<lessonSlug>.data.js  — lesson JSON payload
//          <slug>/assets/styles.css             — design tokens + layout
//          <slug>/assets/pyodide-loader.js      — Pyodide CDN bootstrap
//          <slug>/assets/static-client.js       — code/quiz interactivity
//   400  invalid slug / corrupt course or lesson JSON.
//   404  course directory missing.
//   409  generation is active for this slug.
//   500  unexpected error before streaming starts.

import archiver from 'archiver';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';

import { getActiveRunSummary } from '@/lib/server/generation';
import {
  InvalidSlugError,
  assertSafeSlug,
  courseDir,
  courseFile,
  lessonFile,
} from '@/lib/server/paths';
import { CourseSchema, type Course } from '@/lib/schemas/course';
import { LessonSchema, type Lesson } from '@/lib/schemas/lesson';
import {
  MERMAID_LOADER_JS,
  PYODIDE_LOADER_JS,
  STATIC_CLIENT_JS,
  STATIC_STYLES_CSS,
  lessonHasMermaid,
  renderIndexHtml,
  renderLessonDataJs,
  renderLessonHtml,
} from '@/lib/export/staticRender';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string }> };

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadCourse(slug: string): Promise<Course | null> {
  const file = courseFile(slug);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = CourseSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

async function loadLesson(slug: string, lessonSlug: string): Promise<Lesson | null> {
  const file = lessonFile(slug, lessonSlug);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = LessonSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

interface FlatLesson {
  slug: string;
  title: string;
}

function flattenLessons(course: Course): FlatLesson[] {
  return course.modules.flatMap((m) =>
    m.lessons.map((l) => ({ slug: l.slug, title: l.title })),
  );
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

  const course = await loadCourse(slug);
  if (!course) {
    return NextResponse.json(
      { error: 'invalid-course', message: 'course.json missing or invalid' },
      { status: 400 },
    );
  }

  const flatLessons = flattenLessons(course);
  const lessons: Lesson[] = [];
  for (const ref of flatLessons) {
    const lesson = await loadLesson(slug, ref.slug);
    if (!lesson) {
      return NextResponse.json(
        {
          error: 'invalid-lesson',
          message: `Lesson ${ref.slug} missing or invalid`,
        },
        { status: 400 },
      );
    }
    lessons.push(lesson);
  }

  const indexHtml = renderIndexHtml(course);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', (err) => {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      archive.emit('error', err);
    }
  });

  // Static, deterministic content — append to archive in a single pass.
  archive.append(indexHtml, { name: `${slug}/index.html` });
  archive.append(STATIC_STYLES_CSS, { name: `${slug}/assets/styles.css` });
  archive.append(PYODIDE_LOADER_JS, { name: `${slug}/assets/pyodide-loader.js` });
  archive.append(STATIC_CLIENT_JS, { name: `${slug}/assets/static-client.js` });
  // Mermaid loader is only bundled when at least one lesson has a diagram —
  // the per-lesson <script> tag is likewise emitted conditionally.
  if (lessons.some((l) => lessonHasMermaid(l))) {
    archive.append(MERMAID_LOADER_JS, { name: `${slug}/assets/mermaid-loader.js` });
  }

  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i];
    const prev = i > 0 ? flatLessons[i - 1] : null;
    const next = i + 1 < flatLessons.length ? flatLessons[i + 1] : null;
    const html = renderLessonHtml({ lesson, course, prev, next });
    const dataJs = renderLessonDataJs(lesson);
    archive.append(html, { name: `${slug}/lessons/${lesson.slug}.html` });
    archive.append(dataJs, { name: `${slug}/lessons/${lesson.slug}.data.js` });
  }

  void archive.finalize();

  const body = Readable.toWeb(archive) as ReadableStream<Uint8Array>;
  const filename = `${slug}-static-${isoDate()}.zip`;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
