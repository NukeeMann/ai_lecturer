import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { GET as listCourses, POST as postCourse } from '@/app/api/courses/route';
import {
  GET as getCourse,
  PUT as putCourse,
} from '@/app/api/courses/[slug]/route';
import {
  GET as getLesson,
  PUT as putLesson,
} from '@/app/api/courses/[slug]/lessons/[lessonSlug]/route';
import {
  GET as getAsset,
  PUT as putAsset,
} from '@/app/api/courses/[slug]/assets/[...path]/route';
import {
  POST as postUploadSources,
  DELETE as deleteUploadSources,
  GET as getUploadSources,
} from '@/app/api/courses/upload-sources/route';
import { GET as getLogsIndex } from '@/app/api/courses/[slug]/logs/route';
import { GET as getLogStage } from '@/app/api/courses/[slug]/logs/[stage]/route';
import { atomicWriteJson } from '@/lib/server/atomic';
import { slugify } from '@/lib/server/paths';
import {
  draftSourcesDir,
  courseSourcesDir,
  makeDraftId,
} from '@/lib/server/sources';

let coursesRoot: string;

const sampleCourse = (slug: string) => ({
  slug,
  title: `Course ${slug}`,
  description: 'desc',
  accentColor: 'indigo' as const,
  icon: 'sigma',
  modules: [],
  createdAt: '2026-04-30T00:00:00Z',
  updatedAt: '2026-04-30T00:00:00Z',
});

const sampleLesson = (courseSlug: string, slug: string) => ({
  slug,
  courseSlug,
  moduleId: 'm1',
  title: 'Lesson',
  eyebrow: 'INTRO',
  description: 'd',
  estimatedMinutes: 5,
  sections: [
    { id: 's1', title: 'Read', type: 'theory' as const, data: { markdown: '# hi' } },
  ],
});

const sampleSpec = (title: string) => ({
  topic: 'whatever',
  level: 'beginner' as const,
  durationTarget: '1h' as const,
  theoryPracticeRatio: 0.5,
  draftStructure: {
    courseTitle: title,
    courseDescription: 'd',
    modules: [
      {
        title: 'M',
        lessons: [{ title: 'L', summary: 's', estimatedMinutes: 10 }],
      },
    ],
  },
  createdAt: '2026-04-30T00:00:00Z',
});

const writeCourseFile = async (slug: string, payload: unknown) => {
  const dir = path.join(coursesRoot, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'course.json'), JSON.stringify(payload), 'utf8');
};

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-test-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
});

afterEach(async () => {
  delete process.env.COURSES_ROOT_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('slugify', () => {
  it('lowercases and dasherizes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
  it('strips diacritics and special chars', () => {
    expect(slugify('Algebra Liniowa: część 1')).toBe('algebra-liniowa-czesc-1');
  });
  it('collapses repeated separators', () => {
    expect(slugify('  --foo___bar--  ')).toBe('foo-bar');
  });
});

describe('GET /api/courses', () => {
  it('returns [] when courses dir does not exist', async () => {
    await fs.rm(coursesRoot, { recursive: true, force: true });
    const res = await listCourses();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns [] when courses dir is empty', async () => {
    const res = await listCourses();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns one course when exactly one exists', async () => {
    await writeCourseFile('algebra', sampleCourse('algebra'));
    const res = await listCourses();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ slug: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].slug).toBe('algebra');
  });

  it('returns many courses when several exist', async () => {
    await writeCourseFile('a', sampleCourse('a'));
    await writeCourseFile('b', sampleCourse('b'));
    await writeCourseFile('c', sampleCourse('c'));
    const res = await listCourses();
    const body = (await res.json()) as Array<{ slug: string }>;
    expect(body.map((c) => c.slug).sort()).toEqual(['a', 'b', 'c']);
  });

  it('skips invalid course.json with console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeCourseFile('good', sampleCourse('good'));
    await writeCourseFile('bad', { not: 'a course' });
    const res = await listCourses();
    const body = (await res.json()) as Array<{ slug: string }>;
    expect(body.map((c) => c.slug)).toEqual(['good']);
    expect(warn).toHaveBeenCalled();
  });
});

