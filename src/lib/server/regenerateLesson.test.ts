import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { POST as postRegenerate } from '@/app/api/courses/[slug]/lessons/[lessonSlug]/regenerate/route';
import { POST as postUndo } from '@/app/api/courses/[slug]/lessons/[lessonSlug]/regenerate/undo/route';
import { GET as getStatus } from '@/app/api/courses/[slug]/lessons/[lessonSlug]/regenerate/status/route';
import {
  __setRegenerateLessonSpawnForTesting,
  defaultRegenerateLessonCommand,
  type RegenerateLessonSpawnDeps,
} from '@/lib/server/regenerateLesson';
import { __resetForTesting as __resetGenerationForTesting } from '@/lib/server/generation';

let coursesRoot: string;

class FakeChildProcess extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  pid = 4243;
  capturedStdin = '';
  constructor(opts: { stdoutText?: string; stderrText?: string; exitCode?: number }) {
    super();
    const exitCode = opts.exitCode ?? 0;
    const stdoutText = opts.stdoutText ?? '';
    const stderrText = opts.stderrText ?? '';

    const captured: Buffer[] = [];
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _enc, cb) => {
        captured.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
      final: (cb) => {
        this.capturedStdin = Buffer.concat(captured).toString('utf8');
        setImmediate(() => {
          this.stdout.push(Buffer.from(stdoutText, 'utf8'));
          this.stdout.push(null);
          this.stderr.push(Buffer.from(stderrText, 'utf8'));
          this.stderr.push(null);
          this.emit('exit', exitCode, null);
          setImmediate(() => this.emit('close', exitCode, null));
        });
        cb();
      },
    });

    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
}

function makeFixedSpawn(opts: {
  stdoutText?: string;
  stderrText?: string;
  exitCode?: number;
}): {
  spawn: RegenerateLessonSpawnDeps['spawn'];
  lastChild: () => FakeChildProcess | null;
} {
  let last: FakeChildProcess | null = null;
  const spawn = ((_command: string, _args: readonly string[] = []) => {
    const child = new FakeChildProcess(opts);
    last = child;
    return child as unknown as ChildProcess;
  }) as unknown as RegenerateLessonSpawnDeps['spawn'];
  return { spawn, lastChild: () => last };
}

const COURSE_SLUG = 'image-denoising';
const LESSON_SLUG = 'median-filter';
const MODULE_ID = 'm2';

const sampleCourse = () => ({
  schemaVersion: 1 as const,
  slug: COURSE_SLUG,
  title: 'Image denoising',
  description: 'Course on denoising images.',
  accentColor: 'indigo' as const,
  icon: 'Sparkles',
  modules: [
    {
      id: 'm1',
      title: 'Foundations',
      summary: 'Setting the stage.',
      lessons: [{ slug: 'intro', title: 'Intro', estimatedMinutes: 8 }],
    },
    {
      id: MODULE_ID,
      title: 'Non-linear filters',
      summary: 'Median, bilateral, and friends.',
      lessons: [
        { slug: LESSON_SLUG, title: 'Median filter', estimatedMinutes: 12 },
      ],
    },
  ],
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
});

const sampleLesson = () => ({
  schemaVersion: 1 as const,
  slug: LESSON_SLUG,
  courseSlug: COURSE_SLUG,
  moduleId: MODULE_ID,
  title: 'Median filter',
  eyebrow: 'NON-LINEAR FILTERS',
  description: 'Replace each pixel with the median of its neighbourhood.',
  estimatedMinutes: 12,
  sections: [
    {
      id: 'intro',
      title: 'Intro',
      type: 'theory' as const,
      data: { markdown: 'Salt-and-pepper noise plants outliers …' },
    },
    {
      id: 'check-1',
      title: 'Quick check',
      type: 'quiz' as const,
      data: {
        question: 'Which filter best removes salt-and-pepper noise?',
        options: ['Mean', 'Median', 'Gaussian', 'None'],
        correct: [1],
        explanation: 'The median ignores outliers in the window.',
        multiSelect: false,
      },
    },
  ],
});

