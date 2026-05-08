import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { CourseSchema } from '@/lib/schemas/course';
import { atomicWriteJson } from '@/lib/server/atomic';
import { readCourse } from '@/lib/server/courses';
import { getActiveRunSummary } from '@/lib/server/generation';
import {
  InvalidSlugError,
  assertSafeSlug,
  courseDir,
  courseFile,
  coursesRoot,
} from '@/lib/server/paths';
import { progressFile } from '@/lib/server/progress';
import { ProgressSchema, type Progress } from '@/lib/schemas/progress';

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

// US-142: soft-delete a course by moving its directory into
// /courses/.trash/<slug>-<ISO-timestamp>/. Hard-delete is reserved for a
// future story and currently returns 501.
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(s, d);
    } else if (entry.isSymbolicLink()) {
      const linkTarget = await fs.readlink(s);
      await fs.symlink(linkTarget, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}

async function clearCourseFromProgress(slug: string): Promise<void> {
  const file = progressFile();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    return;
  }
  let progress: Progress;
  try {
    progress = ProgressSchema.parse(JSON.parse(raw));
  } catch {
    return;
  }
  if (!progress.courses || progress.courses[slug] === undefined) return;
  const next: Progress = { courses: { ...progress.courses } };
  delete next.courses[slug];
  await atomicWriteJson(file, next);
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const { slug } = await params;

  try {
    assertSafeSlug(slug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // Body is optional — default to soft delete.
  let mode: 'soft' | 'hard' = 'soft';
  const ctype = req.headers.get('content-type') ?? '';
  if (ctype.includes('application/json')) {
    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    if (body && typeof body === 'object' && 'mode' in body) {
      const m = (body as { mode?: unknown }).mode;
      if (m === 'soft' || m === 'hard') {
        mode = m;
      } else if (m !== undefined) {
        return NextResponse.json(
          { error: `Invalid mode: ${JSON.stringify(m)}` },
          { status: 400 },
        );
      }
    }
  }

  if (mode === 'hard') {
    return NextResponse.json(
      { error: 'Hard delete is not implemented' },
      { status: 501 },
    );
  }

  // Refuse soft-delete while a run is active for this slug — the spawned
  // child still holds files inside the course dir.
  const summary = await getActiveRunSummary();
  if (summary.active && summary.slug === slug) {
    return NextResponse.json(
      { error: 'generation-active' },
      { status: 409 },
    );
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
    throw err;
  }

  const trashRoot = path.join(coursesRoot(), '.trash');
  await fs.mkdir(trashRoot, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(trashRoot, `${slug}-${stamp}`);

  try {
    await fs.rename(dir, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') {
      // Cross-device rename — fall back to copy + recursive remove.
      await copyDirRecursive(dir, dest);
      await fs.rm(dir, { recursive: true, force: true });
    } else {
      throw err;
    }
  }

  await clearCourseFromProgress(slug);

  return new NextResponse(null, { status: 204 });
}