describe('GET /api/courses/[slug]', () => {
  it('404 when missing', async () => {
    const res = await getCourse(new Request('http://x/api/courses/nope'), {
      params: Promise.resolve({ slug: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns course when present', async () => {
    await writeCourseFile('algebra', sampleCourse('algebra'));
    const res = await getCourse(new Request('http://x/api/courses/algebra'), {
      params: Promise.resolve({ slug: 'algebra' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { slug: string }).slug).toBe('algebra');
  });

  it('rejects path traversal in slug', async () => {
    const res = await getCourse(new Request('http://x/api/courses/..'), {
      params: Promise.resolve({ slug: '..' }),
    });
    expect(res.status).toBe(400);
    const res2 = await getCourse(new Request('http://x/api/courses/foo'), {
      params: Promise.resolve({ slug: 'foo/bar' }),
    });
    expect(res2.status).toBe(400);
  });
});

describe('PUT /api/courses/[slug]', () => {
  it('writes a valid course atomically (no .tmp left on success)', async () => {
    const course = sampleCourse('algebra');
    const req = new Request('http://x/api/courses/algebra', {
      method: 'PUT',
      body: JSON.stringify(course),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await putCourse(req, { params: Promise.resolve({ slug: 'algebra' }) });
    expect(res.status).toBe(200);

    const dir = path.join(coursesRoot, 'algebra');
    const files = await fs.readdir(dir);
    expect(files).toContain('course.json');
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);

    const written = JSON.parse(await fs.readFile(path.join(dir, 'course.json'), 'utf8')) as {
      slug: string;
    };
    expect(written.slug).toBe('algebra');
  });

  it('returns 400 with Zod issues on schema rejection', async () => {
    const broken = { ...sampleCourse('algebra') } as Record<string, unknown>;
    delete broken.slug;
    const req = new Request('http://x/api/courses/algebra', {
      method: 'PUT',
      body: JSON.stringify(broken),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await putCourse(req, { params: Promise.resolve({ slug: 'algebra' }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: unknown[] };
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('returns 400 when slug contains path-traversal chars', async () => {
    const req = new Request('http://x/api/courses/..', {
      method: 'PUT',
      body: JSON.stringify(sampleCourse('whatever')),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await putCourse(req, { params: Promise.resolve({ slug: '..' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = new Request('http://x/api/courses/algebra', {
      method: 'PUT',
      body: '{not json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await putCourse(req, { params: Promise.resolve({ slug: 'algebra' }) });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/courses', () => {
  it('creates a new course-spec.json under derived slug, 201', async () => {
    const req = new Request('http://x/api/courses', {
      method: 'POST',
      body: JSON.stringify(sampleSpec('My New Course')),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await postCourse(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toBe('my-new-course');
    const file = path.join(coursesRoot, 'my-new-course', 'course-spec.json');
    const persisted = JSON.parse(await fs.readFile(file, 'utf8')) as {
      draftStructure: { courseTitle: string };
    };
    expect(persisted.draftStructure.courseTitle).toBe('My New Course');
  });

  it('returns 409 on slug collision', async () => {
    await fs.mkdir(path.join(coursesRoot, 'taken'), { recursive: true });
    const req = new Request('http://x/api/courses', {
      method: 'POST',
      body: JSON.stringify(sampleSpec('Taken')),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await postCourse(req);
    expect(res.status).toBe(409);
  });

  it('returns 400 on invalid CourseSpec', async () => {
    const req = new Request('http://x/api/courses', {
      method: 'POST',
      body: JSON.stringify({ not: 'a spec' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await postCourse(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: unknown[] };
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('returns 400 when courseTitle slugifies to empty', async () => {
    const spec = sampleSpec('!@#$%^&*()');
    const req = new Request('http://x/api/courses', {
      method: 'POST',
      body: JSON.stringify(spec),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await postCourse(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/courses/[slug]/lessons/[lessonSlug]', () => {
  it('404 when missing', async () => {
    const res = await getLesson(
      new Request('http://x/api/courses/algebra/lessons/intro'),
      { params: Promise.resolve({ slug: 'algebra', lessonSlug: 'intro' }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns lesson when present', async () => {
    const lesson = sampleLesson('algebra', 'intro');
    await atomicWriteJson(
      path.join(coursesRoot, 'algebra', 'lessons', 'intro.json'),
      lesson,
    );
    const res = await getLesson(
      new Request('http://x/api/courses/algebra/lessons/intro'),
      { params: Promise.resolve({ slug: 'algebra', lessonSlug: 'intro' }) },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { slug: string }).slug).toBe('intro');
  });

  it('rejects path traversal on either slug', async () => {
    const res1 = await getLesson(new Request('http://x/api/courses/../lessons/a'), {
      params: Promise.resolve({ slug: '..', lessonSlug: 'a' }),
    });
    expect(res1.status).toBe(400);
    const res2 = await getLesson(new Request('http://x/api/courses/a/lessons/..'), {
      params: Promise.resolve({ slug: 'a', lessonSlug: '..' }),
    });
    expect(res2.status).toBe(400);
    const res3 = await getLesson(new Request('http://x/api/courses/a/lessons/x'), {
      params: Promise.resolve({ slug: 'a', lessonSlug: 'b/c' }),
    });
    expect(res3.status).toBe(400);
  });
});

describe('PUT /api/courses/[slug]/lessons/[lessonSlug]', () => {
  it('writes a valid lesson atomically (no .tmp left on success)', async () => {
    const lesson = sampleLesson('algebra', 'intro');
    const req = new Request('http://x/api/courses/algebra/lessons/intro', {
      method: 'PUT',
      body: JSON.stringify(lesson),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await putLesson(req, {
      params: Promise.resolve({ slug: 'algebra', lessonSlug: 'intro' }),
    });
    expect(res.status).toBe(200);

    const dir = path.join(coursesRoot, 'algebra', 'lessons');
    const files = await fs.readdir(dir);
    expect(files).toContain('intro.json');
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('returns 400 on schema rejection', async () => {
    const broken = { ...sampleLesson('algebra', 'intro') } as Record<string, unknown>;
    delete broken.title;
    const req = new Request('http://x/api/courses/algebra/lessons/intro', {
      method: 'PUT',
      body: JSON.stringify(broken),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await putLesson(req, {
      params: Promise.resolve({ slug: 'algebra', lessonSlug: 'intro' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/courses/[slug]/assets/[...path]', () => {
  it('serves a png with the right Content-Type', async () => {
    const dir = path.join(coursesRoot, 'algebra', 'assets', 'plots');
    await fs.mkdir(dir, { recursive: true });
    // Minimal 1x1 PNG.
    const pngBytes = Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082',
      'hex',
    );
    await fs.writeFile(path.join(dir, 'fig.png'), pngBytes);

    const res = await getAsset(
      new Request('http://x/api/courses/algebra/assets/plots/fig.png'),
      { params: Promise.resolve({ slug: 'algebra', path: ['plots', 'fig.png'] }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('returns 404 for a missing asset', async () => {
    const res = await getAsset(
      new Request('http://x/api/courses/algebra/assets/missing.png'),
      { params: Promise.resolve({ slug: 'algebra', path: ['missing.png'] }) },
    );
    expect(res.status).toBe(404);
  });

  it('rejects ../ traversal in the asset path', async () => {
    const res = await getAsset(
      new Request('http://x/api/courses/algebra/assets/..'),
      { params: Promise.resolve({ slug: 'algebra', path: ['..'] }) },
    );
    expect(res.status).toBe(400);

    const res2 = await getAsset(
      new Request('http://x/api/courses/algebra/assets/plots/..'),
      { params: Promise.resolve({ slug: 'algebra', path: ['plots', '..', 'secret.png'] }) },
    );
    expect(res2.status).toBe(400);
  });

  it('rejects ../ traversal in the slug', async () => {
    const res = await getAsset(
      new Request('http://x/api/courses/../assets/x.png'),
      { params: Promise.resolve({ slug: '..', path: ['x.png'] }) },
    );
    expect(res.status).toBe(400);
  });

  it('rejects path segments containing slashes', async () => {
    const res = await getAsset(
      new Request('http://x/api/courses/algebra/assets/foo'),
      { params: Promise.resolve({ slug: 'algebra', path: ['foo/bar'] }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns the right Content-Type for svg', async () => {
    const dir = path.join(coursesRoot, 'algebra', 'assets');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'icon.svg'), '<svg/>', 'utf8');
    const res = await getAsset(
      new Request('http://x/api/courses/algebra/assets/icon.svg'),
      { params: Promise.resolve({ slug: 'algebra', path: ['icon.svg'] }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
  });
});

describe('PUT /api/courses/[slug]/assets/[...path]', () => {
  it('writes an uploaded png under courses/<slug>/assets/...', async () => {
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const req = new Request(
      'http://x/api/courses/algebra/assets/plots/up.png',
      { method: 'PUT', body, headers: { 'Content-Type': 'image/png' } },
    );
    const res = await putAsset(req, {
      params: Promise.resolve({ slug: 'algebra', path: ['plots', 'up.png'] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { src: string };
    expect(json.src).toBe('/api/courses/algebra/assets/plots/up.png');

    const written = await fs.readFile(
      path.join(coursesRoot, 'algebra', 'assets', 'plots', 'up.png'),
    );
    expect(written.equals(body)).toBe(true);
  });

  it('rejects unsupported extensions on PUT', async () => {
    const req = new Request(
      'http://x/api/courses/algebra/assets/plots/bad.exe',
      { method: 'PUT', body: Buffer.from('x') },
    );
    const res = await putAsset(req, {
      params: Promise.resolve({ slug: 'algebra', path: ['plots', 'bad.exe'] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects ../ traversal on PUT', async () => {
    const req = new Request(
      'http://x/api/courses/algebra/assets/..',
      { method: 'PUT', body: Buffer.from('x'), headers: { 'Content-Type': 'image/png' } },
    );
    const res = await putAsset(req, {
      params: Promise.resolve({ slug: 'algebra', path: ['..', 'secret.png'] }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── US-103 — POST/DELETE /api/courses/upload-sources ───────────────────────

function fileFromString(name: string, mime: string, content: string | Uint8Array): File {
  // `Blob`'s typings expect a strict ArrayBuffer-backed view; cast the
  // input through `BlobPart[]` so a Uint8Array constructed in tests
  // (whose backing buffer TS infers as the loose `ArrayBufferLike`)
  // still satisfies the constructor signature.
  const blob = new Blob([content as BlobPart], { type: mime });
  return new File([blob], name, { type: mime });
}

describe('POST /api/courses/upload-sources (US-103)', () => {
  it('stages a fresh upload under a new draftId and returns the file list', async () => {
    const fd = new FormData();
    fd.append('files', fileFromString('lecture.pdf', 'application/pdf', 'pdf-bytes'));
    fd.append('files', fileFromString('notes.txt', 'text/plain', 'note text'));
    const req = new Request('http://x/api/courses/upload-sources', {
      method: 'POST',
      body: fd,
    });
    const res = await postUploadSources(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      draftId: string;
      files: { sanitizedName: string; size: number }[];
      rejected: unknown[];
    };
    expect(typeof body.draftId).toBe('string');
    expect(body.draftId.length).toBeGreaterThanOrEqual(6);
    expect(body.files.map((f) => f.sanitizedName).sort()).toEqual(['lecture.pdf', 'notes.txt']);
    expect(body.rejected).toEqual([]);

    // Files must actually live on disk under the staged dir.
    const staged = await fs.readdir(draftSourcesDir(body.draftId));
    expect(new Set(staged)).toEqual(new Set(['lecture.pdf', 'notes.txt']));
  });

  it('appends to the same draftId on subsequent POSTs', async () => {
    const fd1 = new FormData();
    fd1.append('files', fileFromString('a.pdf', 'application/pdf', 'one'));
    const r1 = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd1 }),
    );
    const b1 = (await r1.json()) as { draftId: string };

    const fd2 = new FormData();
    fd2.append('draftId', b1.draftId);
    fd2.append('files', fileFromString('b.txt', 'text/plain', 'two'));
    const r2 = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd2 }),
    );
    expect(r2.status).toBe(201);
    const b2 = (await r2.json()) as { draftId: string; files: { sanitizedName: string }[] };
    expect(b2.draftId).toBe(b1.draftId);
    expect(b2.files.map((f) => f.sanitizedName)).toEqual(['b.txt']);
    const staged = await fs.readdir(draftSourcesDir(b1.draftId));
    expect(new Set(staged)).toEqual(new Set(['a.pdf', 'b.txt']));
  });

  it('appends a numeric collision suffix when reusing the same draftId', async () => {
    const fd1 = new FormData();
    fd1.append('files', fileFromString('a.pdf', 'application/pdf', 'one'));
    const r1 = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd1 }),
    );
    const b1 = (await r1.json()) as { draftId: string };

    const fd2 = new FormData();
    fd2.append('draftId', b1.draftId);
    fd2.append('files', fileFromString('a.pdf', 'application/pdf', 'two'));
    const r2 = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd2 }),
    );
    const b2 = (await r2.json()) as { files: { sanitizedName: string }[] };
    expect(b2.files.map((f) => f.sanitizedName)).toEqual(['a (2).pdf']);
  });

  it('rejects an unsupported extension and returns 400 when EVERY file is rejected', async () => {
    const fd = new FormData();
    fd.append('files', fileFromString('hack.exe', 'application/octet-stream', 'x'));
    const res = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { files: unknown[]; rejected: { reason: string }[] };
    expect(body.files).toEqual([]);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].reason).toMatch(/Unsupported (filename|extension)/);
  });

  it('partial-accepts: stores valid files and reports rejected ones', async () => {
    const fd = new FormData();
    fd.append('files', fileFromString('good.pdf', 'application/pdf', 'pdf'));
    fd.append('files', fileFromString('bad.exe', 'application/octet-stream', 'x'));
    const res = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      files: { sanitizedName: string }[];
      rejected: { name: string }[];
    };
    expect(body.files.map((f) => f.sanitizedName)).toEqual(['good.pdf']);
    expect(body.rejected.map((r) => r.name)).toEqual(['bad.exe']);
  });

  it('rejects an oversized file', async () => {
    // Construct a "large" file by making a Blob whose size exceeds the cap.
    // Allocate a sparse Uint8Array — actual content irrelevant, only size
    // matters for the validator.
    const big = new Uint8Array(50 * 1024 * 1024 + 10);
    const fd = new FormData();
    fd.append('files', fileFromString('huge.pdf', 'application/pdf', big));
    const res = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { rejected: { reason: string }[] };
    expect(body.rejected[0].reason).toMatch(/too large/i);
  });

  it('rejects a malicious draftId', async () => {
    const fd = new FormData();
    fd.append('draftId', '../../etc');
    fd.append('files', fileFromString('a.pdf', 'application/pdf', 'x'));
    const res = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when there are no files at all', async () => {
    const fd = new FormData();
    const res = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(400);
  });

  it('writes under <slug>/sources when a finalized slug is given', async () => {
    const fd = new FormData();
    fd.append('slug', 'algebra');
    fd.append('files', fileFromString('a.pdf', 'application/pdf', 'pdf'));
    const res = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(201);
    const stored = await fs.readdir(courseSourcesDir('algebra'));
    expect(stored).toEqual(['a.pdf']);
  });
});

describe('DELETE /api/courses/upload-sources (US-103)', () => {
  it('removes a single staged file by draftId', async () => {
    const draftId = makeDraftId();
    await fs.mkdir(draftSourcesDir(draftId), { recursive: true });
    await fs.writeFile(path.join(draftSourcesDir(draftId), 'a.pdf'), 'x');
    await fs.writeFile(path.join(draftSourcesDir(draftId), 'b.pdf'), 'y');

    const res = await deleteUploadSources(
      new Request(
        `http://x/api/courses/upload-sources?draftId=${encodeURIComponent(draftId)}&filename=a.pdf`,
        { method: 'DELETE' },
      ),
    );
    expect(res.status).toBe(200);
    const remaining = await fs.readdir(draftSourcesDir(draftId));
    expect(remaining).toEqual(['b.pdf']);
  });

  it('returns 404 for an unknown filename', async () => {
    const draftId = makeDraftId();
    await fs.mkdir(draftSourcesDir(draftId), { recursive: true });
    const res = await deleteUploadSources(
      new Request(
        `http://x/api/courses/upload-sources?draftId=${encodeURIComponent(draftId)}&filename=nope.pdf`,
        { method: 'DELETE' },
      ),
    );
    expect(res.status).toBe(404);
  });

  it('rejects path traversal in filename', async () => {
    const draftId = makeDraftId();
    await fs.mkdir(draftSourcesDir(draftId), { recursive: true });
    const res = await deleteUploadSources(
      new Request(
        `http://x/api/courses/upload-sources?draftId=${encodeURIComponent(draftId)}&filename=${encodeURIComponent('../etc/passwd')}`,
        { method: 'DELETE' },
      ),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 with no draftId and no slug', async () => {
    const res = await deleteUploadSources(
      new Request('http://x/api/courses/upload-sources?filename=a.pdf', { method: 'DELETE' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/courses/upload-sources (US-103)', () => {
  it('lists files for a draftId', async () => {
    const draftId = makeDraftId();
    await fs.mkdir(draftSourcesDir(draftId), { recursive: true });
    await fs.writeFile(path.join(draftSourcesDir(draftId), 'a.pdf'), 'aa');
    const res = await getUploadSources(
      new Request(`http://x/api/courses/upload-sources?draftId=${encodeURIComponent(draftId)}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: { sanitizedName: string; size: number }[] };
    expect(body.files).toEqual([{ sanitizedName: 'a.pdf', size: 2 }]);
  });
});

describe('POST /api/courses with draftId (US-103)', () => {
  it('moves staged sources into the new course directory', async () => {
    const draftId = makeDraftId();
    await fs.mkdir(draftSourcesDir(draftId), { recursive: true });
    await fs.writeFile(path.join(draftSourcesDir(draftId), 'lecture.pdf'), 'pdf');
    await fs.writeFile(path.join(draftSourcesDir(draftId), 'notes.txt'), 'txt');

    const spec = sampleSpec('Course With Materials');
    const req = new Request('http://x/api/courses', {
      method: 'POST',
      body: JSON.stringify({ ...spec, draftId }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await postCourse(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string; movedSources: string[] };
    expect(body.slug).toBe('course-with-materials');
    expect(new Set(body.movedSources)).toEqual(new Set(['lecture.pdf', 'notes.txt']));

    const dir = courseSourcesDir(body.slug);
    expect(new Set(await fs.readdir(dir))).toEqual(new Set(['lecture.pdf', 'notes.txt']));
    // Draft directory should have been removed.
    await expect(fs.access(draftSourcesDir(draftId))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('ignores a draftId pointing at a non-existent draft (no error)', async () => {
    const draftId = makeDraftId();
    const spec = sampleSpec('Course No Materials');
    const req = new Request('http://x/api/courses', {
      method: 'POST',
      body: JSON.stringify({ ...spec, draftId }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await postCourse(req);
    expect(res.status).toBe(201);
  });

  it('returns 400 on a malicious draftId', async () => {
    const spec = sampleSpec('Course');
    const req = new Request('http://x/api/courses', {
      method: 'POST',
      body: JSON.stringify({ ...spec, draftId: '../etc' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await postCourse(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/courses/[slug]/logs (US-105)', () => {
  const writeStageLog = async (slug: string, stage: string, content: string) => {
    const dir = path.join(coursesRoot, slug, 'logs');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${stage}.log`), content, 'utf8');
  };

  it('returns empty stages array when the course has no logs/ dir yet', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const res = await getLogsIndex(new Request('http://x/api/courses/demo/logs'), {
      params: Promise.resolve({ slug: 'demo' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stages: unknown[] };
    expect(body.stages).toEqual([]);
  });

  it('lists each .log basename, sorted by mtime ascending', async () => {
    await writeStageLog('demo', 'init_course', 'init line\n');
    // Stagger mtimes so the sort is deterministic.
    await new Promise((r) => setTimeout(r, 12));
    await writeStageLog('demo', 'tensors', 'lesson1 line\n');
    await new Promise((r) => setTimeout(r, 12));
    await writeStageLog('demo', 'autograd', 'lesson2 line\n');

    const res = await getLogsIndex(new Request('http://x/api/courses/demo/logs'), {
      params: Promise.resolve({ slug: 'demo' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stages: { stage: string; bytes: number }[] };
    expect(body.stages.map((s) => s.stage)).toEqual(['init_course', 'tensors', 'autograd']);
    const init = body.stages.find((s) => s.stage === 'init_course');
    expect(init?.bytes).toBe(Buffer.byteLength('init line\n', 'utf8'));
  });

  it('skips non-.log files in logs/', async () => {
    const dir = path.join(coursesRoot, 'demo', 'logs');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'init_course.log'), 'a', 'utf8');
    await fs.writeFile(path.join(dir, 'failed_report.json'), '[]', 'utf8');
    const res = await getLogsIndex(new Request('http://x/api/courses/demo/logs'), {
      params: Promise.resolve({ slug: 'demo' }),
    });
    const body = (await res.json()) as { stages: { stage: string }[] };
    expect(body.stages.map((s) => s.stage)).toEqual(['init_course']);
  });

  it('rejects an unsafe slug', async () => {
    const res = await getLogsIndex(new Request('http://x/api/courses/..%2fevil/logs'), {
      params: Promise.resolve({ slug: '../evil' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/courses/[slug]/logs/[stage] (US-105)', () => {
  const writeStageLog = async (slug: string, stage: string, content: string) => {
    const dir = path.join(coursesRoot, slug, 'logs');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${stage}.log`), content, 'utf8');
  };

  it('returns the persisted log as text/plain', async () => {
    const body = '[mock init_course] researching topic...\n[mock init_course] done\n';
    await writeStageLog('demo', 'init_course', body);
    const res = await getLogStage(new Request('http://x/api/courses/demo/logs/init_course'), {
      params: Promise.resolve({ slug: 'demo', stage: 'init_course' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe(body);
  });

  it('serves a lesson stage by its disk basename', async () => {
    const body = '=== Attempt 1 ===\nworking...\n';
    await writeStageLog('demo', 'tensors-vs-numpy-arrays', body);
    const res = await getLogStage(
      new Request('http://x/api/courses/demo/logs/tensors-vs-numpy-arrays'),
      {
        params: Promise.resolve({ slug: 'demo', stage: 'tensors-vs-numpy-arrays' }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it('returns 404 when the stage log is missing', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo', 'logs'), { recursive: true });
    const res = await getLogStage(new Request('http://x/api/courses/demo/logs/missing'), {
      params: Promise.resolve({ slug: 'demo', stage: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects path-traversal in stage param', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const res = await getLogStage(new Request('http://x/api/courses/demo/logs/..'), {
      params: Promise.resolve({ slug: 'demo', stage: '..' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unsafe slug', async () => {
    const res = await getLogStage(new Request('http://x/api/courses/..%2fevil/logs/init_course'), {
      params: Promise.resolve({ slug: '../evil', stage: 'init_course' }),
    });
    expect(res.status).toBe(400);
  });
});
