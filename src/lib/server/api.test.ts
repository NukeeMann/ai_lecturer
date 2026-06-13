import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { GET as listCourses, POST as postCourse } from '@/app/api/courses/route';
import {
  GET as getCourse,
  PUT as putCourse,
  DELETE as deleteCourse,
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
import { GET as getActiveRunRoute } from '@/app/api/courses/active-run/route';
import { GET as getCurriculum } from '@/app/api/courses/[slug]/curriculum/route';
import { __resetForTesting as __resetGenerationForTesting } from '@/lib/server/generation';
import { atomicWriteJson } from '@/lib/server/atomic';
import { slugify } from '@/lib/server/paths';
import {
  draftSourcesDir,
  courseSourcesDir,
  extractedSiblingPath,
  makeDraftId,
} from '@/lib/server/sources';
import {
  __setMediaTranscriberForTesting,
  awaitPendingMediaTranscriptions,
} from '@/lib/server/media';
import { POST as postYouTubeSource } from '@/app/api/courses/youtube-source/route';
import { __setYouTubeTranscriptFetcherForTesting } from '@/lib/server/youtubeSource';

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
  process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(coursesRoot, 'generation-queue.json');
  __resetGenerationForTesting();
});

afterEach(async () => {
  __resetGenerationForTesting();
  __setYouTubeTranscriptFetcherForTesting(null);
  delete process.env.COURSES_ROOT_OVERRIDE;
  delete process.env.GENERATION_QUEUE_FILE_OVERRIDE;
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

describe('DELETE /api/courses/[slug] (US-142)', () => {
  const buildReq = (slug: string, body: unknown = { mode: 'soft' }) =>
    new Request(`http://x/api/courses/${slug}`, {
      method: 'DELETE',
      body: body === null ? undefined : JSON.stringify(body),
      headers: body === null ? {} : { 'Content-Type': 'application/json' },
    });

  it('soft-deletes by moving the course dir to /courses/.trash/<slug>-<stamp>/', async () => {
    await writeCourseFile('algebra', sampleCourse('algebra'));
    const res = await deleteCourse(buildReq('algebra'), {
      params: Promise.resolve({ slug: 'algebra' }),
    });
    expect(res.status).toBe(204);

    // Original dir gone.
    await expect(fs.access(path.join(coursesRoot, 'algebra'))).rejects.toBeTruthy();

    // Trash entry exists with the moved course.json.
    const trashEntries = await fs.readdir(path.join(coursesRoot, '.trash'));
    expect(trashEntries.length).toBe(1);
    expect(trashEntries[0]).toMatch(/^algebra-/);
    const movedCourse = JSON.parse(
      await fs.readFile(
        path.join(coursesRoot, '.trash', trashEntries[0], 'course.json'),
        'utf8',
      ),
    ) as { slug: string };
    expect(movedCourse.slug).toBe('algebra');
  });

  it('defaults mode to soft when body is empty / not JSON', async () => {
    await writeCourseFile('algebra', sampleCourse('algebra'));
    const req = new Request('http://x/api/courses/algebra', { method: 'DELETE' });
    const res = await deleteCourse(req, { params: Promise.resolve({ slug: 'algebra' }) });
    expect(res.status).toBe(204);
    const trashEntries = await fs.readdir(path.join(coursesRoot, '.trash'));
    expect(trashEntries.length).toBe(1);
  });

  it('returns 501 when mode=hard', async () => {
    await writeCourseFile('algebra', sampleCourse('algebra'));
    const res = await deleteCourse(buildReq('algebra', { mode: 'hard' }), {
      params: Promise.resolve({ slug: 'algebra' }),
    });
    expect(res.status).toBe(501);
    // Course dir untouched.
    await expect(fs.access(path.join(coursesRoot, 'algebra'))).resolves.toBeUndefined();
  });

  it('returns 404 for a missing slug', async () => {
    const res = await deleteCourse(buildReq('nope'), {
      params: Promise.resolve({ slug: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 on slug-traversal', async () => {
    const res = await deleteCourse(buildReq('..'), {
      params: Promise.resolve({ slug: '..' }),
    });
    expect(res.status).toBe(400);
    const res2 = await deleteCourse(buildReq('foo-bar'), {
      params: Promise.resolve({ slug: 'foo/bar' }),
    });
    expect(res2.status).toBe(400);
  });

  it('returns 400 on unrecognised mode', async () => {
    await writeCourseFile('algebra', sampleCourse('algebra'));
    const res = await deleteCourse(buildReq('algebra', { mode: 'shred' }), {
      params: Promise.resolve({ slug: 'algebra' }),
    });
    expect(res.status).toBe(400);
  });

  it('clears the course entry from progress.json on success (best-effort)', async () => {
    const progressDir = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-progress-'));
    const progressPath = path.join(progressDir, 'progress.json');
    process.env.PROGRESS_FILE_OVERRIDE = progressPath;
    try {
      await fs.writeFile(
        progressPath,
        JSON.stringify({
          courses: {
            algebra: { lessons: { intro: { status: 'finished' } } },
            other: { lessons: {} },
          },
        }),
        'utf8',
      );
      await writeCourseFile('algebra', sampleCourse('algebra'));
      const res = await deleteCourse(buildReq('algebra'), {
        params: Promise.resolve({ slug: 'algebra' }),
      });
      expect(res.status).toBe(204);
      const updated = JSON.parse(await fs.readFile(progressPath, 'utf8')) as {
        courses: Record<string, unknown>;
      };
      expect(updated.courses.algebra).toBeUndefined();
      expect(updated.courses.other).toBeDefined();
    } finally {
      delete process.env.PROGRESS_FILE_OVERRIDE;
      await fs.rm(progressDir, { recursive: true, force: true });
    }
  });

  it('soft-delete still succeeds when progress.json is missing', async () => {
    const progressPath = path.join(coursesRoot, 'no-such-progress.json');
    process.env.PROGRESS_FILE_OVERRIDE = progressPath;
    try {
      await writeCourseFile('algebra', sampleCourse('algebra'));
      const res = await deleteCourse(buildReq('algebra'), {
        params: Promise.resolve({ slug: 'algebra' }),
      });
      expect(res.status).toBe(204);
      // No progress file should have been created.
      await expect(fs.access(progressPath)).rejects.toBeTruthy();
    } finally {
      delete process.env.PROGRESS_FILE_OVERRIDE;
    }
  });

  it('GET /api/courses skips the .trash directory after a soft-delete', async () => {
    await writeCourseFile('algebra', sampleCourse('algebra'));
    await writeCourseFile('beta', sampleCourse('beta'));
    const res = await deleteCourse(buildReq('algebra'), {
      params: Promise.resolve({ slug: 'algebra' }),
    });
    expect(res.status).toBe(204);
    const list = await listCourses();
    const body = (await list.json()) as Array<{ slug: string }>;
    expect(body.map((c) => c.slug).sort()).toEqual(['beta']);
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

describe('POST /api/courses/youtube-source (US-215)', () => {
  function ytReq(body: unknown): Request {
    return new Request('http://x/api/courses/youtube-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('fetches a transcript and stages it as a provenance .md under a new draftId', async () => {
    __setYouTubeTranscriptFetcherForTesting(async () => ({
      source: 'captions',
      segments: [
        { tStart: 0, text: 'Intro to synthetic aperture radar.' },
        { tStart: 4, text: 'How ATR works.' },
      ],
    }));
    const res = await postYouTubeSource(
      ytReq({ url: 'https://www.youtube.com/watch?v=abcdefghijk' }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      draftId: string;
      file: { sanitizedName: string; size: number; type: string };
    };
    expect(typeof body.draftId).toBe('string');
    expect(body.file.sanitizedName).toBe('youtube-abcdefghijk.md');
    expect(body.file.type).toBe('text/markdown');

    const onDisk = path.join(draftSourcesDir(body.draftId), 'youtube-abcdefghijk.md');
    const written = await fs.readFile(onDisk, 'utf8');
    expect(written).toContain('url: https://www.youtube.com/watch?v=abcdefghijk');
    expect(written).toContain('transcriptSource: captions');
    expect(written).toContain('Intro to synthetic aperture radar.');
  });

  it('returns 422 with a clear error and writes NO file when source is "none"', async () => {
    __setYouTubeTranscriptFetcherForTesting(async () => ({
      source: 'none',
      segments: [],
    }));
    const draftId = makeDraftId();
    await fs.mkdir(draftSourcesDir(draftId), { recursive: true });
    const res = await postYouTubeSource(
      ytReq({ url: 'https://youtu.be/abcdefghijk', draftId }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no captions or description/i);
    expect(await fs.readdir(draftSourcesDir(draftId))).toEqual([]);
  });

  it('rejects an invalid URL with 422 and no file', async () => {
    __setYouTubeTranscriptFetcherForTesting(async () => {
      throw new Error('should not fetch');
    });
    const res = await postYouTubeSource(ytReq({ url: 'definitely not a link' }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/valid youtube/i);
  });

  it('returns 400 when the url field is missing', async () => {
    const res = await postYouTubeSource(ytReq({}));
    expect(res.status).toBe(400);
  });

  it('overwrites the same video on re-add (deterministic filename)', async () => {
    __setYouTubeTranscriptFetcherForTesting(async () => ({
      source: 'captions',
      segments: [{ tStart: 0, text: 'First.' }],
    }));
    const r1 = await postYouTubeSource(ytReq({ url: 'abcdefghijk' }));
    const b1 = (await r1.json()) as { draftId: string };

    __setYouTubeTranscriptFetcherForTesting(async () => ({
      source: 'captions',
      segments: [{ tStart: 0, text: 'Second.' }],
    }));
    const r2 = await postYouTubeSource(
      ytReq({ url: 'https://youtu.be/abcdefghijk', draftId: b1.draftId }),
    );
    expect(r2.status).toBe(201);

    const dir = draftSourcesDir(b1.draftId);
    expect(await fs.readdir(dir)).toEqual(['youtube-abcdefghijk.md']);
    const written = await fs.readFile(path.join(dir, 'youtube-abcdefghijk.md'), 'utf8');
    expect(written).toContain('Second.');
    expect(written).not.toContain('First.');
  });

  it('stages under <slug>/sources when a finalized slug is given, and the file is then listable + readable as text', async () => {
    __setYouTubeTranscriptFetcherForTesting(async () => ({
      source: 'description',
      segments: [{ tStart: 0, text: 'Lecture description body.' }],
    }));
    const res = await postYouTubeSource(
      ytReq({ url: 'abcdefghijk', slug: 'algebra' }),
    );
    expect(res.status).toBe(201);
    // Appears in the GET listing like any other source file.
    const getRes = await getUploadSources(
      new Request('http://x/api/courses/upload-sources?slug=algebra'),
    );
    const getBody = (await getRes.json()) as { files: { sanitizedName: string }[] };
    expect(getBody.files.map((f) => f.sanitizedName)).toContain('youtube-abcdefghijk.md');
  });

  it('the staged transcript is deletable via DELETE upload-sources', async () => {
    __setYouTubeTranscriptFetcherForTesting(async () => ({
      source: 'captions',
      segments: [{ tStart: 0, text: 'Body.' }],
    }));
    const r1 = await postYouTubeSource(ytReq({ url: 'abcdefghijk' }));
    const b1 = (await r1.json()) as { draftId: string };
    const del = await deleteUploadSources(
      new Request(
        `http://x/api/courses/upload-sources?draftId=${encodeURIComponent(b1.draftId)}&filename=youtube-abcdefghijk.md`,
        { method: 'DELETE' },
      ),
    );
    expect(del.status).toBe(200);
    expect(await fs.readdir(draftSourcesDir(b1.draftId))).toEqual([]);
  });
});

describe('upload-sources media transcription (US-214)', () => {
  afterEach(() => {
    __setMediaTranscriberForTesting(null);
  });

  it('accepts a media upload, returns transcribing, and transcribes in the background', async () => {
    __setMediaTranscriberForTesting(async () => ({
      transcript: 'Recorded lecture words.',
      durationMs: 5000,
    }));

    const fd = new FormData();
    fd.append('files', fileFromString('lecture.mp4', 'video/mp4', 'fake-video-bytes'));
    const res = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      draftId: string;
      files: { sanitizedName: string; transcriptionStatus?: string }[];
    };
    expect(body.files).toHaveLength(1);
    // The request returns immediately with a `transcribing` marker — it must
    // NOT block on the (potentially minutes-long) transcription.
    expect(body.files[0].transcriptionStatus).toBe('transcribing');

    // Let the background transcription resolve.
    await awaitPendingMediaTranscriptions();

    // GET now reports `done` and the transcript sibling exists.
    const getRes = await getUploadSources(
      new Request(
        `http://x/api/courses/upload-sources?draftId=${encodeURIComponent(body.draftId)}`,
      ),
    );
    const getBody = (await getRes.json()) as {
      files: { sanitizedName: string; transcriptionStatus?: string }[];
    };
    expect(getBody.files[0].transcriptionStatus).toBe('done');
    const sibling = extractedSiblingPath(
      path.join(draftSourcesDir(body.draftId), 'lecture.mp4'),
    );
    expect(await fs.readFile(sibling, 'utf8')).toContain('Recorded lecture words.');
  });

  it('marks the file failed (with install hint) when whisper is not installed — upload still succeeds', async () => {
    const { SttNotInstalledError } = await import('@/lib/server/stt');
    __setMediaTranscriberForTesting(async () => {
      throw new SttNotInstalledError('/bin/whisper-cli', '/models/ggml.bin');
    });

    const fd = new FormData();
    fd.append('files', fileFromString('talk.mp3', 'audio/mpeg', 'fake-audio'));
    const res = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd }),
    );
    // Upload itself is NOT broken by the missing tooling.
    expect(res.status).toBe(201);
    const body = (await res.json()) as { draftId: string };

    await awaitPendingMediaTranscriptions();

    const getRes = await getUploadSources(
      new Request(
        `http://x/api/courses/upload-sources?draftId=${encodeURIComponent(body.draftId)}`,
      ),
    );
    const getBody = (await getRes.json()) as {
      files: { transcriptionStatus?: string; transcriptionReason?: string }[];
    };
    expect(getBody.files[0].transcriptionStatus).toBe('failed');
    expect(getBody.files[0].transcriptionReason).toMatch(/setup-stt\.sh/);
  });

  it('rejects a media file above the media size cap but well above the document cap', async () => {
    // 60 MiB > 50 MiB document cap but < 250 MiB media cap → accepted.
    const sixtyMB = new Uint8Array(60 * 1024 * 1024);
    __setMediaTranscriberForTesting(async () => ({ transcript: 'x', durationMs: 1 }));
    const fd = new FormData();
    fd.append('files', fileFromString('big.mp4', 'video/mp4', sixtyMB));
    const res = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(201);
    await awaitPendingMediaTranscriptions();
  });

  it('DELETE removes the media file plus its transcript and status siblings', async () => {
    __setMediaTranscriberForTesting(async () => ({
      transcript: 'words',
      durationMs: 1,
    }));
    const fd = new FormData();
    fd.append('files', fileFromString('rec.m4a', 'audio/x-m4a', 'fake'));
    const postRes = await postUploadSources(
      new Request('http://x/api/courses/upload-sources', { method: 'POST', body: fd }),
    );
    const { draftId } = (await postRes.json()) as { draftId: string };
    await awaitPendingMediaTranscriptions();

    const dir = draftSourcesDir(draftId);
    // Siblings exist before delete.
    await fs.access(path.join(dir, '.extracted', 'rec.m4a.md'));
    await fs.access(path.join(dir, '.extracted', 'rec.m4a.status.json'));

    const delRes = await deleteUploadSources(
      new Request(
        `http://x/api/courses/upload-sources?draftId=${encodeURIComponent(draftId)}&filename=rec.m4a`,
        { method: 'DELETE' },
      ),
    );
    expect(delRes.status).toBe(200);
    await expect(fs.access(path.join(dir, 'rec.m4a'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fs.access(path.join(dir, '.extracted', 'rec.m4a.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(dir, '.extracted', 'rec.m4a.status.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
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
    await writeStageLog('demo', 'research_course', 'research line\n');
    // Stagger mtimes so the sort is deterministic.
    await new Promise((r) => setTimeout(r, 12));
    await writeStageLog('demo', 'design_course', 'design line\n');
    await new Promise((r) => setTimeout(r, 12));
    await writeStageLog('demo', 'tensors', 'lesson1 line\n');
    await new Promise((r) => setTimeout(r, 12));
    await writeStageLog('demo', 'autograd', 'lesson2 line\n');

    const res = await getLogsIndex(new Request('http://x/api/courses/demo/logs'), {
      params: Promise.resolve({ slug: 'demo' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stages: { stage: string; bytes: number }[] };
    expect(body.stages.map((s) => s.stage)).toEqual([
      'research_course',
      'design_course',
      'tensors',
      'autograd',
    ]);
    const research = body.stages.find((s) => s.stage === 'research_course');
    expect(research?.bytes).toBe(Buffer.byteLength('research line\n', 'utf8'));
  });

  it('skips non-.log files in logs/', async () => {
    const dir = path.join(coursesRoot, 'demo', 'logs');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'research_course.log'), 'a', 'utf8');
    await fs.writeFile(path.join(dir, 'failed_report.json'), '[]', 'utf8');
    const res = await getLogsIndex(new Request('http://x/api/courses/demo/logs'), {
      params: Promise.resolve({ slug: 'demo' }),
    });
    const body = (await res.json()) as { stages: { stage: string }[] };
    expect(body.stages.map((s) => s.stage)).toEqual(['research_course']);
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
    const body = '[mock research_course] researching topic...\n[mock research_course] done\n';
    await writeStageLog('demo', 'research_course', body);
    const res = await getLogStage(new Request('http://x/api/courses/demo/logs/research_course'), {
      params: Promise.resolve({ slug: 'demo', stage: 'research_course' }),
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
    const res = await getLogStage(new Request('http://x/api/courses/..%2fevil/logs/research_course'), {
      params: Promise.resolve({ slug: '../evil', stage: 'research_course' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/courses/active-run (US-106)', () => {
  it('returns {active:false} when no run is in flight and no marker exists', async () => {
    const res = await getActiveRunRoute();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active: boolean };
    expect(body.active).toBe(false);
  });

  it('returns {active:false} when only stale markers exist (PID dead)', async () => {
    // Pick a PID we're confident is dead. PID 1 is init/systemd which is
    // alive, so use Number.MAX_SAFE_INTEGER instead — process.kill on a PID
    // that high reliably throws ESRCH on any modern Linux/macOS kernel.
    const dir = path.join(coursesRoot, 'ghost-course');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, '.generating.json'),
      JSON.stringify({
        childPid: 9999999,
        slug: 'ghost-course',
        stage: 'research_course',
        startedAt: '2026-05-04T00:00:00.000Z',
      }),
      'utf8',
    );
    const res = await getActiveRunRoute();
    const body = (await res.json()) as { active: boolean };
    expect(body.active).toBe(false);
    // Stale marker should have been unlinked.
    await expect(fs.access(path.join(dir, '.generating.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('returns {active:true} for a live PID-tagged marker and pulls the title from course-spec.json', async () => {
    const dir = path.join(coursesRoot, 'demo-resume');
    await fs.mkdir(dir, { recursive: true });
    await atomicWriteJson(path.join(dir, 'course-spec.json'), sampleSpec('Resumed Course'));
    await fs.writeFile(
      path.join(dir, '.generating.json'),
      JSON.stringify({
        // process.pid is always alive — guarantees the liveness probe passes.
        childPid: process.pid,
        slug: 'demo-resume',
        stage: 'lesson:intro',
        startedAt: '2026-05-04T00:00:00.000Z',
      }),
      'utf8',
    );
    const res = await getActiveRunRoute();
    const body = (await res.json()) as
      | { active: false; queue: unknown[] }
      | { active: true; slug: string; name: string; stage: string; queue: unknown[] };
    expect(body).toEqual({
      active: true,
      slug: 'demo-resume',
      name: 'Resumed Course',
      stage: 'lesson:intro',
      queue: [],
    });
  });

  it('prefers course.json title over course-spec.json once init has completed', async () => {
    const dir = path.join(coursesRoot, 'finished-init');
    await fs.mkdir(dir, { recursive: true });
    await atomicWriteJson(path.join(dir, 'course-spec.json'), sampleSpec('Old Title'));
    await fs.writeFile(
      path.join(dir, 'course.json'),
      JSON.stringify({ ...sampleCourse('finished-init'), title: 'Refined Title' }),
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, '.generating.json'),
      JSON.stringify({
        childPid: process.pid,
        slug: 'finished-init',
        stage: 'lesson:m1l1',
        startedAt: '2026-05-04T00:00:00.000Z',
      }),
      'utf8',
    );
    const res = await getActiveRunRoute();
    const body = (await res.json()) as
      | { active: false }
      | { active: true; slug: string; name: string };
    expect(body.active).toBe(true);
    if (body.active) expect(body.name).toBe('Refined Title');
  });

  it('skips dot-prefixed dirs like /.drafts/ during cold-start scan', async () => {
    // The wizard's draft uploads live under /.drafts/ — the active-run scan
    // must NOT mistake them for courses.
    const dir = path.join(coursesRoot, '.drafts', 'abc123');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, '.drafts', '.generating.json'),
      JSON.stringify({ childPid: process.pid, slug: '.drafts', stage: null }),
      'utf8',
    );
    const res = await getActiveRunRoute();
    const body = (await res.json()) as { active: boolean };
    expect(body.active).toBe(false);
  });

  it('falls back to log-derived stage when the marker has no stage', async () => {
    const dir = path.join(coursesRoot, 'derive-stage');
    await fs.mkdir(path.join(dir, 'logs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'logs', 'research_course.log'), 'research line\n');
    await new Promise((r) => setTimeout(r, 12));
    await fs.writeFile(path.join(dir, 'logs', 'intro.log'), 'lesson line\n');
    await fs.writeFile(
      path.join(dir, '.generating.json'),
      JSON.stringify({
        childPid: process.pid,
        slug: 'derive-stage',
        stage: null,
        startedAt: '2026-05-04T00:00:00.000Z',
      }),
      'utf8',
    );
    const res = await getActiveRunRoute();
    const body = (await res.json()) as
      | { active: false }
      | { active: true; stage: string };
    expect(body.active).toBe(true);
    if (body.active) expect(body.stage).toBe('lesson:intro');
  });

  it('falls back to slug when neither course.json nor course-spec.json exist', async () => {
    const dir = path.join(coursesRoot, 'nameless-run');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, '.generating.json'),
      JSON.stringify({
        childPid: process.pid,
        slug: 'nameless-run',
        stage: 'research_course',
        startedAt: '2026-05-04T00:00:00.000Z',
      }),
      'utf8',
    );
    const res = await getActiveRunRoute();
    const body = (await res.json()) as
      | { active: false }
      | { active: true; name: string };
    expect(body.active).toBe(true);
    if (body.active) expect(body.name).toBe('nameless-run');
  });
});

// US-108 — pre-rendered lesson slot slider in /create's Stage 6 panel.
describe('GET /api/courses/[slug]/curriculum (US-108)', () => {
  type Body = {
    source: 'course' | 'spec';
    total: number;
    lessons: Array<{
      slug: string;
      title: string;
      moduleId: string | null;
      moduleTitle: string;
      index: number;
    }>;
  };

  it('returns 400 on unsafe slug', async () => {
    const res = await getCurriculum(
      new Request('http://x/api/courses/.../curriculum'),
      { params: Promise.resolve({ slug: '..' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when neither course.json nor course-spec.json exist', async () => {
    const res = await getCurriculum(
      new Request('http://x/api/courses/nope/curriculum'),
      { params: Promise.resolve({ slug: 'nope' }) },
    );
    expect(res.status).toBe(404);
  });

  it('falls back to course-spec.json when course.json is missing', async () => {
    const dir = path.join(coursesRoot, 'planned');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'course-spec.json'),
      JSON.stringify({
        ...sampleSpec('Planned Course'),
        draftStructure: {
          courseTitle: 'Planned Course',
          courseDescription: 'd',
          modules: [
            {
              title: 'Foundations',
              lessons: [
                { title: 'What Is A Neuron', summary: 's', estimatedMinutes: 25 },
                { title: 'Layers and activations', summary: 's', estimatedMinutes: 35 },
              ],
            },
            {
              title: 'Optimization',
              lessons: [
                { title: 'Gradient descent', summary: 's', estimatedMinutes: 45 },
              ],
            },
          ],
        },
      }),
    );
    const res = await getCurriculum(
      new Request('http://x/api/courses/planned/curriculum'),
      { params: Promise.resolve({ slug: 'planned' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.source).toBe('spec');
    expect(body.total).toBe(3);
    expect(body.lessons.map((l) => l.slug)).toEqual([
      'what-is-a-neuron',
      'layers-and-activations',
      'gradient-descent',
    ]);
    expect(body.lessons.map((l) => l.title)).toEqual([
      'What Is A Neuron',
      'Layers and activations',
      'Gradient descent',
    ]);
    expect(body.lessons.map((l) => l.moduleTitle)).toEqual([
      'Foundations',
      'Foundations',
      'Optimization',
    ]);
    expect(body.lessons.map((l) => l.index)).toEqual([0, 1, 2]);
    // moduleId is unknown until design_course produces course.json.
    expect(body.lessons.every((l) => l.moduleId === null)).toBe(true);
  });

  it('prefers course.json when present and exposes canonical slugs', async () => {
    await writeCourseFile('realised', {
      schemaVersion: 1,
      slug: 'realised',
      title: 'Realised',
      description: 'd',
      accentColor: 'indigo',
      icon: 'sigma',
      modules: [
        {
          id: 'm-foundations',
          title: 'Foundations',
          summary: 's',
          lessons: [
            { slug: 'overview', title: 'Course overview', estimatedMinutes: 10 },
            { slug: 'first-steps', title: 'First steps', estimatedMinutes: 20 },
          ],
        },
        {
          id: 'm-optimization',
          title: 'Optimization',
          summary: 's',
          lessons: [
            { slug: 'gradient-descent', title: 'Gradient descent', estimatedMinutes: 45 },
          ],
        },
      ],
      createdAt: '2026-04-30T00:00:00Z',
      updatedAt: '2026-04-30T00:00:00Z',
    });
    const res = await getCurriculum(
      new Request('http://x/api/courses/realised/curriculum'),
      { params: Promise.resolve({ slug: 'realised' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.source).toBe('course');
    expect(body.total).toBe(3);
    expect(body.lessons.map((l) => l.slug)).toEqual([
      'overview',
      'first-steps',
      'gradient-descent',
    ]);
    expect(body.lessons.map((l) => l.moduleId)).toEqual([
      'm-foundations',
      'm-foundations',
      'm-optimization',
    ]);
  });

  it('handles a 60+ lesson course and preserves stable order', async () => {
    const lessons = Array.from({ length: 63 }, (_, i) => ({
      slug: `lesson-${i + 1}`,
      title: `Lesson ${i + 1}`,
      estimatedMinutes: 5,
    }));
    await writeCourseFile('big', {
      schemaVersion: 1,
      slug: 'big',
      title: 'Big',
      description: 'd',
      accentColor: 'indigo',
      icon: 'sigma',
      modules: [
        {
          id: 'm-only',
          title: 'Only module',
          summary: 's',
          lessons,
        },
      ],
      createdAt: '2026-04-30T00:00:00Z',
      updatedAt: '2026-04-30T00:00:00Z',
    });
    const res = await getCurriculum(
      new Request('http://x/api/courses/big/curriculum'),
      { params: Promise.resolve({ slug: 'big' }) },
    );
    const body = (await res.json()) as Body;
    expect(body.total).toBe(63);
    expect(body.lessons[0].slug).toBe('lesson-1');
    expect(body.lessons[62].slug).toBe('lesson-63');
    expect(body.lessons.map((l) => l.index)).toEqual(
      Array.from({ length: 63 }, (_, i) => i),
    );
  });
});
