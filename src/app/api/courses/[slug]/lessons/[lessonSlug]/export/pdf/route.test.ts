// US-153: Per-lesson PDF export route tests.
//
// We exercise the route handler with a swapped-in fake puppeteer-core
// launcher so the test stays hermetic — no real Chromium required. The
// fake returns a hand-crafted "%PDF-1.4..." byte string, which lets us
// verify the route's plumbing (status, headers, magic bytes, filename)
// without booting a browser. The real end-to-end flow with the actual
// playwright Chromium is verified separately via the playwright-skill
// browser test referenced in this story's AC.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';
import {
  __resetForTesting,
  __setLauncherForTesting,
} from '@/lib/server/pdfBrowser';

const FAKE_PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 1\n0000000000 65535 f\ntrailer\n<< /Size 1 >>\nstartxref\n0\n%%EOF',
);

interface FakeOpts {
  gotoBehavior?: 'ok' | 'econnrefused' | 'other-error';
  evaluatedOk?: boolean;
  pdfThrows?: boolean;
}

function makeFakeLauncher(opts: FakeOpts = {}) {
  const goto = vi.fn(async () => {
    if (opts.gotoBehavior === 'econnrefused') {
      throw new Error('net::ERR_CONNECTION_REFUSED at http://localhost:3000');
    }
    if (opts.gotoBehavior === 'other-error') {
      throw new Error('net::ERR_FAILED');
    }
    return null;
  });
  const evaluate = vi.fn(async () =>
    opts.evaluatedOk === undefined ? true : opts.evaluatedOk,
  );
  const pdf = vi.fn(async () => {
    if (opts.pdfThrows) throw new Error('pdf rendering crashed');
    return new Uint8Array(FAKE_PDF_BYTES);
  });
  const close = vi.fn(async () => {});
  const page = { goto, evaluate, pdf, close } as unknown as import('puppeteer-core').Page;
  const browser = {
    newPage: vi.fn(async () => page),
    on: vi.fn(),
    connected: true,
    close: vi.fn(async () => {}),
  } as unknown as import('puppeteer-core').Browser;
  const launch = vi.fn(async () => browser);
  return { launcher: { launch }, goto, pdf, evaluate, close, page, browser };
}

async function makeReq(slug: string, lessonSlug: string): Promise<Request> {
  return new Request(
    `http://localhost:3000/api/courses/${slug}/lessons/${lessonSlug}/export/pdf`,
  );
}