const lessonPath = () =>
  path.join(coursesRoot, COURSE_SLUG, 'lessons', `${LESSON_SLUG}.json`);
const snapshotPath = () =>
  path.join(coursesRoot, COURSE_SLUG, 'lessons', `${LESSON_SLUG}.lesson-prev.json`);

async function seedCourseAndLesson() {
  await fs.mkdir(path.join(coursesRoot, COURSE_SLUG, 'lessons'), { recursive: true });
  await fs.writeFile(
    path.join(coursesRoot, COURSE_SLUG, 'course.json'),
    JSON.stringify(sampleCourse(), null, 2),
    'utf8',
  );
  await fs.writeFile(
    lessonPath(),
    JSON.stringify(sampleLesson(), null, 2),
    'utf8',
  );
}

const buildNewLesson = (overrides: Partial<ReturnType<typeof sampleLesson>> = {}) => ({
  ...sampleLesson(),
  description: 'A revamped, more code-heavy take on the median filter.',
  estimatedMinutes: 14,
  sections: [
    {
      id: 'intuition',
      title: 'Why a median?',
      type: 'theory' as const,
      data: { markdown: 'New intuition write-up …' },
    },
    {
      id: 'code-implement',
      title: 'Implement it',
      type: 'code' as const,
      data: {
        taskMarkdown: 'Implement a 1-D median filter.',
        starterCode: 'def median_filter(xs, k=3):\n    pass\n',
        solution:
          'def median_filter(xs, k=3):\n    half = k // 2\n    return [sorted(xs[max(0,i-half):i+half+1])[len(xs[max(0,i-half):i+half+1])//2] for i in range(len(xs))]\n',
        tests: [
          {
            name: 'returns_same_length',
            body: 'assert len(median_filter([1,2,3,4,5])) == 5',
          },
          {
            name: 'kills_isolated_outlier',
            body: 'assert median_filter([1,1,99,1,1])[2] == 1',
          },
        ],
      },
    },
    {
      id: 'wrap',
      title: 'Wrap',
      type: 'theory' as const,
      data: { markdown: 'Recap of the median filter …' },
    },
  ],
  ...overrides,
});

const validAgentResponse = (overrides: Partial<ReturnType<typeof sampleLesson>> = {}) =>
  JSON.stringify({ newLesson: buildNewLesson(overrides) });

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-regen-lesson-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
  process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(
    coursesRoot,
    'generation-queue.json',
  );
  __resetGenerationForTesting();
});

afterEach(async () => {
  __setRegenerateLessonSpawnForTesting(null);
  __resetGenerationForTesting();
  delete process.env.COURSES_ROOT_OVERRIDE;
  delete process.env.GENERATION_QUEUE_FILE_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
});

function regenReq(body: unknown): Request {
  return new Request(
    `http://x/api/courses/${COURSE_SLUG}/lessons/${LESSON_SLUG}/regenerate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}

function undoReq(): Request {
  return new Request(
    `http://x/api/courses/${COURSE_SLUG}/lessons/${LESSON_SLUG}/regenerate/undo`,
    { method: 'POST' },
  );
}

const ctx = (overrides: Partial<{ slug: string; lessonSlug: string }> = {}) => ({
  params: Promise.resolve({
    slug: COURSE_SLUG,
    lessonSlug: LESSON_SLUG,
    ...overrides,
  }),
});

