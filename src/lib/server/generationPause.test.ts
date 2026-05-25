// US-194 — Pause / Resume coverage.
//
// Tests are sibling to generation.test.ts and reuse the same FakeChildProcess
// + makeScriptedSpawn pattern (copied to keep this file self-contained — the
// helpers in the main test file aren't exported).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import {
  __clearCancelCooldownForTesting,
  __resetForTesting,
  __setCoherencePassDisabledByDefault,
  __setSpawnDepsForTesting,
  getActiveRun,
  resumeGeneration,
  startGeneration,
  type GenerationEvent,
  type SpawnDeps,
} from '@/lib/server/generation';
import {
  generationStateFile,
  readGenerationState,
} from '@/lib/server/generationState';
import { POST as postPause } from '@/app/api/courses/[slug]/pause/route';

let coursesRoot: string;

class FakeChildProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  exitCode: number | null = null;
  killed = false;
  killSignals: NodeJS.Signals[] = [];
  pid = 12345;
  command: string = '';
  args: readonly string[] = [];
  constructor() {
    super();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
  kill(signal?: NodeJS.Signals | number) {
    const sig = (typeof signal === 'string' ? signal : 'SIGTERM') as NodeJS.Signals;
    this.killSignals.push(sig);
    this.killed = true;
    if (sig === 'SIGKILL' || sig === 'SIGTERM') {
      // Simulate the OS tearing it down on SIGTERM (claude -p doesn't trap
      // it in our test env). Pause production code dispatches SIGTERM first
      // and only escalates to SIGKILL after sigkillGraceMs; for tests we
      // collapse both into immediate exit so the pipeline can observe the
      // kill without us hanging on a timer.
      this.finishWithExit(sig === 'SIGKILL' ? 137 : 143);
    }
    return true;
  }
  finishWithExit(code: number) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.stdout.push(null);
    this.stderr.push(null);
    this.emit('exit', code, null);
    setImmediate(() => {
      this.emit('close', code, null);
    });
  }
}

interface ScriptedSpawn {
  spawn: SpawnDeps['spawn'];
  children: FakeChildProcess[];
  nextChild: () => Promise<FakeChildProcess>;
}

function makeScriptedSpawn(): ScriptedSpawn {
  const children: FakeChildProcess[] = [];
  const waiters: Array<(c: FakeChildProcess) => void> = [];
  let consumed = 0;
  const spawn = ((command: string, args: readonly string[] = []) => {
    const child = new FakeChildProcess();
    child.command = command;
    child.args = [...args];
    children.push(child);
    const waiter = waiters.shift();
    if (waiter) waiter(child);
    return child as unknown as ChildProcess;
  }) as unknown as SpawnDeps['spawn'];
  return {
    spawn,
    children,
    nextChild() {
      return new Promise((resolve) => {
        if (consumed < children.length) {
          resolve(children[consumed++]);
          return;
        }
        waiters.push((c) => {
          consumed++;
          resolve(c);
        });
      });
    },
  };
}

async function waitForFinish(run: { finished: boolean }) {
  for (let i = 0; i < 200 && !run.finished; i++) {
    await new Promise((r) => setImmediate(r));
  }
  await new Promise((r) => setTimeout(r, 25));
}

async function writeStubCourse(slug: string, lessonSlugs: string[]) {
  const dir = path.join(coursesRoot, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'course.json'),
    JSON.stringify({
      schemaVersion: 1,
      slug,
      title: 'Stub',
      description: 'Stub course for tests',
      accentColor: 'indigo',
      icon: 'sigma',
      modules: [
        {
          id: 'm1',
          title: 'Module 1',
          summary: 'Stub module',
          lessons: lessonSlugs.map((s) => ({
            slug: s,
            title: s,
            estimatedMinutes: 5,
          })),
        },
      ],
      createdAt: '2026-05-04T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:00.000Z',
    }),
    'utf8',
  );
}

async function writeStubResearchArtefacts(slug: string) {
  const dir = path.join(coursesRoot, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'research.md'), '# Research: stub\n', 'utf8');
  await fs.writeFile(path.join(dir, 'sources.md'), '# Sources: stub\n', 'utf8');
}

async function runInitStages(
  scripted: ScriptedSpawn,
  slug: string,
  lessonSlugs: string[],
): Promise<void> {
  const research = await scripted.nextChild();
  await writeStubResearchArtefacts(slug);
  research.finishWithExit(0);
  const design = await scripted.nextChild();
  await writeStubCourse(slug, lessonSlugs);
  design.finishWithExit(0);
}