async function withTempCoursesRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'us-153-pdf-test-'));
  const prev = process.env.COURSES_ROOT_OVERRIDE;
  process.env.COURSES_ROOT_OVERRIDE = tmp;
  try {
    return await fn(tmp);
  } finally {
    if (prev === undefined) delete process.env.COURSES_ROOT_OVERRIDE;
    else process.env.COURSES_ROOT_OVERRIDE = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function seedLesson(root: string, slug: string, lessonSlug: string) {
  const dir = path.join(root, slug, 'lessons');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${lessonSlug}.json`),
    JSON.stringify({
      schemaVersion: 1,
      slug: lessonSlug,
      courseSlug: slug,
      moduleId: 'm-1',
      title: 'Sample Lesson',
      eyebrow: 'Demo',
      description: 'Has every section type.',
      estimatedMinutes: 10,
      sections: [],
    }),
    'utf8',
  );
}

describe('GET /api/courses/[slug]/lessons/[lessonSlug]/export/pdf', () => {
  beforeEach(() => {
    __resetForTesting();
  });
  afterEach(() => {
    __setLauncherForTesting(null);
    __resetForTesting();
  });

  it('returns 200 application/pdf with PDF magic bytes on the happy path', async () => {
    const { launcher, pdf } = makeFakeLauncher();
    __setLauncherForTesting(launcher);

    await withTempCoursesRoot(async (root) => {
      await seedLesson(root, 'course-x', 'lesson-1');
      const req = await makeReq('course-x', 'lesson-1');
      const res = await GET(req, {
        params: Promise.resolve({ slug: 'course-x', lessonSlug: 'lesson-1' }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="lesson-1.pdf"',
      );
      expect(res.headers.get('cache-control')).toBe('no-store');
      const buf = Buffer.from(await res.arrayBuffer());
      const magic = buf.slice(0, 5).toString('utf8');
      expect(magic).toBe('%PDF-');
      expect(pdf).toHaveBeenCalledTimes(1);
    });
  });

  it('writes the response to /tmp/<lessonSlug>.pdf and verifies magic bytes', async () => {
    const { launcher } = makeFakeLauncher();
    __setLauncherForTesting(launcher);

    await withTempCoursesRoot(async (root) => {
      await seedLesson(root, 'course-x', 'lesson-1');
      const req = await makeReq('course-x', 'lesson-1');
      const res = await GET(req, {
        params: Promise.resolve({ slug: 'course-x', lessonSlug: 'lesson-1' }),
      });
      const tmpFile = path.join(os.tmpdir(), 'us-153-route-test-lesson-1.pdf');
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(tmpFile, buf);
      const onDisk = await fs.readFile(tmpFile);
      expect(onDisk.slice(0, 5).toString('utf8')).toBe('%PDF-');
      await fs.unlink(tmpFile);
    });
  });

  it('returns 404 when the lesson file does not exist', async () => {
    __setLauncherForTesting(makeFakeLauncher().launcher);
    await withTempCoursesRoot(async (root) => {
      await fs.mkdir(path.join(root, 'course-x', 'lessons'), { recursive: true });
      const req = await makeReq('course-x', 'missing');
      const res = await GET(req, {
        params: Promise.resolve({ slug: 'course-x', lessonSlug: 'missing' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Lesson not found');
    });
  });

  it('returns 400 on unsafe slug', async () => {
    __setLauncherForTesting(makeFakeLauncher().launcher);
    const req = await makeReq('..', 'lesson-1');
    const res = await GET(req, {
      params: Promise.resolve({ slug: '..', lessonSlug: 'lesson-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 on unsafe lessonSlug', async () => {
    __setLauncherForTesting(makeFakeLauncher().launcher);
    const req = await makeReq('course-x', '../escape');
    const res = await GET(req, {
      params: Promise.resolve({ slug: 'course-x', lessonSlug: '../escape' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 503 with the retry-prompt message when the print page fetch fails with ECONNREFUSED', async () => {
    const { launcher, goto } = makeFakeLauncher({ gotoBehavior: 'econnrefused' });
    __setLauncherForTesting(launcher);

    await withTempCoursesRoot(async (root) => {
      await seedLesson(root, 'course-x', 'lesson-1');
      const req = await makeReq('course-x', 'lesson-1');
      const res = await GET(req, {
        params: Promise.resolve({ slug: 'course-x', lessonSlug: 'lesson-1' }),
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.message).toBe(
        'Dev server not running — start it before exporting PDF.',
      );
      // One retry after the initial failure → goto called twice.
      expect(goto).toHaveBeenCalledTimes(2);
    });
  });

  it('returns 500 when page.pdf() throws', async () => {
    const { launcher } = makeFakeLauncher({ pdfThrows: true });
    __setLauncherForTesting(launcher);

    await withTempCoursesRoot(async (root) => {
      await seedLesson(root, 'course-x', 'lesson-1');
      const req = await makeReq('course-x', 'lesson-1');
      const res = await GET(req, {
        params: Promise.resolve({ slug: 'course-x', lessonSlug: 'lesson-1' }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('pdf-render-failed');
      expect(body.message).toContain('pdf rendering crashed');
    });
  });

  it('returns 404 when the print page does not render the expected root', async () => {
    const { launcher } = makeFakeLauncher({ evaluatedOk: false });
    __setLauncherForTesting(launcher);

    await withTempCoursesRoot(async (root) => {
      await seedLesson(root, 'course-x', 'lesson-1');
      const req = await makeReq('course-x', 'lesson-1');
      const res = await GET(req, {
        params: Promise.resolve({ slug: 'course-x', lessonSlug: 'lesson-1' }),
      });
      expect(res.status).toBe(404);
    });
  });

  it('reuses the singleton browser across two consecutive calls', async () => {
    const { launcher, browser } = makeFakeLauncher();
    __setLauncherForTesting(launcher);

    await withTempCoursesRoot(async (root) => {
      await seedLesson(root, 'course-x', 'lesson-1');
      for (let i = 0; i < 2; i++) {
        const req = await makeReq('course-x', 'lesson-1');
        const res = await GET(req, {
          params: Promise.resolve({ slug: 'course-x', lessonSlug: 'lesson-1' }),
        });
        expect(res.status).toBe(200);
      }
      // Browser launched ONCE; newPage called TWICE.
      expect(launcher.launch).toHaveBeenCalledTimes(1);
      expect(
        (browser as unknown as { newPage: import('vitest').Mock }).newPage,
      ).toHaveBeenCalledTimes(2);
    });
  });

  it('produces a content-disposition with the lessonSlug as the filename stem', async () => {
    const { launcher } = makeFakeLauncher();
    __setLauncherForTesting(launcher);

    await withTempCoursesRoot(async (root) => {
      await seedLesson(root, 'course-x', 'numpy-basics');
      const req = await makeReq('course-x', 'numpy-basics');
      const res = await GET(req, {
        params: Promise.resolve({ slug: 'course-x', lessonSlug: 'numpy-basics' }),
      });
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="numpy-basics.pdf"',
      );
    });
  });
});
