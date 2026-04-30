import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  GET as getProgress,
  PATCH as patchProgress,
} from '@/app/api/progress/route';

let tmpRoot: string;
let progressPath: string;

const makeRequest = (body: unknown) =>
  new Request('http://x/api/progress', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-progress-'));
  progressPath = path.join(tmpRoot, 'nested', 'dir', 'progress.json');
  process.env.PROGRESS_FILE_OVERRIDE = progressPath;
});

afterEach(async () => {
  delete process.env.PROGRESS_FILE_OVERRIDE;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('GET /api/progress', () => {
  it('creates the file with default shape when missing and auto-creates parent dir', async () => {
    await expect(fs.access(progressPath)).rejects.toThrow();
    await expect(fs.access(path.dirname(progressPath))).rejects.toThrow();

    const res = await getProgress();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ courses: {} });

    const onDisk = JSON.parse(await fs.readFile(progressPath, 'utf8'));
    expect(onDisk).toEqual({ courses: {} });
  });

  it('returns existing content when file is present', async () => {
    const seeded = {
      courses: {
        'algo-101': {
          lastVisitedLessonSlug: 'lesson-a',
          lastVisitedAt: '2026-04-29T10:00:00.000Z',
          lessons: {
            'lesson-a': { status: 'finished', finishedAt: '2026-04-29T10:00:00.000Z' },
          },
        },
      },
    };
    await fs.mkdir(path.dirname(progressPath), { recursive: true });
    await fs.writeFile(progressPath, JSON.stringify(seeded), 'utf8');

    const res = await getProgress();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(seeded);
  });
});

describe('PATCH /api/progress', () => {
  it('400s on invalid JSON body', async () => {
    const req = new Request('http://x/api/progress', {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await patchProgress(req);
    expect(res.status).toBe(400);
  });

  it('400s on payload missing courseSlug', async () => {
    const res = await patchProgress(makeRequest({ lessonSlug: 'l1', status: 'started' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid progress patch');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('400s on invalid status enum value', async () => {
    const res = await patchProgress(
      makeRequest({ courseSlug: 'c', lessonSlug: 'l', status: 'bogus' }),
    );
    expect(res.status).toBe(400);
  });

  it('persists status update and creates the file from default if missing', async () => {
    const res = await patchProgress(
      makeRequest({ courseSlug: 'c1', lessonSlug: 'l1', status: 'started' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.courses.c1.lessons.l1.status).toBe('started');
    expect(typeof body.courses.c1.lessons.l1.startedAt).toBe('string');

    const onDisk = JSON.parse(await fs.readFile(progressPath, 'utf8'));
    expect(onDisk.courses.c1.lessons.l1.status).toBe('started');
  });

  it('sets lastVisitedAt when status changes', async () => {
    const before = new Date().toISOString();
    const res = await patchProgress(
      makeRequest({ courseSlug: 'c1', lessonSlug: 'l1', status: 'started' }),
    );
    const body = await res.json();
    expect(body.courses.c1.lastVisitedAt).toBeDefined();
    expect(body.courses.c1.lastVisitedAt >= before).toBe(true);
    expect(body.courses.c1.lastVisitedLessonSlug).toBe('l1');
  });

  it('sets lastVisitedAt when markVisited=true even without status change', async () => {
    const res = await patchProgress(
      makeRequest({ courseSlug: 'c1', lessonSlug: 'l1', markVisited: true }),
    );
    const body = await res.json();
    expect(body.courses.c1.lastVisitedAt).toBeDefined();
    expect(body.courses.c1.lastVisitedLessonSlug).toBe('l1');
    expect(body.courses.c1.lessons.l1.status).toBe('not_started');
  });

  it('does not change lastVisitedAt when only sectionState is patched', async () => {
    await patchProgress(
      makeRequest({ courseSlug: 'c1', lessonSlug: 'l1', markVisited: true }),
    );
    const after1 = JSON.parse(await fs.readFile(progressPath, 'utf8'));
    const visitedAt = after1.courses.c1.lastVisitedAt;
    expect(visitedAt).toBeDefined();

    await new Promise((r) => setTimeout(r, 5));

    const res = await patchProgress(
      makeRequest({
        courseSlug: 'c1',
        lessonSlug: 'l1',
        sectionState: { 's1': { userCode: 'print(1)' } },
      }),
    );
    const body = await res.json();
    expect(body.courses.c1.lastVisitedAt).toBe(visitedAt);
    expect(body.courses.c1.lessons.l1.sectionState.s1.userCode).toBe('print(1)');
  });

  it('does not change lastVisitedAt when status is provided but equals current status', async () => {
    await patchProgress(
      makeRequest({ courseSlug: 'c1', lessonSlug: 'l1', status: 'started' }),
    );
    const after1 = JSON.parse(await fs.readFile(progressPath, 'utf8'));
    const visitedAt = after1.courses.c1.lastVisitedAt;

    await new Promise((r) => setTimeout(r, 5));

    const res = await patchProgress(
      makeRequest({ courseSlug: 'c1', lessonSlug: 'l1', status: 'started' }),
    );
    const body = await res.json();
    expect(body.courses.c1.lastVisitedAt).toBe(visitedAt);
  });

  it('merges sectionState across multiple patches', async () => {
    await patchProgress(
      makeRequest({
        courseSlug: 'c1',
        lessonSlug: 'l1',
        sectionState: { 's1': { userCode: 'a' } },
      }),
    );
    const res = await patchProgress(
      makeRequest({
        courseSlug: 'c1',
        lessonSlug: 'l1',
        sectionState: { 's2': { quizSubmission: [0, 1] } },
      }),
    );
    const body = await res.json();
    expect(body.courses.c1.lessons.l1.sectionState.s1.userCode).toBe('a');
    expect(body.courses.c1.lessons.l1.sectionState.s2.quizSubmission).toEqual([0, 1]);
  });

  it('preserves startedAt when transitioning started -> finished', async () => {
    await patchProgress(
      makeRequest({ courseSlug: 'c1', lessonSlug: 'l1', status: 'started' }),
    );
    const after1 = JSON.parse(await fs.readFile(progressPath, 'utf8'));
    const startedAt = after1.courses.c1.lessons.l1.startedAt;
    expect(startedAt).toBeDefined();

    await new Promise((r) => setTimeout(r, 5));

    const res = await patchProgress(
      makeRequest({ courseSlug: 'c1', lessonSlug: 'l1', status: 'finished' }),
    );
    const body = await res.json();
    expect(body.courses.c1.lessons.l1.startedAt).toBe(startedAt);
    expect(body.courses.c1.lessons.l1.finishedAt).toBeDefined();
    expect(body.courses.c1.lessons.l1.status).toBe('finished');
  });

  it('atomic write does not leave a .tmp file on success', async () => {
    await patchProgress(
      makeRequest({ courseSlug: 'c1', lessonSlug: 'l1', status: 'started' }),
    );
    const dir = path.dirname(progressPath);
    const entries = await fs.readdir(dir);
    expect(entries.some((n) => n.endsWith('.tmp'))).toBe(false);
    expect(entries).toContain(path.basename(progressPath));
  });
});