async function writeStubLesson(slug: string, lessonSlug: string) {
  const dir = path.join(coursesRoot, slug, 'lessons');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${lessonSlug}.json`),
    JSON.stringify({
      schemaVersion: 1,
      slug: lessonSlug,
      courseSlug: slug,
      moduleId: 'm1',
      title: lessonSlug,
      eyebrow: 'STUB',
      description: 'Stub lesson',
      estimatedMinutes: 5,
      sections: [
        {
          id: 's1',
          title: 'Read',
          type: 'theory',
          data: { markdown: 'Stub.' },
        },
      ],
    }),
    'utf8',
  );
}

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-gen-pause-test-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
  process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(
    coursesRoot,
    'generation-queue.json',
  );
  __resetForTesting();
  __setCoherencePassDisabledByDefault(true);
});

afterEach(async () => {
  __resetForTesting();
  __setSpawnDepsForTesting(null);
  __setCoherencePassDisabledByDefault(false);
  delete process.env.COURSES_ROOT_OVERRIDE;
  delete process.env.GENERATION_QUEUE_FILE_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
});

describe('Pause during the per-lesson stage (US-194)', () => {
  it('persists status=paused, deletes partial JSON, and resume restarts the in-flight lesson from attempt 0', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 2,
      lessonTimeoutMs: 60_000,
      sigkillGraceMs: 5,
    });

    await runInitStages(scripted, 'demo', ['one', 'two', 'three']);

    // Lesson 'one' finishes cleanly.
    const one = await scripted.nextChild();
    await writeStubLesson('demo', 'one');
    one.finishWithExit(0);

    // 'two' starts; wait until state.lessons['two'].status === 'inflight' so
    // the run.currentStage assignment has landed.
    const two = await scripted.nextChild();
    for (let i = 0; i < 100; i++) {
      const s = await readGenerationState('demo');
      if (s?.lessons.find((l) => l.slug === 'two')?.status === 'inflight') break;
      await new Promise((r) => setImmediate(r));
    }
    // Write a partial / invalid JSON for 'two' so we can prove pause unlinked it.
    const lessonsDir = path.join(coursesRoot, 'demo', 'lessons');
    await fs.mkdir(lessonsDir, { recursive: true });
    await fs.writeFile(
      path.join(lessonsDir, 'two.json'),
      '{ partial: true ', // intentionally malformed
      'utf8',
    );
    void two; // child stays alive; pause kills the tree

    await run.pause();
    await waitForFinish(run);

    // The terminal SSE event MUST be `paused` (not `error` / `done`).
    const terminal = run.events[run.events.length - 1];
    expect(terminal.type).toBe('paused');
    expect(terminal).toMatchObject({
      type: 'paused',
      slug: 'demo',
      inflightLessonSlug: 'two',
    });

    const state = await readGenerationState('demo');
    expect(state).not.toBeNull();
    expect(state!.status).toBe('paused');
    expect(state!.pausedInflightLesson).toBe('two');
    // In-flight lesson got reset to pending / attempts=0 so resume restarts
    // from zero per AC.
    expect(state!.lessons.find((l) => l.slug === 'two')).toMatchObject({
      status: 'pending',
      attempts: 0,
    });
    // Already-done lesson is preserved.
    expect(state!.lessons.find((l) => l.slug === 'one')).toMatchObject({
      status: 'done',
    });

    // Partial JSON for 'two' deleted at pause time.
    await expect(
      fs.access(path.join(lessonsDir, 'two.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    // Done lesson 'one' is untouched.
    await fs.access(path.join(lessonsDir, 'one.json'));

    // The active run pointer is cleared (we're paused, not active).
    expect(getActiveRun()).toBeNull();

    // ── Resume ────────────────────────────────────────────────────────────
    __clearCancelCooldownForTesting();
    const scripted2 = makeScriptedSpawn();
    const run2 = await resumeGeneration('demo', {
      spawn: scripted2.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 2,
      lessonTimeoutMs: 60_000,
    });

    // Lesson 'two' spawns first — init is skipped, 'one' is skipped as done.
    const two2 = await scripted2.nextChild();
    await writeStubLesson('demo', 'two');
    two2.finishWithExit(0);

    // Lesson 'three' spawns next.
    const three2 = await scripted2.nextChild();
    await writeStubLesson('demo', 'three');
    three2.finishWithExit(0);

    await waitForFinish(run2);

    // Exactly two children spawned in the resume run.
    expect(scripted2.children.length).toBe(2);

    // 'one' was never re-spawned (AC: completed lessons not regenerated).
    // Match on the canonical `lesson-slug = "<slug>"` prompt marker so the
    // generic word 'one' inside the default brief text doesn't trip the
    // assertion.
    expect(
      scripted2.children.some((c) =>
        c.args.join(' ').includes('lesson-slug = "one"'),
      ),
    ).toBe(false);
    // Resume DID spawn 'two' and 'three' (sanity-check the positive case).
    expect(
      scripted2.children.some((c) =>
        c.args.join(' ').includes('lesson-slug = "two"'),
      ),
    ).toBe(true);
    expect(
      scripted2.children.some((c) =>
        c.args.join(' ').includes('lesson-slug = "three"'),
      ),
    ).toBe(true);

    const done = run2.events.find((e) => e.type === 'done') as
      | { type: 'done'; failedLessons: unknown[] }
      | undefined;
    expect(done).toBeDefined();
    expect(done?.failedLessons).toEqual([]);

    // Clean success → state file deleted.
    await expect(fs.access(generationStateFile('demo'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('Pause during the init stage (US-194)', () => {
  it('paused during research_course → resume re-runs research_course then design_course', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      sigkillGraceMs: 5,
    });

    // research_course child appears. We do NOT write research.md / sources.md
    // — pause it mid-spawn.
    const research = await scripted.nextChild();
    // Wait briefly so run.currentStage is set to 'research_course' before pause.
    for (let i = 0; i < 50 && run.currentStage !== 'research_course'; i++) {
      await new Promise((r) => setImmediate(r));
    }
    void research;
    await run.pause();
    await waitForFinish(run);

    const terminal = run.events[run.events.length - 1];
    expect(terminal).toMatchObject({
      type: 'paused',
      slug: 'demo',
      inflightLessonSlug: null,
    });

    const state = await readGenerationState('demo');
    expect(state).not.toBeNull();
    expect(state!.status).toBe('paused');
    expect(state!.research.status).toBe('pending');
    expect(state!.design.status).toBe('pending');

    // ── Resume — init re-runs from research_course ──────────────────────
    __clearCancelCooldownForTesting();
    const scripted2 = makeScriptedSpawn();
    const run2 = await resumeGeneration('demo', {
      spawn: scripted2.spawn,
      isExecutableInPath: () => true,
    });

    // First child of resume run is research_course again (proves init re-ran).
    const research2 = await scripted2.nextChild();
    await writeStubResearchArtefacts('demo');
    research2.finishWithExit(0);

    const design2 = await scripted2.nextChild();
    await writeStubCourse('demo', ['only']);
    design2.finishWithExit(0);

    const lesson2 = await scripted2.nextChild();
    await writeStubLesson('demo', 'only');
    lesson2.finishWithExit(0);

    await waitForFinish(run2);

    // Init re-ran (2 children) + 1 lesson = 3 children total.
    expect(scripted2.children.length).toBe(3);

    // Stage event order proves init came first.
    const stageNames = run2.events
      .filter((e): e is Extract<GenerationEvent, { type: 'stage' }> =>
        e.type === 'stage',
      )
      .map((e) => `${e.name}:${e.status}`);
    expect(stageNames).toContain('research_course:started');
    expect(stageNames).toContain('design_course:started');
  });
});

describe('POST /api/courses/[slug]/pause (US-194)', () => {
  it('returns 202 when paused, 409 when no active run for this slug', async () => {
    // No active run yet → 409.
    const noRun = await postPause(
      new Request('http://x/api/courses/demo/pause', { method: 'POST' }),
      { params: Promise.resolve({ slug: 'demo' }) },
    );
    expect(noRun.status).toBe(409);
    const noRunBody = (await noRun.json()) as { error: string };
    expect(noRunBody.error).toBe('no-active-run');

    // Start a real run, pause via route, expect 202.
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      sigkillGraceMs: 5,
    });

    await runInitStages(scripted, 'demo', ['one']);
    await scripted.nextChild(); // 'one' is in flight
    for (let i = 0; i < 100; i++) {
      const s = await readGenerationState('demo');
      if (s?.lessons.find((l) => l.slug === 'one')?.status === 'inflight') break;
      await new Promise((r) => setImmediate(r));
    }

    const res = await postPause(
      new Request('http://x/api/courses/demo/pause', { method: 'POST' }),
      { params: Promise.resolve({ slug: 'demo' }) },
    );
    expect(res.status).toBe(202);

    await waitForFinish(run);
    const terminal = run.events[run.events.length - 1];
    expect(terminal.type).toBe('paused');
  });

  it('rejects an invalid slug with 400', async () => {
    const res = await postPause(
      new Request('http://x/api/courses/..%2Fevil/pause', { method: 'POST' }),
      { params: Promise.resolve({ slug: '../evil' }) },
    );
    expect(res.status).toBe(400);
  });
});
