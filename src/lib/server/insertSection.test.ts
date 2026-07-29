import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { POST as postInsert } from '@/app/api/courses/[slug]/lessons/[lessonSlug]/sections/[sectionId]/insert/route';
import { POST as postUndo } from '@/app/api/courses/[slug]/lessons/[lessonSlug]/sections/[sectionId]/insert/undo/route';
import {
  __setInsertSectionSpawnForTesting,
  makeUniqueSectionId,
  runInsertSectionAgent,
  type InsertSectionSpawnDeps,
} from '@/lib/server/insertSection';
import {
  __resetForTesting as __resetGenerationForTesting,
  __setActiveRunForTesting,
} from '@/lib/server/generation';

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
  spawn: InsertSectionSpawnDeps['spawn'];
  lastChild: () => FakeChildProcess | null;
} {
  let last: FakeChildProcess | null = null;
  const spawn = ((_command: string, _args: readonly string[] = []) => {
    const child = new FakeChildProcess(opts);
    last = child;
    return child as unknown as ChildProcess;
  }) as unknown as InsertSectionSpawnDeps['spawn'];
  return { spawn, lastChild: () => last };
}

const COURSE_SLUG = 'image-denoising';
const LESSON_SLUG = 'median-filter';

const sampleLesson = () => ({
  schemaVersion: 1 as const,
  slug: LESSON_SLUG,
  courseSlug: COURSE_SLUG,
  moduleId: 'm2',
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
    {
      id: 'closing',
      title: 'Wrap',
      type: 'theory' as const,
      data: { markdown: 'In summary, the median filter …' },
    },
  ],
});

const lessonPath = () =>
  path.join(coursesRoot, COURSE_SLUG, 'lessons', `${LESSON_SLUG}.json`);
const snapshotPath = () =>
  path.join(coursesRoot, COURSE_SLUG, 'lessons', `${LESSON_SLUG}.lesson-prev.json`);

async function seedLesson() {
  const dir = path.join(coursesRoot, COURSE_SLUG, 'lessons');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    lessonPath(),
    JSON.stringify(sampleLesson(), null, 2),
    'utf8',
  );
}

// A valid agent response: one brand-new theory section. The proposed id
// deliberately collides with an existing section ('intro') so the route's
// unique-id logic is exercised by default.
const validAgentResponse = (id = 'intro') =>
  JSON.stringify({
    newSection: {
      id,
      title: 'A 3×3 median, step by step',
      type: 'theory',
      data: { markdown: 'Take this noisy 3×3 neighbourhood and sort the nine values …' },
    },
  });

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-insert-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
  process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(
    coursesRoot,
    'generation-queue.json',
  );
  __resetGenerationForTesting();
});

afterEach(async () => {
  __setInsertSectionSpawnForTesting(null);
  __resetGenerationForTesting();
  delete process.env.COURSES_ROOT_OVERRIDE;
  delete process.env.GENERATION_QUEUE_FILE_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
});

