import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { POST as postApply } from '@/app/api/courses/[slug]/extend/apply/route';
import {
  __resetForTesting as __resetGenerationForTesting,
  __setActiveRunForTesting,
  __setSpawnDepsForTesting,
  type SpawnDeps,
} from '@/lib/server/generation';
import { __setExtendSummariesSpawnForTesting } from '@/lib/server/extendSummaries';
import { readGenerationState } from '@/lib/server/generationState';

let coursesRoot: string;

class FakeChildProcess extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  exitCode: number | null = null;
  pid = 4321;
  constructor() {
    super();
    // Stdin is a sink that drops bytes — sufficient for spawners that just
    // need `child.stdin.end(payload)` to resolve so the helper can keep
    // going. Tests that need to assert what was piped to stdin should
    // capture chunks in their own write hook.
    this.stdin = new Writable({
      write: (_chunk, _enc, cb) => cb(),
      final: (cb) => cb(),
    });
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
  finishWithExit(code: number) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.stdout.push(null);
    this.stderr.push(null);
    this.emit('exit', code, null);
    setImmediate(() => this.emit('close', code, null));
  }
  kill() {
    return true;
  }
}

const sampleCourse = (slug: string) => ({
  schemaVersion: 1,
  slug,
  title: 'Edge Detection Basics',
  description: 'Boundaries in images.',
  accentColor: 'indigo' as const,
  icon: 'scan-line',
  modules: [
    {
      id: 'm1',
      title: 'Gradients',
      summary: 'Image derivatives.',
      lessons: [
        { slug: 'gradients-intro', title: 'Gradients intro', estimatedMinutes: 10 },
        { slug: 'sobel-operator', title: 'Sobel operator', estimatedMinutes: 12 },
      ],
    },
    {
      id: 'm2',
      title: 'Edges',
      summary: 'From gradients to edges.',
      lessons: [
        { slug: 'thresholding', title: 'Thresholding', estimatedMinutes: 8 },
      ],
    },
  ],
  createdAt: '2026-04-15T10:05:00.000Z',
  updatedAt: '2026-04-15T10:05:00.000Z',
});

async function seedCourse(slug: string) {
  const dir = path.join(coursesRoot, slug);
  await fs.mkdir(path.join(dir, 'lessons'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'course.json'),
    JSON.stringify(sampleCourse(slug)),
    'utf8',
  );
  for (const m of sampleCourse(slug).modules) {
    for (const l of m.lessons) {
      await fs.writeFile(
        path.join(dir, 'lessons', `${l.slug}.json`),
        JSON.stringify({
          schemaVersion: 1,
          slug: l.slug,
          courseSlug: slug,
          moduleId: m.id,
          title: l.title,
          eyebrow: 'INTRO',
          description: 'Stub.',
          estimatedMinutes: l.estimatedMinutes,
          sections: [
            { id: 's1', title: 'Read', type: 'theory' as const, data: { markdown: '# hi' } },
          ],
        }),
        'utf8',
      );
    }
  }
}

/**
 * No-op spawn for the extendSummaries AI step. Exits 0 immediately with
 * empty stdout — `generateExtensionSummaries` falls back to an empty Map,
 * which makes the apply route preserve the user-typed summaries verbatim.
 * Tests that want to exercise the AI-rewrite happy path install a different
 * spawn that pushes a real JSON payload to stdout.
 */
function makeNoopSummariesSpawn(): SpawnDeps['spawn'] {
  return ((command: string) => {
    void command;
    const child = new FakeChildProcess();
    setImmediate(() => child.finishWithExit(0));
    return child as unknown as ChildProcess;
  }) as unknown as SpawnDeps['spawn'];
}

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-apply-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
  process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(coursesRoot, 'generation-queue.json');
  __resetGenerationForTesting();
  __setExtendSummariesSpawnForTesting({ spawn: makeNoopSummariesSpawn() });
});

