import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { POST as postRegenerate } from '@/app/api/courses/[slug]/lessons/[lessonSlug]/sections/[sectionId]/regenerate/route';
import { POST as postApply } from '@/app/api/courses/[slug]/lessons/[lessonSlug]/sections/[sectionId]/apply/route';
import {
  __setRegenerateSectionSpawnForTesting,
  runRegenerateSectionAgent,
  type RegenerateSectionSpawnDeps,
} from '@/lib/server/regenerateSection';
import { __resetForTesting as __resetGenerationForTesting } from '@/lib/server/generation';

let coursesRoot: string;

class FakeChildProcess extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  pid = 4242;
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
  spawn: RegenerateSectionSpawnDeps['spawn'];
  lastChild: () => FakeChildProcess | null;
} {
  let last: FakeChildProcess | null = null;
  const spawn = ((_command: string, _args: readonly string[] = []) => {
    const child = new FakeChildProcess(opts);
    last = child;
    return child as unknown as ChildProcess;
  }) as unknown as RegenerateSectionSpawnDeps['spawn'];
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

async function seedLesson() {
  const dir = path.join(coursesRoot, COURSE_SLUG, 'lessons');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${LESSON_SLUG}.json`),
    JSON.stringify(sampleLesson(), null, 2),
    'utf8',
  );
}

const validAgentResponse = () =>
  JSON.stringify({
    newSection: {
      id: 'check-1',
      title: 'Quick check: edge-preserving denoisers',
      type: 'quiz',
      data: {
        question: 'Which filters preserve edges while removing impulse noise? Select all that apply.',
        options: ['Mean', 'Median', 'Gaussian', 'Bilateral'],
        correct: [1, 3],
        explanation:
          'Both the median and bilateral filters are edge-preserving on impulse noise. The mean and Gaussian smear edges.',
        multiSelect: true,
      },
    },
  });

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-regen-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
  process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(
    coursesRoot,
    'generation-queue.json',
  );
  __resetGenerationForTesting();
});

afterEach(async () => {
  __setRegenerateSectionSpawnForTesting(null);
  __resetGenerationForTesting();
  delete process.env.COURSES_ROOT_OVERRIDE;
  delete process.env.GENERATION_QUEUE_FILE_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
});

function regenReq(body: unknown): Request {
  return new Request(
    `http://x/api/courses/${COURSE_SLUG}/lessons/${LESSON_SLUG}/sections/check-1/regenerate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}

function applyReq(sectionId: string, body: unknown): Request {
  return new Request(
    `http://x/api/courses/${COURSE_SLUG}/lessons/${LESSON_SLUG}/sections/${sectionId}/apply`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}

const regenCtx = (overrides: Partial<{ slug: string; lessonSlug: string; sectionId: string }> = {}) => ({
  params: Promise.resolve({
    slug: COURSE_SLUG,
    lessonSlug: LESSON_SLUG,
    sectionId: 'check-1',
    ...overrides,
  }),
});

describe('POST .../sections/[sectionId]/regenerate (US-146)', () => {
  it('returns 200 with newSection + oldSection on the happy path', async () => {
    await seedLesson();
    const { spawn, lastChild } = makeFixedSpawn({
      stdoutText: validAgentResponse(),
      exitCode: 0,
    });
    __setRegenerateSectionSpawnForTesting({ spawn });

    const res = await postRegenerate(
      regenReq({ instruction: 'Make this multi-select with two correct answers.' }),
      regenCtx(),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.newSection.id).toBe('check-1');
    expect(json.newSection.type).toBe('quiz');
    expect(json.newSection.data.multiSelect).toBe(true);
    expect(json.oldSection.id).toBe('check-1');
    expect(json.oldSection.data.multiSelect).toBe(false);

    const stdinJson = JSON.parse(lastChild()!.capturedStdin);
    expect(stdinJson.sectionId).toBe('check-1');
    expect(stdinJson.instruction).toBe('Make this multi-select with two correct answers.');
    expect(stdinJson.lessonContext.slug).toBe(LESSON_SLUG);
    // Confirms the agent receives the full lesson, not just the target section.
    expect(stdinJson.lessonContext.sections).toHaveLength(3);
  });

  it('returns 400 on a missing instruction', async () => {
    await seedLesson();
    __setRegenerateSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(regenReq({}), regenCtx());
    expect(res.status).toBe(400);
  });

  it('returns 400 on a too-long instruction', async () => {
    await seedLesson();
    __setRegenerateSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'x'.repeat(1001) }),
      regenCtx(),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on an unparseable JSON body', async () => {
    await seedLesson();
    const res = await postRegenerate(regenReq('{not-json'), regenCtx());
    expect(res.status).toBe(400);
  });

  it('returns 404 when the lesson does not exist', async () => {
    __setRegenerateSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      regenCtx(),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when the section is not found in the lesson', async () => {
    await seedLesson();
    __setRegenerateSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      regenCtx({ sectionId: 'no-such-section' }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 on an unsafe slug', async () => {
    __setRegenerateSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      regenCtx({ slug: '../escape' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 422 when the agent emits non-JSON', async () => {
    await seedLesson();
    __setRegenerateSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: 'not json at all' }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      regenCtx(),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('agent-output-invalid');
    expect(json.rawOutput).toContain('not json at all');
  });

  it('returns 422 when the agent emits JSON that fails the section schema', async () => {
    await seedLesson();
    const badShape = JSON.stringify({
      newSection: { id: 'check-1', type: 'quiz' /* missing title + data */ },
    });
    __setRegenerateSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: badShape }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      regenCtx(),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('agent-output-invalid');
  });

  it('returns 422 when the agent changes the section id', async () => {
    await seedLesson();
    const driftedId = JSON.stringify({
      newSection: {
        id: 'check-1-renamed',
        title: 'Quick check',
        type: 'quiz',
        data: {
          question: 'q?',
          options: ['a', 'b'],
          correct: [0],
          explanation: 'because',
          multiSelect: false,
        },
      },
    });
    __setRegenerateSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: driftedId }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      regenCtx(),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('agent-output-invalid');
    expect(json.message).toContain('check-1-renamed');
  });

  it('returns 422 when the agent changes the section kind (type)', async () => {
    await seedLesson();
    const driftedKind = JSON.stringify({
      newSection: {
        id: 'check-1',
        title: 'Quick check',
        type: 'theory',
        data: { markdown: 'This used to be a quiz!' },
      },
    });
    __setRegenerateSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: driftedKind }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'rewrite' }),
      regenCtx(),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('agent-output-invalid');
    expect(json.message).toContain('"theory"');
  });

  it('returns 500 when the agent exits non-zero', async () => {
    await seedLesson();
    __setRegenerateSectionSpawnForTesting({
      spawn: makeFixedSpawn({
        stdoutText: '',
        stderrText: 'boom',
        exitCode: 1,
      }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      regenCtx(),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('agent-spawn-failed');
  });

  it('returns 409 busy when a generation is active for this slug', async () => {
    await seedLesson();
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
    __setRegenerateSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      regenCtx(),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('busy');
  });

  it('does not modify any files on disk', async () => {
    await seedLesson();
    const before = await fs.readFile(
      path.join(coursesRoot, COURSE_SLUG, 'lessons', `${LESSON_SLUG}.json`),
      'utf8',
    );
    __setRegenerateSectionSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse() }).spawn,
    });
    const res = await postRegenerate(
      regenReq({ instruction: 'shorter' }),
      regenCtx(),
    );
    expect(res.status).toBe(200);
    const after = await fs.readFile(
      path.join(coursesRoot, COURSE_SLUG, 'lessons', `${LESSON_SLUG}.json`),
      'utf8',
    );
    expect(after).toBe(before);
  });
});