describe('POST .../lessons/[lessonSlug]/regenerate (US-148)', () => {
  it('writes newLesson and snapshots prior lesson byte-identically (hasUndo=true)', async () => {
    await seedCourseAndLesson();
    const before = await fs.readFile(lessonPath(), 'utf8');
    const { spawn, lastChild } = makeFixedSpawn({
      stdoutText: validAgentResponse(),
      exitCode: 0,
    });
    __setRegenerateLessonSpawnForTesting({ spawn });

    const res = await postRegenerate(
      regenReq({ instruction: 'Make this more code-heavy.' }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hasUndo).toBe(true);
    expect(json.newLesson.slug).toBe(LESSON_SLUG);
    expect(json.newLesson.title).toBe('Median filter');
    expect(json.newLesson.moduleId).toBe(MODULE_ID);
    expect(json.newLesson.sections).toHaveLength(3);

    // Snapshot is byte-identical to the lesson.json that was on disk.
    const snap = await fs.readFile(snapshotPath(), 'utf8');
    expect(snap).toBe(before);

    // lesson.json now reflects newLesson.
    const after = JSON.parse(await fs.readFile(lessonPath(), 'utf8'));
    expect(after.estimatedMinutes).toBe(14);
    expect(after.sections.map((s: { id: string }) => s.id)).toEqual([
      'intuition',
      'code-implement',
      'wrap',
    ]);

    // Agent received the full course + currentLesson + instruction.
    const stdinJson = JSON.parse(lastChild()!.capturedStdin);
    expect(stdinJson.instruction).toBe('Make this more code-heavy.');
    expect(stdinJson.courseSchema.slug).toBe(COURSE_SLUG);
    expect(stdinJson.currentLesson.slug).toBe(LESSON_SLUG);
    expect(stdinJson.currentLesson.sections).toHaveLength(2);
  });

  it('regenerate twice in a row: second snapshot is the FIRST regenerate output', async () => {
    await seedCourseAndLesson();
    const original = await fs.readFile(lessonPath(), 'utf8');

    // First regenerate.
    const first = makeFixedSpawn({ stdoutText: validAgentResponse(), exitCode: 0 });
    __setRegenerateLessonSpawnForTesting({ spawn: first.spawn });
    const res1 = await postRegenerate(regenReq({ instruction: 'first' }), ctx());
    expect(res1.status).toBe(200);
    expect(await fs.readFile(snapshotPath(), 'utf8')).toBe(original);

    // The lesson.json now is the first regenerate's output. Capture it.
    const afterFirst = await fs.readFile(lessonPath(), 'utf8');

    // Second regenerate uses a different output to be sure the snapshot
    // policy overwrites with the fresh "previous" state.
    const altLesson = {
      ...buildNewLesson(),
      estimatedMinutes: 9,
      description: 'Second regenerate — much shorter.',
      sections: [
        {
          id: 'intuition2',
          title: 'Quick intuition',
          type: 'theory',
          data: { markdown: 'Shorter intuition only.' },
        },
        {
          id: 'check2',
          title: 'Confirm',
          type: 'quiz',
          data: {
            question: 'Did you get it?',
            options: ['Yes', 'No'],
            correct: [0],
            explanation: 'Excellent.',
            multiSelect: false,
          },
        },
      ],
    };
    const second = makeFixedSpawn({
      stdoutText: JSON.stringify({ newLesson: altLesson }),
      exitCode: 0,
    });
    __setRegenerateLessonSpawnForTesting({ spawn: second.spawn });
    const res2 = await postRegenerate(regenReq({ instruction: 'shorter' }), ctx());
    expect(res2.status).toBe(200);

    // Snapshot now contains the FIRST regenerate output (one-step undo only).
    expect(await fs.readFile(snapshotPath(), 'utf8')).toBe(afterFirst);
    // The original is gone — unrecoverable, by design.
    expect(await fs.readFile(snapshotPath(), 'utf8')).not.toBe(original);
  });

  it('returns 400 on a missing instruction', async () => {
    await seedCourseAndLesson();
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(regenReq({}), ctx());
    expect(res.status).toBe(400);
  });

  it('returns 400 on an instruction longer than 2000 chars', async () => {
    await seedCourseAndLesson();
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'x'.repeat(2001) }),
      ctx(),
    );
    expect(res.status).toBe(400);
  });

  it('accepts an instruction at the upper bound (2000 chars)', async () => {
    await seedCourseAndLesson();
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'x'.repeat(2000) }),
      ctx(),
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 on an unparseable JSON body', async () => {
    await seedCourseAndLesson();
    const res = await postRegenerate(regenReq('{not-json'), ctx());
    expect(res.status).toBe(400);
  });

  it('returns 400 on an unsafe slug', async () => {
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      ctx({ slug: '../escape' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when the course does not exist', async () => {
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      ctx(),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when the lesson does not exist', async () => {
    await fs.mkdir(path.join(coursesRoot, COURSE_SLUG), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, COURSE_SLUG, 'course.json'),
      JSON.stringify(sampleCourse(), null, 2),
      'utf8',
    );
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      ctx(),
    );
    expect(res.status).toBe(404);
  });

  it('returns 422 on agent non-JSON; lesson.json untouched, no snapshot', async () => {
    await seedCourseAndLesson();
    const before = await fs.readFile(lessonPath(), 'utf8');
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: 'not json at all' }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      ctx(),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('agent-output-invalid');
    expect(json.rawOutput).toContain('not json at all');

    // lesson.json untouched, no snapshot.
    expect(await fs.readFile(lessonPath(), 'utf8')).toBe(before);
    await expect(fs.access(snapshotPath())).rejects.toBeTruthy();
  });

  it('returns 422 when newLesson fails LessonSchema; no snapshot, lesson.json untouched', async () => {
    await seedCourseAndLesson();
    const before = await fs.readFile(lessonPath(), 'utf8');
    const badShape = JSON.stringify({
      newLesson: { slug: LESSON_SLUG, title: 'Median filter' /* missing required */ },
    });
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: badShape }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      ctx(),
    );
    expect(res.status).toBe(422);
    expect(await fs.readFile(lessonPath(), 'utf8')).toBe(before);
    await expect(fs.access(snapshotPath())).rejects.toBeTruthy();
  });

  it('returns 422 when the agent drifts the slug; no snapshot, lesson.json untouched', async () => {
    await seedCourseAndLesson();
    const before = await fs.readFile(lessonPath(), 'utf8');
    const drifted = JSON.stringify({
      newLesson: { ...buildNewLesson(), slug: 'renamed-lesson' },
    });
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: drifted }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      ctx(),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('agent-output-invalid');
    expect(json.message).toContain('renamed-lesson');

    expect(await fs.readFile(lessonPath(), 'utf8')).toBe(before);
    await expect(fs.access(snapshotPath())).rejects.toBeTruthy();
  });

  it('returns 422 when the agent drifts the title; no snapshot, lesson.json untouched', async () => {
    await seedCourseAndLesson();
    const before = await fs.readFile(lessonPath(), 'utf8');
    const drifted = JSON.stringify({
      newLesson: { ...buildNewLesson(), title: 'Renamed title' },
    });
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: drifted }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      ctx(),
    );
    expect(res.status).toBe(422);
    expect(await fs.readFile(lessonPath(), 'utf8')).toBe(before);
    await expect(fs.access(snapshotPath())).rejects.toBeTruthy();
  });

  it('returns 422 when the agent drifts the moduleId', async () => {
    await seedCourseAndLesson();
    const drifted = JSON.stringify({
      newLesson: { ...buildNewLesson(), moduleId: 'other-module' },
    });
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: drifted }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      ctx(),
    );
    expect(res.status).toBe(422);
  });

  it('returns 500 when the agent exits non-zero', async () => {
    await seedCourseAndLesson();
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({
        stdoutText: '',
        stderrText: 'boom',
        exitCode: 1,
      }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      ctx(),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('agent-spawn-failed');
  });

  it('returns 409 busy when a generation is active for this slug', async () => {
    await seedCourseAndLesson();
    await fs.writeFile(
      path.join(coursesRoot, COURSE_SLUG, '.generating.json'),
      JSON.stringify({
        childPid: process.pid,
        slug: COURSE_SLUG,
        stage: 'init_course',
        startedAt: '2026-05-08T00:00:00.000Z',
      }),
      'utf8',
    );
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      ctx(),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('busy');
  });
});