afterEach(async () => {
  // Drain any background pipeline before tearing down env + tmpdir so its
  // late writes don't leak into either the next test's tmpdir or the
  // worktree's real /courses/ dir (`coursesRoot()` falls back to
  // process.cwd()/courses when COURSES_ROOT_OVERRIDE is unset).
  await waitForRunToFinish();
  __setSpawnDepsForTesting(null);
  __setExtendSummariesSpawnForTesting(null);
  __resetGenerationForTesting();
  delete process.env.COURSES_ROOT_OVERRIDE;
  delete process.env.GENERATION_QUEUE_FILE_OVERRIDE;
  // The pipeline's fire-and-forget marker writes (`void writeGeneratingMarker`
  // / `void removeGeneratingMarker` in generation.ts) can land a tick after
  // `finished` flips, re-creating a file inside a directory rm is mid-walk
  // through — which surfaces as ENOTEMPTY. Retry briefly instead of flaking.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rm(coursesRoot, { recursive: true, force: true });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOTEMPTY' || attempt >= 4) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

function buildProposedSchema(slug: string, opts: { addModule?: boolean; addLesson?: boolean } = {}) {
  const base = sampleCourse(slug);
  const modules = base.modules.map((m) => ({ ...m, lessons: [...m.lessons] }));
  if (opts.addLesson) {
    modules[0].lessons.push({
      slug: 'gradient-direction',
      title: 'Gradient direction',
      estimatedMinutes: 9,
    });
  }
  if (opts.addModule) {
    modules.push({
      id: 'm3',
      title: 'Canny',
      summary: 'Putting it together.',
      lessons: [
        { slug: 'canny-pipeline', title: 'The Canny pipeline', estimatedMinutes: 15 },
      ],
    });
  }
  return { ...base, modules };
}

function makeWritingSpawn(courseSlug: string): {
  spawn: SpawnDeps['spawn'];
  spawnCalls: Array<{ command: string; args: readonly string[] }>;
  children: FakeChildProcess[];
} {
  const spawnCalls: Array<{ command: string; args: readonly string[] }> = [];
  const children: FakeChildProcess[] = [];
  const spawn = ((command: string, args: readonly string[] = []) => {
    spawnCalls.push({ command, args: [...args] });
    const child = new FakeChildProcess();
    children.push(child);
    // Best-effort guess at the lesson slug from the natural-language brief
    // (the prompt body contains `lesson-slug = "<slug>"`). When found, write
    // a valid stub lesson JSON so the post-spawn LessonSchema validation
    // succeeds and runLesson returns success on the first attempt — the
    // pipeline terminates quickly, no stray async work bleeds into the next
    // test.
    const promptArg = args.find((a) => typeof a === 'string' && a.includes('lesson-slug'));
    const match = promptArg ? /lesson-slug = "([^"]+)"/.exec(promptArg) : null;
    const writeLesson = async () => {
      if (!match) return;
      const lessonSlug = match[1];
      const dir = path.join(coursesRoot, courseSlug, 'lessons');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${lessonSlug}.json`),
        JSON.stringify({
          schemaVersion: 1,
          slug: lessonSlug,
          courseSlug,
          moduleId: 'm1',
          title: lessonSlug,
          eyebrow: 'STUB',
          description: 'Stub lesson written by makeWritingSpawn.',
          estimatedMinutes: 5,
          sections: [
            {
              id: 's1',
              title: 'Read',
              type: 'theory',
              data: { markdown: '# stub' },
            },
          ],
        }),
        'utf8',
      );
    };
    void writeLesson()
      .catch(() => {
        /* tmpdir may have been wiped already — that's fine, runner sees exit=0 either way */
      })
      .then(() => {
        child.finishWithExit(0);
      });
    return child as unknown as ChildProcess;
  }) as unknown as SpawnDeps['spawn'];
  return { spawn, spawnCalls, children };
}

async function waitForRunToFinish() {
  const { getActiveRun } = await import('@/lib/server/generation');
  for (let i = 0; i < 200; i++) {
    const run = getActiveRun();
    if (!run || run.finished) return;
    await new Promise((r) => setImmediate(r));
  }
}

describe('POST /api/courses/[slug]/extend/apply (US-144)', () => {
  it('persists proposedSchema and returns enqueued new lesson slugs', async () => {
    const slug = 'edge-detection-basics';
    await seedCourse(slug);
    const { spawn } = makeWritingSpawn(slug);
    __setSpawnDepsForTesting({ spawn, isExecutableInPath: () => true });

    const proposedSchema = buildProposedSchema(slug, { addModule: true, addLesson: true });
    const res = await postApply(
      new Request(`http://x/api/courses/${slug}/extend/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposedSchema }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { enqueuedLessonSlugs: string[] };
    expect(new Set(json.enqueuedLessonSlugs)).toEqual(
      new Set(['gradient-direction', 'canny-pipeline']),
    );

    // course.json on disk now contains the new module + lesson.
    const raw = await fs.readFile(path.join(coursesRoot, slug, 'course.json'), 'utf8');
    const persisted = JSON.parse(raw);
    expect(persisted.modules).toHaveLength(3);
    expect(persisted.modules[0].lessons.map((l: { slug: string }) => l.slug)).toContain(
      'gradient-direction',
    );

    // updatedAt was bumped to a fresh timestamp.
    expect(persisted.updatedAt).not.toBe('2026-04-15T10:05:00.000Z');

    // Generation state was seeded with both init stages done + only the new lessons.
    const state = await readGenerationState(slug);
    expect(state).not.toBeNull();
    expect(state!.research.status).toBe('done');
    expect(state!.design.status).toBe('done');
    expect(state!.lessons.map((l) => l.slug).sort()).toEqual(
      ['canny-pipeline', 'gradient-direction'].sort(),
    );

    // Let the spawned pipeline drain so the next test starts clean.
    await waitForRunToFinish();
  });

  it('returns 422 when a pre-existing module ID is missing', async () => {
    const slug = 'edge-detection-basics';
    await seedCourse(slug);
    const proposedSchema = buildProposedSchema(slug);
    proposedSchema.modules = proposedSchema.modules.filter((m) => m.id !== 'm2');

    const res = await postApply(
      new Request(`http://x/api/courses/${slug}/extend/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposedSchema }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('preexisting-id-missing');
    expect(json.droppedModuleIds).toEqual(['m2']);
  });

  it('returns 422 when a pre-existing lesson slug is missing', async () => {
    const slug = 'edge-detection-basics';
    await seedCourse(slug);
    const proposedSchema = buildProposedSchema(slug);
    proposedSchema.modules[0].lessons = proposedSchema.modules[0].lessons.filter(
      (l) => l.slug !== 'sobel-operator',
    );

    const res = await postApply(
      new Request(`http://x/api/courses/${slug}/extend/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposedSchema }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('preexisting-id-missing');
    expect(json.droppedLessonSlugs).toEqual(['sobel-operator']);
  });

  it('returns 404 when the course does not exist', async () => {
    const slug = 'nope';
    const proposedSchema = buildProposedSchema(slug);
    const res = await postApply(
      new Request(`http://x/api/courses/${slug}/extend/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposedSchema }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when a generation is active for this slug', async () => {
    const slug = 'edge-detection-basics';
    await seedCourse(slug);
    __setActiveRunForTesting(slug);

    const proposedSchema = buildProposedSchema(slug, { addLesson: true });
    const res = await postApply(
      new Request(`http://x/api/courses/${slug}/extend/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposedSchema }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('busy');
  });

  it('returns 422 when proposedSchema.slug differs from URL slug', async () => {
    const slug = 'edge-detection-basics';
    await seedCourse(slug);
    const proposedSchema = buildProposedSchema(slug);
    proposedSchema.slug = 'different-slug';
    const res = await postApply(
      new Request(`http://x/api/courses/${slug}/extend/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposedSchema }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('slug-mismatch');
  });

  it('returns 200 with empty enqueued list when no lessons are new', async () => {
    const slug = 'edge-detection-basics';
    await seedCourse(slug);
    // Identical schema (no additions).
    const proposedSchema = buildProposedSchema(slug);
    const res = await postApply(
      new Request(`http://x/api/courses/${slug}/extend/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposedSchema }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enqueuedLessonSlugs).toEqual([]);
  });

  it('returns 400 on invalid JSON body', async () => {
    const slug = 'edge-detection-basics';
    await seedCourse(slug);
    const res = await postApply(
      new Request(`http://x/api/courses/${slug}/extend/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(400);
  });

  it('rewrites new module/lesson summaries with AI-generated text from the "Share more details" hint', async () => {
    const slug = 'edge-detection-basics';
    await seedCourse(slug);
    const { spawn: writingSpawn } = makeWritingSpawn(slug);
    __setSpawnDepsForTesting({ spawn: writingSpawn, isExecutableInPath: () => true });

    // Install a spawn that emits a polished summary for each addition. The
    // wizard sent the user's raw hints through module.summary /
    // lessonRef.summary on new entries; this fake stands in for the
    // `claude -p` summary-rewriter and replaces them with one-line prose.
    const summariesSpawn = ((command: string) => {
      void command;
      const child = new FakeChildProcess();
      const payload = JSON.stringify({
        summaries: [
          {
            key: 'gradient-direction',
            summary: 'Compute orientation from gradient components, with worked numerical examples.',
          },
          {
            key: 'm3',
            summary: 'The full Canny pipeline end-to-end: blur, gradient, NMS, hysteresis.',
          },
          {
            key: 'canny-pipeline',
            summary: 'Walks through every stage of Canny on a single photograph.',
          },
        ],
      });
      setImmediate(() => {
        child.stdout.push(payload);
        child.finishWithExit(0);
      });
      return child as unknown as ChildProcess;
    }) as unknown as SpawnDeps['spawn'];
    __setExtendSummariesSpawnForTesting({ spawn: summariesSpawn });

    const proposedSchema = buildProposedSchema(slug, { addModule: true, addLesson: true });
    // The wizard would put the user's raw "details" hint into these summary
    // fields. The apply route should rewrite them. The build helper omits
    // `summary` on lessons by default — cast through `unknown` to splice it
    // in, mirroring what the real wizard payload looks like.
    const newLessonM1 = proposedSchema.modules[0].lessons[
      proposedSchema.modules[0].lessons.length - 1
    ] as unknown as { slug: string; title: string; estimatedMinutes: number; summary?: string };
    newLessonM1.summary = 'topics: orientation, atan2, edge angle examples';
    proposedSchema.modules[proposedSchema.modules.length - 1].summary =
      'walk through blur, gradient, NMS, hysteresis';
    const newLessonM3 = proposedSchema.modules[proposedSchema.modules.length - 1]
      .lessons[0] as unknown as {
      slug: string;
      title: string;
      estimatedMinutes: number;
      summary?: string;
    };
    newLessonM3.summary = 'apply Canny to a real photograph end-to-end';

    const res = await postApply(
      new Request(`http://x/api/courses/${slug}/extend/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposedSchema }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(200);

    const raw = await fs.readFile(path.join(coursesRoot, slug, 'course.json'), 'utf8');
    const persisted = JSON.parse(raw) as {
      modules: Array<{
        id: string;
        summary: string;
        lessons: Array<{ slug: string; summary?: string }>;
      }>;
    };
    // Pre-existing summaries are preserved byte-for-byte.
    expect(persisted.modules.find((m) => m.id === 'm1')!.summary).toBe(
      'Image derivatives.',
    );
    expect(persisted.modules.find((m) => m.id === 'm2')!.summary).toBe(
      'From gradients to edges.',
    );
    // New module summary was rewritten by the AI step.
    expect(persisted.modules.find((m) => m.id === 'm3')!.summary).toBe(
      'The full Canny pipeline end-to-end: blur, gradient, NMS, hysteresis.',
    );
    // New lesson summaries were rewritten too.
    const newLesson = persisted.modules
      .find((m) => m.id === 'm1')!
      .lessons.find((l) => l.slug === 'gradient-direction')!;
    expect(newLesson.summary).toBe(
      'Compute orientation from gradient components, with worked numerical examples.',
    );
    const newModuleLesson = persisted.modules
      .find((m) => m.id === 'm3')!
      .lessons.find((l) => l.slug === 'canny-pipeline')!;
    expect(newModuleLesson.summary).toBe(
      'Walks through every stage of Canny on a single photograph.',
    );

    await waitForRunToFinish();
  });

  it('falls back to the user-typed text when the AI rewrite step fails', async () => {
    const slug = 'edge-detection-basics';
    await seedCourse(slug);
    const { spawn: writingSpawn } = makeWritingSpawn(slug);
    __setSpawnDepsForTesting({ spawn: writingSpawn, isExecutableInPath: () => true });

    // Spawn that exits non-zero so generateExtensionSummaries returns an
    // empty Map. /apply must not block — it should write course.json with
    // the user-typed summaries unchanged.
    const failingSpawn = ((command: string) => {
      void command;
      const child = new FakeChildProcess();
      setImmediate(() => child.finishWithExit(1));
      return child as unknown as ChildProcess;
    }) as unknown as SpawnDeps['spawn'];
    __setExtendSummariesSpawnForTesting({ spawn: failingSpawn });

    const proposedSchema = buildProposedSchema(slug, { addModule: true });
    proposedSchema.modules[proposedSchema.modules.length - 1].summary =
      'raw user hint that should survive the fallback';

    const res = await postApply(
      new Request(`http://x/api/courses/${slug}/extend/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposedSchema }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(200);

    const raw = await fs.readFile(path.join(coursesRoot, slug, 'course.json'), 'utf8');
    const persisted = JSON.parse(raw) as {
      modules: Array<{ id: string; summary: string }>;
    };
    expect(persisted.modules.find((m) => m.id === 'm3')!.summary).toBe(
      'raw user hint that should survive the fallback',
    );

    await waitForRunToFinish();
  });
});