function insertReq(sectionId: string, body: unknown): Request {
  return new Request(
    `http://x/api/courses/${COURSE_SLUG}/lessons/${LESSON_SLUG}/sections/${sectionId}/insert`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}

const ctx = (
  overrides: Partial<{ slug: string; lessonSlug: string; sectionId: string }> = {},
) => ({
  params: Promise.resolve({
    slug: COURSE_SLUG,
    lessonSlug: LESSON_SLUG,
    sectionId: 'intro',
    ...overrides,
  }),
});

describe('makeUniqueSectionId', () => {
  it('returns the candidate unchanged when it is free', () => {
    expect(makeUniqueSectionId(['a', 'b'], 'c')).toBe('c');
  });

  it('appends a numeric suffix on collision', () => {
    expect(makeUniqueSectionId(['intro', 'check-1'], 'intro')).toBe('intro-2');
  });

  it('keeps incrementing past existing suffixed ids', () => {
    expect(makeUniqueSectionId(['intro', 'intro-2', 'intro-3'], 'intro')).toBe(
      'intro-4',
    );
  });

  it('falls back to "section" for a blank candidate', () => {
    expect(makeUniqueSectionId(['section'], '   ')).toBe('section-2');
  });
});

describe('POST .../sections/[sectionId]/insert (US-208)', () => {
  it('inserts the new section directly after a MIDDLE anchor section', async () => {
    await seedLesson();
    const { spawn, lastChild } = makeFixedSpawn({
      stdoutText: validAgentResponse('example'),
      exitCode: 0,
    });
    __setInsertSectionSpawnForTesting({ spawn });

    const res = await postInsert(
      insertReq('check-1', { instruction: 'Add a worked example.' }),
      ctx({ sectionId: 'check-1' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hasUndo).toBe(true);

    const after = JSON.parse(await fs.readFile(lessonPath(), 'utf8'));
    const ids = after.sections.map((s: { id: string }) => s.id);
    // New section sits immediately after 'check-1', before 'closing'.
    expect(ids).toEqual(['intro', 'check-1', 'example', 'closing']);
    expect(after.sections[2].type).toBe('theory');

    // Agent received the full lesson + the anchor id + the instruction.
    const stdin = JSON.parse(lastChild()!.capturedStdin);
    expect(stdin.anchorSectionId).toBe('check-1');
    expect(stdin.instruction).toBe('Add a worked example.');
    expect(stdin.lessonContext.sections).toHaveLength(3);
  });

  it('inserts after the LAST section (appends to the end)', async () => {
    await seedLesson();
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse('recap') }).spawn,
    });

    const res = await postInsert(
      insertReq('closing', { instruction: 'Add a final recap.' }),
      ctx({ sectionId: 'closing' }),
    );
    expect(res.status).toBe(200);

    const after = JSON.parse(await fs.readFile(lessonPath(), 'utf8'));
    const ids = after.sections.map((s: { id: string }) => s.id);
    expect(ids).toEqual(['intro', 'check-1', 'closing', 'recap']);
  });

  it('assigns a collision-free id when the agent proposes an existing id', async () => {
    await seedLesson();
    // Agent proposes 'intro', which already exists.
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse('intro') }).spawn,
    });

    const res = await postInsert(
      insertReq('intro', { instruction: 'Expand the intro.' }),
      ctx({ sectionId: 'intro' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.newSection.id).toBe('intro-2');

    const after = JSON.parse(await fs.readFile(lessonPath(), 'utf8'));
    const ids = after.sections.map((s: { id: string }) => s.id);
    expect(ids).toEqual(['intro', 'intro-2', 'check-1', 'closing']);
    // All ids unique.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves existing sections byte-identical in content and order', async () => {
    await seedLesson();
    const before = JSON.parse(await fs.readFile(lessonPath(), 'utf8'));
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse('example') }).spawn,
    });

    await postInsert(
      insertReq('check-1', { instruction: 'Add an example.' }),
      ctx({ sectionId: 'check-1' }),
    );

    const after = JSON.parse(await fs.readFile(lessonPath(), 'utf8'));
    for (const id of ['intro', 'check-1', 'closing']) {
      const b = before.sections.find((s: { id: string }) => s.id === id);
      const a = after.sections.find((s: { id: string }) => s.id === id);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
    // Top-level metadata stable.
    expect(after.title).toBe(before.title);
    expect(after.estimatedMinutes).toBe(before.estimatedMinutes);
  });

  it('returns 422 and does NOT modify the lesson on invalid agent output', async () => {
    await seedLesson();
    const before = await fs.readFile(lessonPath(), 'utf8');
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: 'not json at all' }).spawn,
    });

    const res = await postInsert(
      insertReq('check-1', { instruction: 'Add an example.' }),
      ctx({ sectionId: 'check-1' }),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('agent-output-invalid');

    // No write, no snapshot.
    expect(await fs.readFile(lessonPath(), 'utf8')).toBe(before);
    await expect(fs.access(snapshotPath())).rejects.toThrow();
  });

  it('returns 422 when the agent JSON fails the section schema', async () => {
    await seedLesson();
    const badShape = JSON.stringify({
      newSection: { id: 'x', type: 'theory' /* missing title + data */ },
    });
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: badShape }).spawn,
    });
    const res = await postInsert(
      insertReq('check-1', { instruction: 'Add an example.' }),
      ctx({ sectionId: 'check-1' }),
    );
    expect(res.status).toBe(422);
  });

  it('returns 500 and does NOT modify the lesson on a non-zero agent exit (timeout)', async () => {
    await seedLesson();
    const before = await fs.readFile(lessonPath(), 'utf8');
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: '', stderrText: 'killed', exitCode: 1 }).spawn,
    });
    const res = await postInsert(
      insertReq('check-1', { instruction: 'Add an example.' }),
      ctx({ sectionId: 'check-1' }),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('agent-spawn-failed');
    expect(await fs.readFile(lessonPath(), 'utf8')).toBe(before);
    await expect(fs.access(snapshotPath())).rejects.toThrow();
  });

  it('returns 400 on a missing instruction', async () => {
    await seedLesson();
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postInsert(insertReq('check-1', {}), ctx({ sectionId: 'check-1' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on a too-long instruction', async () => {
    await seedLesson();
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postInsert(
      insertReq('check-1', { instruction: 'x'.repeat(1001) }),
      ctx({ sectionId: 'check-1' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when the anchor section is not found', async () => {
    await seedLesson();
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postInsert(
      insertReq('no-such', { instruction: 'Add an example.' }),
      ctx({ sectionId: 'no-such' }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when the lesson does not exist', async () => {
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postInsert(
      insertReq('check-1', { instruction: 'Add an example.' }),
      ctx({ sectionId: 'check-1' }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 on an unsafe slug', async () => {
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postInsert(
      insertReq('check-1', { instruction: 'Add an example.' }),
      ctx({ slug: '../escape', sectionId: 'check-1' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 409 busy when a generation is active for this slug', async () => {
    await seedLesson();
    __setActiveRunForTesting(COURSE_SLUG);
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postInsert(
      insertReq('check-1', { instruction: 'Add an example.' }),
      ctx({ sectionId: 'check-1' }),
    );
    expect(res.status).toBe(409);
  });
});

describe('POST .../sections/[sectionId]/insert/undo (US-208)', () => {
  it('restores the pre-insert lesson byte-for-byte and clears the snapshot', async () => {
    await seedLesson();
    const original = await fs.readFile(lessonPath(), 'utf8');
    __setInsertSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse('example') }).spawn,
    });

    const insertRes = await postInsert(
      insertReq('check-1', { instruction: 'Add an example.' }),
      ctx({ sectionId: 'check-1' }),
    );
    expect(insertRes.status).toBe(200);
    // The lesson now has 4 sections; the snapshot exists.
    const afterInsert = JSON.parse(await fs.readFile(lessonPath(), 'utf8'));
    expect(afterInsert.sections).toHaveLength(4);
    expect(await fs.readFile(snapshotPath(), 'utf8')).toBe(original);

    const undoRes = await postUndo(
      new Request('http://x/undo', { method: 'POST' }),
      ctx({ sectionId: 'check-1' }),
    );
    expect(undoRes.status).toBe(200);
    const undoJson = await undoRes.json();
    expect(undoJson.restoredLesson.sections).toHaveLength(3);

    // Lesson is back to its exact pre-insert bytes; snapshot is gone.
    expect(await fs.readFile(lessonPath(), 'utf8')).toBe(original);
    await expect(fs.access(snapshotPath())).rejects.toThrow();
  });

  it('returns 404 when there is no snapshot to undo', async () => {
    await seedLesson();
    const res = await postUndo(
      new Request('http://x/undo', { method: 'POST' }),
      ctx({ sectionId: 'check-1' }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 on an unsafe slug', async () => {
    const res = await postUndo(
      new Request('http://x/undo', { method: 'POST' }),
      ctx({ slug: '../escape', sectionId: 'check-1' }),
    );
    expect(res.status).toBe(400);
  });
});

// ── Course-aware spawn args: model pin + working-memory pointers ─────────────
describe('insert_section spawn args (model pin + working memory)', () => {
  function makeArgsCapturingSpawn() {
    let captured: { command: string; args: string[] } | null = null;
    const spawn = ((command: string, args: readonly string[] = []) => {
      captured = { command, args: [...args] };
      return new FakeChildProcess({
        stdoutText: validAgentResponse(),
      }) as unknown as ChildProcess;
    }) as unknown as InsertSectionSpawnDeps['spawn'];
    return { spawn, captured: () => captured };
  }

  function agentInput() {
    return {
      lessonContext: sampleLesson(),
      anchorSectionId: 'check-1',
      instruction: 'Add a worked example.',
    } as unknown as Parameters<typeof runInsertSectionAgent>[0];
  }

  it('pins --model opus and omits working-memory pointers for a plain course', async () => {
    await seedLesson();
    const { spawn, captured } = makeArgsCapturingSpawn();
    __setInsertSectionSpawnForTesting({ spawn });

    await runInsertSectionAgent(agentInput());

    const args = captured()!.args;
    const modelIdx = args.indexOf('--model');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(args[modelIdx + 1]).toBe('opus');
    expect(args[1]).not.toContain('Course working memory');
  });

  it('points the agent at research.md and sources.md when they exist', async () => {
    await seedLesson();
    await fs.writeFile(
      path.join(coursesRoot, COURSE_SLUG, 'research.md'),
      '# Research: stub\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(coursesRoot, COURSE_SLUG, 'sources.md'),
      '# Sources: stub\n',
      'utf8',
    );
    const { spawn, captured } = makeArgsCapturingSpawn();
    __setInsertSectionSpawnForTesting({ spawn });

    await runInsertSectionAgent(agentInput());

    const prompt = captured()!.args[1];
    expect(prompt).toContain('Course working memory');
    expect(prompt).toContain(`/courses/${COURSE_SLUG}/research.md`);
    expect(prompt).toContain(`/courses/${COURSE_SLUG}/sources.md`);
  });
});