describe('POST .../lessons/[lessonSlug]/regenerate/undo (US-148)', () => {
  it('restores lesson.json from snapshot byte-identically and deletes snapshot', async () => {
    await seedCourseAndLesson();
    const original = await fs.readFile(lessonPath(), 'utf8');

    // Drive a regenerate to seed the snapshot.
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const regenRes = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      ctx(),
    );
    expect(regenRes.status).toBe(200);
    expect(await fs.readFile(lessonPath(), 'utf8')).not.toBe(original);
    expect(await fs.readFile(snapshotPath(), 'utf8')).toBe(original);

    // Undo.
    const undoRes = await postUndo(undoReq(), ctx());
    expect(undoRes.status).toBe(200);
    const json = await undoRes.json();
    expect(json.restoredLesson.slug).toBe(LESSON_SLUG);
    expect(json.restoredLesson.title).toBe('Median filter');

    // lesson.json restored byte-for-byte.
    expect(await fs.readFile(lessonPath(), 'utf8')).toBe(original);
    // snapshot gone.
    await expect(fs.access(snapshotPath())).rejects.toBeTruthy();
  });

  it('returns 404 when no snapshot exists', async () => {
    await seedCourseAndLesson();
    const res = await postUndo(undoReq(), ctx());
    expect(res.status).toBe(404);
  });

  it('after a successful undo, a second undo is 404 (single-step by design)', async () => {
    await seedCourseAndLesson();
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    await postRegenerate(regenReq({ instruction: 'shorter' }), ctx());

    const res1 = await postUndo(undoReq(), ctx());
    expect(res1.status).toBe(200);
    const res2 = await postUndo(undoReq(), ctx());
    expect(res2.status).toBe(404);
  });

  it('returns 400 on an unsafe slug', async () => {
    const res = await postUndo(undoReq(), ctx({ slug: '../escape' }));
    expect(res.status).toBe(400);
  });
});

