import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import archiver from 'archiver';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { POST as postImport } from './route';

let coursesRoot: string;

const SLUG = 'imported-fixture';

interface CourseShape {
  schemaVersion: number;
  slug: string;
  title: string;
  description: string;
  accentColor: 'default';
  icon: string;
  modules: Array<{
    id: string;
    title: string;
    summary: string;
    lessons: Array<{ slug: string; title: string; estimatedMinutes: number }>;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface LessonShape {
  schemaVersion: number;
  slug: string;
  courseSlug: string;
  moduleId: string;
  title: string;
  eyebrow: string;
  description: string;
  estimatedMinutes: number;
  sections: Array<{
    id: string;
    title: string;
    type: 'theory';
    data: { markdown: string };
  }>;
}

function makeValidCourse(slug = SLUG): CourseShape {
  return {
    schemaVersion: 1,
    slug,
    title: 'Imported fixture',
    description: 'A fixture course used by US-151 import tests.',
    accentColor: 'default',
    icon: 'file-text',
    modules: [
      {
        id: 'm1',
        title: 'Module 1',
        summary: 'Module summary',
        lessons: [
          { slug: 'intro', title: 'Intro lesson', estimatedMinutes: 5 },
        ],
      },
    ],
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
  };
}

function makeValidLesson(courseSlug = SLUG): LessonShape {
  return {
    schemaVersion: 1,
    slug: 'intro',
    courseSlug,
    moduleId: 'm1',
    title: 'Intro lesson',
    eyebrow: 'Lekcja 1',
    description: 'Intro description.',
    estimatedMinutes: 5,
    sections: [
      {
        id: 's1',
        title: 'Hello',
        type: 'theory',
        data: { markdown: '# hi\n' },
      },
    ],
  };
}

// Build a ZIP buffer in memory using `archiver`. `entries` lets the caller
// override individual files (useful for malformed-fixture variants).
async function buildZipBuffer(
  entries: Array<{ name: string; content: string | Buffer; mode?: number }>,
): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('error', (err) => reject(err));
  });
  for (const entry of entries) {
    archive.append(
      typeof entry.content === 'string' ? entry.content : entry.content,
      { name: entry.name, mode: entry.mode },
    );
  }
  void archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

async function buildValidZip(slug = SLUG): Promise<Buffer> {
  return buildZipBuffer([
    { name: `${slug}/course.json`, content: JSON.stringify(makeValidCourse(slug)) },
    { name: `${slug}/lessons/intro.json`, content: JSON.stringify(makeValidLesson(slug)) },
  ]);
}

// Build a ZIP that contains a symlink entry. archiver doesn't expose a public
// API for symlinks-as-symlinks (it dereferences fs symlinks); we hand-craft
// the central-directory record by patching the externalFileAttributes after
// the archive is finalised.
//
// Approach: build a normal ZIP with one regular entry, then patch the
// central-directory entry's externalFileAttributes (offset+38) to set the
// Unix S_IFLNK bits (0o120000) in the high 16 bits. Also patch the
// version-made-by (offset+4) so the upper byte indicates Unix.
async function buildSymlinkZip(slug = SLUG): Promise<Buffer> {
  const buf = await buildZipBuffer([
    { name: `${slug}/course.json`, content: 'target-path' },
  ]);
  const out = Buffer.from(buf);
  // Find the central-directory entry signature 0x02014b50.
  let cdOffset = -1;
  for (let i = 0; i < out.length - 4; i++) {
    if (out.readUInt32LE(i) === 0x02014b50) {
      cdOffset = i;
      break;
    }
  }
  if (cdOffset < 0) throw new Error('central-directory entry not found');
  // version made by: high byte = 3 (Unix); keep low byte (zip spec version).
  const versionMadeBy = out.readUInt16LE(cdOffset + 4);
  out.writeUInt16LE(0x0314, cdOffset + 4); // 0x03 << 8 | 0x14 (Unix, 2.0)
  void versionMadeBy;
  // External file attributes: high 16 bits = Unix mode (S_IFLNK | 0o755).
  // Use unsigned-shift normalization so the result stays in UInt32 range.
  const unixMode = 0o120755;
  out.writeUInt32LE((unixMode * 0x10000) >>> 0, cdOffset + 38);
  return out;
}

function importReq(buf: Buffer, filename = 'archive.zip'): Request {
  // Re-wrap into a fresh Uint8Array (over a plain ArrayBuffer) so that the
  // Web `Blob`/`File` constructor accepts it cleanly under TS strict types.
  const view = new Uint8Array(new ArrayBuffer(buf.byteLength));
  view.set(buf);
  const blob = new Blob([view], { type: 'application/zip' });
  const file = new File([blob], filename, { type: 'application/zip' });
  const fd = new FormData();
  fd.append('file', file);
  return new Request('http://x/api/courses/import', {
    method: 'POST',
    body: fd,
  });
}

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-import-test-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
});

afterEach(async () => {
  delete process.env.COURSES_ROOT_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
});

