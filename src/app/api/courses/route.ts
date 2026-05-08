import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CourseSchema } from '@/lib/schemas/course';
import { CourseSpecSchema } from '@/lib/schemas/courseSpec';
import { atomicWriteJson } from '@/lib/server/atomic';
import {
  InvalidSlugError,
  assertSafeSlug,
  courseDir,
  courseSpecFile,
  coursesRoot,
  slugify,
} from '@/lib/server/paths';
import {
  InvalidDraftIdError,
  assertSafeDraftId,
  moveDraftSourcesToCourse,
} from '@/lib/server/sources';

export const dynamic = 'force-dynamic';

export async function GET() {
  const root = coursesRoot();
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json([]);
    }
    throw err;
  }

  const courses = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const file = path.join(root, entry.name, 'course.json');
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      console.warn(`Skipping course "${entry.name}": cannot read course.json`, err);
      continue;
    }
    try {
      const json: unknown = JSON.parse(raw);
      const parsed = CourseSchema.parse(json);
      courses.push(parsed);
    } catch (err) {
      console.warn(`Skipping invalid course "${entry.name}":`, err);
    }
  }
  return NextResponse.json(courses);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CourseSpecSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid CourseSpec', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const slug = slugify(parsed.data.draftStructure.courseTitle);
  if (slug.length === 0) {
    return NextResponse.json(
      { error: 'Could not derive a slug from courseTitle' },
      { status: 400 },
    );
  }

  let dir: string;
  try {
    assertSafeSlug(slug);
    dir = courseDir(slug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    await fs.access(dir);
    return NextResponse.json(
      { error: `Course slug "${slug}" already exists`, slug },
      { status: 409 },
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  await atomicWriteJson(courseSpecFile(slug), parsed.data);

  // US-103: if the wizard staged source materials under a draftId before
  // the slug was finalized, move them into /courses/<slug>/sources/ now.
  // The draftId travels alongside the spec but is intentionally not part
  // of CourseSpecSchema (zod strips it on parse), so read it directly.
  const draftIdField = (body as { draftId?: unknown } | null)?.draftId;
  let movedSources: string[] | undefined;
  if (typeof draftIdField === 'string' && draftIdField.length > 0) {
    try {
      assertSafeDraftId(draftIdField);
      movedSources = await moveDraftSourcesToCourse(draftIdField, slug);
    } catch (err) {
      if (err instanceof InvalidDraftIdError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  const responseBody: { slug: string; movedSources?: string[] } = { slug };
  if (movedSources && movedSources.length > 0) responseBody.movedSources = movedSources;
  return NextResponse.json(responseBody, { status: 201 });
}