describe('POST .../sections/[sectionId]/apply (US-146)', () => {
  const buildNewSection = () => ({
    id: 'check-1',
    title: 'Quick check (revised)',
    type: 'quiz' as const,
    data: {
      question: 'Updated question?',
      options: ['Mean', 'Median', 'Gaussian', 'Bilateral'],
      correct: [1, 3],
      explanation: 'Both median and bilateral are edge-preserving.',
      multiSelect: true,
    },
  });

  it('replaces only the targeted section and writes lesson.json', async () => {
    await seedLesson();
    const lessonPath = path.join(
      coursesRoot,
      COURSE_SLUG,
      'lessons',
      `${LESSON_SLUG}.json`,
    );
    const before = JSON.parse(await fs.readFile(lessonPath, 'utf8'));

    const res = await postApply(
      applyReq('check-1', { newSection: buildNewSection() }),
      regenCtx(),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sections).toHaveLength(3);

    const after = JSON.parse(await fs.readFile(lessonPath, 'utf8'));

    // Targeted section replaced.
    const replaced = after.sections.find((s: { id: string }) => s.id === 'check-1');
    expect(replaced.data.multiSelect).toBe(true);
    expect(replaced.data.correct).toEqual([1, 3]);
    expect(replaced.title).toBe('Quick check (revised)');

    // Other sections must be byte-identical to their pre-apply form.
    for (const otherId of ['intro', 'closing']) {
      const beforeSection = before.sections.find(
        (s: { id: string }) => s.id === otherId,
      );
      const afterSection = after.sections.find(
        (s: { id: string }) => s.id === otherId,
      );
      expect(JSON.stringify(afterSection)).toBe(JSON.stringify(beforeSection));
    }

    // Top-level metadata also stable.
    expect(after.slug).toBe(before.slug);
    expect(after.title).toBe(before.title);
    expect(after.estimatedMinutes).toBe(before.estimatedMinutes);
  });

  it('returns 422 on a body that fails Zod validation', async () => {
    await seedLesson();
    const res = await postApply(
      applyReq('check-1', { newSection: { id: 'check-1', type: 'quiz' /* invalid */ } }),
      regenCtx(),
    );
    expect(res.status).toBe(422);
  });

  it('returns 422 when the body id does not match the URL sectionId', async () => {
    await seedLesson();
    const ns = buildNewSection();
    ns.id = 'different-id';
    const res = await postApply(applyReq('check-1', { newSection: ns }), regenCtx());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('id-mismatch');
  });

  it('returns 422 when the body type does not match the on-disk section kind', async () => {
    await seedLesson();
    const swapped = {
      id: 'check-1',
      title: 'Now I am theory',
      type: 'theory' as const,
      data: { markdown: 'This used to be a quiz.' },
    };
    const res = await postApply(applyReq('check-1', { newSection: swapped }), regenCtx());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('kind-mismatch');
  });

  it('returns 404 when the lesson is missing', async () => {
    const res = await postApply(
      applyReq('check-1', { newSection: buildNewSection() }),
      regenCtx(),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when the section is missing from the lesson', async () => {
    await seedLesson();
    const ghost = { ...buildNewSection(), id: 'no-such-section' };
    const res = await postApply(
      applyReq('no-such-section', { newSection: ghost }),
      regenCtx({ sectionId: 'no-such-section' }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 on an unsafe slug', async () => {
    const res = await postApply(
      applyReq('check-1', { newSection: buildNewSection() }),
      regenCtx({ slug: '../escape' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on an unparseable JSON body', async () => {
    await seedLesson();
    const res = await postApply(applyReq('check-1', '{not-json'), regenCtx());
    expect(res.status).toBe(400);
  });

  it('returns 409 busy when a generation is active for this slug', async () => {
    await seedLesson();
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
    const res = await postApply(
      applyReq('check-1', { newSection: buildNewSection() }),
      regenCtx(),
    );
    expect(res.status).toBe(409);
  });
});

// ── Course-aware spawn args: model pin + working-memory pointers ─────────────
// The regenerate agent must run on the same model that authored the course
// (Opus, or Sonnet for quiz-only — US-192) and be pointed at research.md /
// sources.md when they exist so rewrites stay grounded in the course's
// working memory.

describe('regenerate_section spawn args (model pin + working memory)', () => {
  function makeArgsCapturingSpawn() {
    let captured: { command: string; args: string[] } | null = null;
    const spawn = ((command: string, args: readonly string[] = []) => {
      captured = { command, args: [...args] };
      return new FakeChildProcess({
        stdoutText: validAgentResponse(),
      }) as unknown as ChildProcess;
    }) as unknown as RegenerateSectionSpawnDeps['spawn'];
    return { spawn, captured: () => captured };
  }

  function agentInput() {
    return {
      lessonContext: sampleLesson(),
      sectionId: 'check-1',
      instruction: 'Make it multi-select.',
    } as unknown as Parameters<typeof runRegenerateSectionAgent>[0];
  }

  it('pins --model opus and omits working-memory pointers for a plain course', async () => {
    await seedLesson();
    const { spawn, captured } = makeArgsCapturingSpawn();
    __setRegenerateSectionSpawnForTesting({ spawn });

    await runRegenerateSectionAgent(agentInput());

    const args = captured()!.args;
    const modelIdx = args.indexOf('--model');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(args[modelIdx + 1]).toBe('opus');
    expect(args[1]).not.toContain('Course working memory');
  });

  it('pins --model sonnet when course.json carries tags: ["quiz"]', async () => {
    await seedLesson();
    await fs.writeFile(
      path.join(coursesRoot, COURSE_SLUG, 'course.json'),
      JSON.stringify({ tags: ['quiz'] }),
      'utf8',
    );
    const { spawn, captured } = makeArgsCapturingSpawn();
    __setRegenerateSectionSpawnForTesting({ spawn });

    await runRegenerateSectionAgent(agentInput());

    const args = captured()!.args;
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
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
    __setRegenerateSectionSpawnForTesting({ spawn });

    await runRegenerateSectionAgent(agentInput());

    const prompt = captured()!.args[1];
    expect(prompt).toContain('Course working memory');
    expect(prompt).toContain(`/courses/${COURSE_SLUG}/research.md`);
    expect(prompt).toContain(`/courses/${COURSE_SLUG}/sources.md`);
    expect(prompt).toContain('do NOT modify them');
  });
});