describe('POST /api/courses/import (US-151)', () => {
  it('imports a valid ZIP into /courses/<slug>/ and returns 200 with slug + lessonCount', async () => {
    const buf = await buildValidZip();
    const res = await postImport(importReq(buf));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe(SLUG);
    expect(body.lessonCount).toBe(1);
    expect(body.title).toBe('Imported fixture');

    // Files moved into place.
    const courseJson = await fs.readFile(
      path.join(coursesRoot, SLUG, 'course.json'),
      'utf8',
    );
    expect(JSON.parse(courseJson).slug).toBe(SLUG);
    const lessonJson = await fs.readFile(
      path.join(coursesRoot, SLUG, 'lessons', 'intro.json'),
      'utf8',
    );
    expect(JSON.parse(lessonJson).slug).toBe('intro');
  });

  it('rejects non-zip filenames with 400 not-zip', async () => {
    const buf = await buildValidZip();
    const res = await postImport(importReq(buf, 'archive.txt'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('not-zip');
  });

  it('rejects an upload that is not a real ZIP archive with 400 not-zip', async () => {
    const res = await postImport(
      importReq(Buffer.from('totally not a zip'), 'archive.zip'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('not-zip');
  });

  it('rejects a ZIP with multiple top-level folders (bad-structure)', async () => {
    const buf = await buildZipBuffer([
      { name: `${SLUG}/course.json`, content: JSON.stringify(makeValidCourse()) },
      { name: `extra/file.txt`, content: 'extra' },
    ]);
    const res = await postImport(importReq(buf));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('bad-structure');
  });

  it('rejects a ZIP whose top-level folder name violates the slug pattern', async () => {
    const buf = await buildZipBuffer([
      { name: `Bad_SLUG/course.json`, content: JSON.stringify(makeValidCourse('Bad_SLUG')) },
    ]);
    const res = await postImport(importReq(buf));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('bad-structure');
  });

  it('rejects a ZIP-slip attempt (entry path with `..`) with 400 bad-structure', async () => {
    const buf = await buildZipBuffer([
      { name: `${SLUG}/course.json`, content: JSON.stringify(makeValidCourse()) },
      { name: `${SLUG}/../escape.txt`, content: 'pwn' },
    ]);
    const res = await postImport(importReq(buf));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('bad-structure');
  });

  it('rejects a ZIP that contains a symlink entry with 400 bad-structure', async () => {
    const buf = await buildSymlinkZip();
    const res = await postImport(importReq(buf));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('bad-structure');
    expect(String(body.detail)).toMatch(/symlink/i);
  });

  it('rejects a malformed course.json with 400 invalid-course-json', async () => {
    const buf = await buildZipBuffer([
      { name: `${SLUG}/course.json`, content: '{not json' },
    ]);
    const res = await postImport(importReq(buf));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('invalid-course-json');
  });

  it('rejects a course.json that fails CourseSchema with 400 invalid-course-json', async () => {
    const broken = makeValidCourse() as unknown as Record<string, unknown>;
    delete broken.title;
    const buf = await buildZipBuffer([
      { name: `${SLUG}/course.json`, content: JSON.stringify(broken) },
    ]);
    const res = await postImport(importReq(buf));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('invalid-course-json');
  });

  it('rejects a malformed lesson JSON with 400 invalid-lesson-json', async () => {
    const buf = await buildZipBuffer([
      { name: `${SLUG}/course.json`, content: JSON.stringify(makeValidCourse()) },
      { name: `${SLUG}/lessons/intro.json`, content: '{nope' },
    ]);
    const res = await postImport(importReq(buf));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('invalid-lesson-json');
  });

  it('rejects a lesson JSON that fails LessonSchema with 400 invalid-lesson-json', async () => {
    const lesson = makeValidLesson() as unknown as Record<string, unknown>;
    delete lesson.sections;
    const buf = await buildZipBuffer([
      { name: `${SLUG}/course.json`, content: JSON.stringify(makeValidCourse()) },
      { name: `${SLUG}/lessons/intro.json`, content: JSON.stringify(lesson) },
    ]);
    const res = await postImport(importReq(buf));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('invalid-lesson-json');
  });

  it('returns 409 with existingSlug when /courses/<slug>/ already exists', async () => {
    await fs.mkdir(path.join(coursesRoot, SLUG), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, SLUG, 'course.json'),
      JSON.stringify({ stale: true }),
      'utf8',
    );
    const buf = await buildValidZip();
    const res = await postImport(importReq(buf));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('slug-exists');
    expect(body.existingSlug).toBe(SLUG);
    // Existing folder must remain untouched.
    const stale = await fs.readFile(
      path.join(coursesRoot, SLUG, 'course.json'),
      'utf8',
    );
    expect(JSON.parse(stale)).toEqual({ stale: true });
  });

  it('rejects a course.json whose slug does not match the top-level folder', async () => {
    const course = makeValidCourse();
    course.slug = 'different-slug';
    const buf = await buildZipBuffer([
      { name: `${SLUG}/course.json`, content: JSON.stringify(course) },
    ]);
    const res = await postImport(importReq(buf));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('invalid-course-json');
  });

  it('returns 400 when the multipart body is missing the file field', async () => {
    const fd = new FormData();
    const req = new Request('http://x/api/courses/import', {
      method: 'POST',
      body: fd,
    });
    const res = await postImport(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('not-zip');
  });
});

// Suppress the linter warning about unused Readable import — kept for future
// streaming-test variants.
void Readable;