function statusReq(): Request {
  return new Request(
    `http://x/api/courses/${COURSE_SLUG}/lessons/${LESSON_SLUG}/regenerate/status`,
    { method: 'GET' },
  );
}

describe('GET .../lessons/[lessonSlug]/regenerate/status (US-149)', () => {
  it('returns hasUndo:false when no snapshot exists', async () => {
    await seedCourseAndLesson();
    const res = await getStatus(statusReq(), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ hasUndo: false });
  });

  it('returns hasUndo:true after a regenerate has seeded the snapshot', async () => {
    await seedCourseAndLesson();
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    await postRegenerate(regenReq({ instruction: 'shorter' }), ctx());

    const res = await getStatus(statusReq(), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ hasUndo: true });
  });

  it('returns hasUndo:false again after undo consumes the snapshot', async () => {
    await seedCourseAndLesson();
    __setRegenerateLessonSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    await postRegenerate(regenReq({ instruction: 'shorter' }), ctx());
    expect((await getStatus(statusReq(), ctx())).status).toBe(200);

    await postUndo(undoReq(), ctx());
    const res = await getStatus(statusReq(), ctx());
    const json = await res.json();
    expect(json).toEqual({ hasUndo: false });
  });

  it('returns 400 on an unsafe slug', async () => {
    const res = await getStatus(statusReq(), ctx({ slug: '../escape' }));
    expect(res.status).toBe(400);
  });
});

// ── Model pin + working-memory pointers (course-aware spawn spec) ────────────

describe('defaultRegenerateLessonCommand (model pin + working memory)', () => {
  it('pins --model opus and embeds research/sources pointers when the files exist', () => {
    const { command, args } = defaultRegenerateLessonCommand({
      courseSlug: 'image-denoising',
      isQuizOnly: false,
      researchExists: true,
      sourcesExists: true,
    });
    expect(command).toBe('claude');
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
    expect(args[1]).toContain('Course working memory');
    expect(args[1]).toContain('/courses/image-denoising/research.md');
    expect(args[1]).toContain('/courses/image-denoising/sources.md');
  });

  it('pins --model sonnet for quiz-only courses and omits absent working-memory files', () => {
    const { args } = defaultRegenerateLessonCommand({
      courseSlug: 'quiz-course',
      isQuizOnly: true,
      researchExists: false,
      sourcesExists: false,
    });
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args[1]).not.toContain('Course working memory');
  });
});
