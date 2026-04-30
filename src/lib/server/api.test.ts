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
import { atomicWriteJson } from '@/lib/server/atomic';
import { slugify } from '@/lib/server/paths';

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
