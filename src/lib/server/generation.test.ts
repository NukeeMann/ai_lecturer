import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import {
  __resetForTesting,
  __setSpawnDepsForTesting,
  ClaudeUnavailableError,
  defaultInitCourseCommand,
  defaultLessonCommand,
  GenerationConflictError,
  getActiveRun,
  getRunById,
  sseEncode,
  startGeneration,
  type FailedLesson,
  type GenerationEvent,
  type SpawnDeps,
} from '@/lib/server/generation';

import { POST as postGenerate, DELETE as deleteGenerate } from '@/app/api/courses/generate/route';
import { GET as streamGenerate } from '@/app/api/courses/generate/stream/[id]/route';

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
  emitStdout(text: string) {
    this.stdout.push(Buffer.from(text, 'utf8'));
  }
  emitStderr(text: string) {
    this.stderr.push(Buffer.from(text, 'utf8'));
  }
  kill(signal?: NodeJS.Signals | number) {
    const sig = (typeof signal === 'string' ? signal : 'SIGTERM') as NodeJS.Signals;
    this.killSignals.push(sig);
    this.killed = true;
    if (sig === 'SIGKILL') {
      // Simulate the OS finally tearing it down.
      this.finishWithExit(137);
    }
    return true;
  }
  finishWithExit(code: number) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    // signal end-of-stream so any 'data' events for buffered chunks flush
    this.stdout.push(null);
    this.stderr.push(null);
    this.emit('exit', code, null);
    // Defer 'close' so pending 'data' events (delivered on a later tick) flush
    // before any teardown listener (the wrapper waits on 'close', not 'exit').
    setImmediate(() => {
      this.emit('close', code, null);
    });
  }
}

interface ScriptedSpawn {
  spawn: SpawnDeps['spawn'];
  children: FakeChildProcess[];
  /** Resolves once the next spawn happens. */
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
  // One more tick so the WriteStream's underlying fs write has a chance to land.
  await new Promise((r) => setTimeout(r, 25));
}

/**
 * Helper: write a stub course.json with N lessons in one module so the
 * post-init guard sees real output and the per-lesson loop has work to do.
 */
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

/** Helper: write a valid stub lesson file at the canonical path. */
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
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-gen-test-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
  __resetForTesting();
});

afterEach(async () => {
  __resetForTesting();
  __setSpawnDepsForTesting(null);
  delete process.env.COURSES_ROOT_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('sseEncode', () => {
  it('emits event lines with type and JSON data', () => {
    const out = sseEncode({ type: 'log', line: 'hello' });
    const text = new TextDecoder().decode(out);
    expect(text).toBe('event: log\ndata: {"type":"log","line":"hello"}\n\n');
  });
  it('encodes done with courseSlug and failedLessons', () => {
    const text = new TextDecoder().decode(
      sseEncode({ type: 'done', courseSlug: 'foo', failedLessons: [] }),
    );
    expect(text).toContain('event: done\n');
    expect(text).toContain('"courseSlug":"foo"');
    expect(text).toContain('"failedLessons":[]');
  });
  it('encodes progress with current/total', () => {
    const text = new TextDecoder().decode(
      sseEncode({ type: 'progress', current: 2, total: 5 }),
    );
    expect(text).toContain('event: progress\n');
    expect(text).toContain('"current":2');
    expect(text).toContain('"total":5');
  });
  it('encodes stage with name and status', () => {
    const text = new TextDecoder().decode(
      sseEncode({ type: 'stage', name: 'init_course', status: 'started' }),
    );
    expect(text).toContain('event: stage\n');
    expect(text).toContain('"name":"init_course"');
    expect(text).toContain('"status":"started"');
  });
  it('encodes error with message', () => {
    const text = new TextDecoder().decode(sseEncode({ type: 'error', message: 'boom' }));
    expect(text).toContain('event: error\n');
    expect(text).toContain('"message":"boom"');
  });
});

describe('startGeneration spawn wrapper', () => {
  it('throws ClaudeUnavailableError when claude is not on PATH', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await expect(
      startGeneration('demo', {
        isExecutableInPath: () => false,
      }),
    ).rejects.toBeInstanceOf(ClaudeUnavailableError);
  });

  it('runs init then iterates lessons sequentially and emits stage/log/progress/done', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();

    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    // Child #1 is the init claude — emulate it by writing a 2-lesson
    // course.json before exit so the post-init guard / per-lesson loop see
    // real output.
    const init = await scripted.nextChild();
    init.emitStdout('init says hi\n');
    await writeStubCourse('demo', ['intro', 'outro']);
    init.finishWithExit(0);

    // Child #2 is the per-lesson claude for `intro` — write the file before exit.
    const intro = await scripted.nextChild();
    intro.emitStdout('working on intro\n');
    await writeStubLesson('demo', 'intro');
    intro.finishWithExit(0);

    // Child #3 is the per-lesson claude for `outro`.
    const outro = await scripted.nextChild();
    outro.emitStdout('working on outro\n');
    await writeStubLesson('demo', 'outro');
    outro.finishWithExit(0);

    await waitForFinish(run);
    const events: GenerationEvent[] = run.events;

    const stageEvents = events.filter((e) => e.type === 'stage');
    expect(stageEvents).toEqual([
      { type: 'stage', name: 'init_course', status: 'started' },
      { type: 'stage', name: 'init_course', status: 'done' },
      { type: 'stage', name: 'lesson:intro', status: 'started' },
      { type: 'stage', name: 'lesson:intro', status: 'done' },
      { type: 'stage', name: 'lesson:outro', status: 'started' },
      { type: 'stage', name: 'lesson:outro', status: 'done' },
    ]);

    const logLines = events.filter((e) => e.type === 'log').map((e) => (e as { line: string }).line);
    expect(logLines).toContain('init says hi');
    expect(logLines).toContain('working on intro');
    expect(logLines).toContain('working on outro');

    const progress = events.filter((e) => e.type === 'progress');
    expect(progress).toEqual([
      { type: 'progress', current: 0, total: 2 },
      { type: 'progress', current: 1, total: 2 },
      { type: 'progress', current: 2, total: 2 },
    ]);

    const done = events.find((e) => e.type === 'done');
    expect(done).toEqual({ type: 'done', courseSlug: 'demo', failedLessons: [] });

    expect(run.finished).toBe(true);
    expect(getActiveRun()).toBeNull();
  });

  it('per-lesson claude is invoked via the lessonCommand factory with both slugs', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const lessonCommand = vi.fn((slug: string, lessonSlug: string) => ({
      command: 'fake-claude',
      args: ['-p', `slug=${slug} lesson=${lessonSlug}`, '--dangerously-skip-permissions'],
    }));

    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonCommand,
    });

    const init = await scripted.nextChild();
    await writeStubCourse('demo', ['alpha', 'beta']);
    init.finishWithExit(0);

    const alpha = await scripted.nextChild();
    expect(alpha.command).toBe('fake-claude');
    expect(alpha.args.join(' ')).toContain('slug=demo');
    expect(alpha.args.join(' ')).toContain('lesson=alpha');
    expect(alpha.args).toContain('--dangerously-skip-permissions');
    await writeStubLesson('demo', 'alpha');
    alpha.finishWithExit(0);

    const beta = await scripted.nextChild();
    expect(beta.args.join(' ')).toContain('lesson=beta');
    await writeStubLesson('demo', 'beta');
    beta.finishWithExit(0);

    await waitForFinish(run);
    expect(lessonCommand).toHaveBeenCalledTimes(2);
    // Third arg (previousAttemptReason) is undefined on the first attempt.
    expect(lessonCommand).toHaveBeenNthCalledWith(1, 'demo', 'alpha', undefined);
    expect(lessonCommand).toHaveBeenNthCalledWith(2, 'demo', 'beta', undefined);
  });

  it('isolates a single lesson failure: pipeline continues, done lists failedLessons', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      // Retries are exercised by their own dedicated tests below; here we
      // pin maxRetries=0 so the failed lesson terminates on its first attempt.
      lessonMaxRetries: 0,
    });

    // Init succeeds with 2 lessons.
    const init = await scripted.nextChild();
    await writeStubCourse('demo', ['good', 'bad']);
    init.finishWithExit(0);

    // Lesson 1 (`good`) succeeds.
    const good = await scripted.nextChild();
    await writeStubLesson('demo', 'good');
    good.finishWithExit(0);

    // Lesson 2 (`bad`) fails: non-zero exit, no file written.
    const bad = await scripted.nextChild();
    bad.emitStderr('something exploded\n');
    bad.finishWithExit(2);

    await waitForFinish(run);

    // Pipeline still finished as `done`, NOT `error` — only one of two lessons failed.
    const done = run.events.find((e) => e.type === 'done') as
      | { type: 'done'; courseSlug: string; failedLessons: FailedLesson[] }
      | undefined;
    expect(done).toBeDefined();
    expect(done?.courseSlug).toBe('demo');
    expect(done?.failedLessons.length).toBe(1);
    expect(done?.failedLessons[0].slug).toBe('bad');
    expect(done?.failedLessons[0].reason).toMatch(/exited with code 2/);
    expect(done?.failedLessons[0].reason).toContain('something exploded');
    expect(run.events.find((e) => e.type === 'error')).toBeUndefined();

    // Both lessons emitted started; only `good` emitted a `done` stage; `bad` emitted error.
    const stageEvents = run.events.filter((e) => e.type === 'stage');
    expect(stageEvents).toEqual([
      { type: 'stage', name: 'init_course', status: 'started' },
      { type: 'stage', name: 'init_course', status: 'done' },
      { type: 'stage', name: 'lesson:good', status: 'started' },
      { type: 'stage', name: 'lesson:good', status: 'done' },
      { type: 'stage', name: 'lesson:bad', status: 'started' },
      { type: 'stage', name: 'lesson:bad', status: 'error' },
    ]);

    // Progress advances even after the failed lesson.
    const progress = run.events.filter((e) => e.type === 'progress');
    expect(progress).toEqual([
      { type: 'progress', current: 0, total: 2 },
      { type: 'progress', current: 1, total: 2 },
      { type: 'progress', current: 2, total: 2 },
    ]);
  });

  it('flags a lesson that exits 0 but writes invalid JSON as failed via post-spawn LessonSchema check', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      // Single-attempt path so the malformed JSON is the only output and
      // we don't need to script multiple retry children.
      lessonMaxRetries: 0,
    });

    const init = await scripted.nextChild();
    await writeStubCourse('demo', ['malformed']);
    init.finishWithExit(0);

    // Lesson exits 0 but writes JSON missing required fields.
    const lesson = await scripted.nextChild();
    await fs.mkdir(path.join(coursesRoot, 'demo', 'lessons'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'demo', 'lessons', 'malformed.json'),
      JSON.stringify({ slug: 'malformed' }), // missing courseSlug, sections, etc.
      'utf8',
    );
    lesson.finishWithExit(0);

    await waitForFinish(run);

    // All-failed → finalize as error with failedLessons attached.
    const error = run.events.find((e) => e.type === 'error') as
      | { type: 'error'; message: string; failedLessons?: FailedLesson[] }
      | undefined;
    expect(error).toBeDefined();
    expect(error?.failedLessons?.length).toBe(1);
    expect(error?.failedLessons?.[0].slug).toBe('malformed');
    expect(run.events.find((e) => e.type === 'done')).toBeUndefined();
  });

  it('cancel mid-run aborts the in-flight lesson and stops the pipeline', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      sigkillGraceMs: 5000,
    });

    const init = await scripted.nextChild();
    await writeStubCourse('demo', ['first', 'second']);
    init.finishWithExit(0);

    // First lesson succeeds.
    const first = await scripted.nextChild();
    await writeStubLesson('demo', 'first');
    first.finishWithExit(0);

    // Second lesson is in-flight when the user cancels.
    const second = await scripted.nextChild();
    second.emitStdout('working...\n');

    await run.cancel();
    expect(second.killSignals).toContain('SIGTERM');
    // Simulate the child responding to SIGTERM.
    second.finishWithExit(143);

    await waitForFinish(run);

    // Pipeline finalized as error (cancelled) — NO third spawn happened.
    expect(scripted.children.length).toBe(3);
    const error = run.events.find((e) => e.type === 'error') as
      | { type: 'error'; message: string; failedLessons?: FailedLesson[] }
      | undefined;
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/cancel/i);
    expect(error?.failedLessons?.[0]?.slug).toBe('second');
    expect(run.events.find((e) => e.type === 'done')).toBeUndefined();
  });

  it('captures stdout AND stderr to /courses/<slug>/.generation.log across init + lesson stages', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const init = await scripted.nextChild();
    init.emitStdout('init-stdout-line\n');
    init.emitStderr('init-stderr-line\n');
    await writeStubCourse('demo', ['only']);
    init.finishWithExit(0);

    const lesson = await scripted.nextChild();
    lesson.emitStdout('lesson-stdout-line\n');
    lesson.emitStderr('lesson-stderr-line\n');
    await writeStubLesson('demo', 'only');
    lesson.finishWithExit(0);

    await waitForFinish(run);
    const lines = run.events
      .filter((e) => e.type === 'log')
      .map((e) => (e as { line: string }).line);
    expect(lines).toEqual(
      expect.arrayContaining([
        'init-stdout-line',
        'init-stderr-line',
        'lesson-stdout-line',
        'lesson-stderr-line',
      ]),
    );
    const log = await fs.readFile(path.join(coursesRoot, 'demo', '.generation.log'), 'utf8');
    expect(log).toContain('init-stdout-line');
    expect(log).toContain('init-stderr-line');
    expect(log).toContain('lesson-stdout-line');
    expect(log).toContain('lesson-stderr-line');
  });

  it('rejects a second concurrent run with GenerationConflictError', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    void run;
    await scripted.nextChild(); // claude is now running but not exited

    await expect(
      startGeneration('demo', {
        spawn: scripted.spawn,
        isExecutableInPath: () => true,
      }),
    ).rejects.toBeInstanceOf(GenerationConflictError);
  });

  it('finalizes as error when init exits 0 but course.json is missing (Unknown command bug)', async () => {
    // Reproduces US-095: `claude -p '/init_course <slug>'` printed
    // "Unknown command: /init_course" and exited 0 without ever invoking the
    // skill. With no course.json on disk, the per-lesson loop has no input
    // and the pipeline must surface an error rather than silently emit done.
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const claude = await scripted.nextChild();
    claude.emitStdout('Unknown command: /init_course\n');
    claude.finishWithExit(0); // intentionally do NOT write course.json

    await waitForFinish(run);

    const stages = run.events.filter((e) => e.type === 'stage');
    expect(stages).toEqual([
      { type: 'stage', name: 'init_course', status: 'started' },
      { type: 'stage', name: 'init_course', status: 'error' },
    ]);

    const error = run.events.find((e) => e.type === 'error') as
      | { type: 'error'; message: string }
      | undefined;
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/init_course did not produce course\.json/i);
    expect(error?.message).toMatch(/\.generation\.log/i);

    expect(run.events.find((e) => e.type === 'done')).toBeUndefined();

    // Pipeline must NOT have proceeded to a per-lesson spawn.
    expect(scripted.children.length).toBe(1);

    // course.json was never written (sanity).
    await expect(
      fs.access(path.join(coursesRoot, 'demo', 'course.json')),
    ).rejects.toBeDefined();
    expect(run.finished).toBe(true);
    expect(getActiveRun()).toBeNull();
  });

  it('default init prompt names the SKILL.md path and avoids the slash-command form', () => {
    const spec = defaultInitCourseCommand('demo');
    expect(spec.command).toBe('claude');
    expect(spec.args[0]).toBe('-p');
    const prompt = spec.args[1];
    expect(prompt).toContain('init_course');
    expect(prompt).toContain('scripts/ralph/skills/init_course/SKILL.md');
    expect(prompt).toContain('demo');
    // The pre-fix bug was using `/init_course <slug>` as the prompt body —
    // claude in -p mode treats that as literal text and prints "Unknown
    // command:" before exiting 0. Guard against a regression.
    expect(prompt).not.toMatch(/^\s*\/init_course\b/);
    expect(spec.args).toContain('--dangerously-skip-permissions');
  });

  it('default init prompt rejects unsafe slugs (assertSafeSlug)', () => {
    expect(() => defaultInitCourseCommand('../etc')).toThrow(/Invalid slug/i);
    expect(() => defaultInitCourseCommand('a/b')).toThrow(/Invalid slug/i);
  });

  it('default lesson prompt names the generate_lesson SKILL.md and includes both slugs', () => {
    const spec = defaultLessonCommand('opencv-basics', 'canny-edge');
    expect(spec.command).toBe('claude');
    expect(spec.args[0]).toBe('-p');
    const prompt = spec.args[1];
    expect(prompt).toContain('generate_lesson');
    expect(prompt).toContain('scripts/ralph/skills/generate_lesson/SKILL.md');
    expect(prompt).toContain('opencv-basics');
    expect(prompt).toContain('canny-edge');
    expect(prompt).toMatch(/\/courses\/opencv-basics\/lessons\/canny-edge\.json/);
    // Same regression guard as the init prompt.
    expect(prompt).not.toMatch(/^\s*\/generate_lesson\b/);
    expect(spec.args).toContain('--dangerously-skip-permissions');
  });

  it('default lesson prompt rejects unsafe slugs', () => {
    expect(() => defaultLessonCommand('../etc', 'foo')).toThrow(/Invalid slug/i);
    expect(() => defaultLessonCommand('demo', 'a/b')).toThrow(/Invalid slug/i);
  });

  it('default lesson prompt prepends PREVIOUS ATTEMPT FAILED block when given a retry reason', () => {
    const spec = defaultLessonCommand('demo', 'lesson-a', 'exited with code 1\nrate limited');
    expect(spec.command).toBe('claude');
    const prompt = spec.args[1];
    expect(prompt).toMatch(/^PREVIOUS ATTEMPT FAILED:/);
    expect(prompt).toContain('rate limited');
    expect(prompt).toContain('Fix these issues specifically');
    // Base brief still present after the failure block.
    expect(prompt).toContain('generate_lesson');
    expect(prompt).toContain('scripts/ralph/skills/generate_lesson/SKILL.md');
  });

  it('retries a failed lesson and marks it done when the retry succeeds', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 2,
      lessonTimeoutMs: 60_000,
    });

    const init = await scripted.nextChild();
    await writeStubCourse('demo', ['retryme']);
    init.finishWithExit(0);

    // Attempt 1: non-zero exit + stderr, no file written.
    const a1 = await scripted.nextChild();
    a1.emitStderr('rate limited\n');
    a1.finishWithExit(1);

    // Attempt 2: writes a valid lesson and exits 0.
    const a2 = await scripted.nextChild();
    await writeStubLesson('demo', 'retryme');
    a2.finishWithExit(0);

    await waitForFinish(run);

    // Lesson is done, NOT in failedLessons.
    const done = run.events.find((e) => e.type === 'done') as
      | { type: 'done'; courseSlug: string; failedLessons: FailedLesson[] }
      | undefined;
    expect(done).toBeDefined();
    expect(done?.failedLessons).toEqual([]);

    // ONE started + ONE done stage event for the lesson (not per attempt).
    const lessonStages = run.events.filter(
      (e) => e.type === 'stage' && e.name === 'lesson:retryme',
    );
    expect(lessonStages).toEqual([
      { type: 'stage', name: 'lesson:retryme', status: 'started' },
      { type: 'stage', name: 'lesson:retryme', status: 'done' },
    ]);

    // Per-lesson log records BOTH attempts' headers.
    const logRaw = await fs.readFile(
      path.join(coursesRoot, 'demo', '.gen-logs', 'retryme.log'),
      'utf8',
    );
    const headers = logRaw.match(/=== Attempt \d+ —/g) ?? [];
    expect(headers).toEqual(['=== Attempt 1 —', '=== Attempt 2 —']);
    expect(logRaw).toContain('rate limited');

    // Retry attempt's prompt carries the PREVIOUS ATTEMPT FAILED context.
    const retryPrompt = a2.args.join(' ');
    expect(retryPrompt).toContain('PREVIOUS ATTEMPT FAILED');
    expect(retryPrompt).toMatch(/exited with code 1/);

    // No failed_report.json written (no exhausted-retry lessons).
    const reportExists = await fs
      .access(path.join(coursesRoot, 'demo', '.gen-logs', 'failed_report.json'))
      .then(() => true)
      .catch(() => false);
    expect(reportExists).toBe(false);
  });

  it('records exhausted-retry lessons in failed_report.json and still emits done with failedLessons', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 2,
      lessonTimeoutMs: 60_000,
    });

    const init = await scripted.nextChild();
    await writeStubCourse('demo', ['doomed', 'lucky']);
    init.finishWithExit(0);

    // 'doomed' fails on every one of its 3 attempts (non-zero exit).
    for (let i = 0; i < 3; i++) {
      const attempt = await scripted.nextChild();
      attempt.emitStderr(`boom ${i + 1}\n`);
      attempt.finishWithExit(1);
    }

    // 'lucky' succeeds on its first attempt.
    const lucky = await scripted.nextChild();
    await writeStubLesson('demo', 'lucky');
    lucky.finishWithExit(0);

    await waitForFinish(run);

    // Pipeline still emits `done` because 'lucky' generated successfully.
    const done = run.events.find((e) => e.type === 'done') as
      | { type: 'done'; courseSlug: string; failedLessons: FailedLesson[] }
      | undefined;
    expect(done).toBeDefined();
    expect(done?.failedLessons.map((f) => f.slug)).toEqual(['doomed']);
    expect(done?.failedLessons[0].reason).toMatch(/exited with code 1/);

    // Per-lesson log records all 3 attempt headers.
    const logRaw = await fs.readFile(
      path.join(coursesRoot, 'demo', '.gen-logs', 'doomed.log'),
      'utf8',
    );
    const headers = logRaw.match(/=== Attempt \d+ —/g) ?? [];
    expect(headers).toEqual(['=== Attempt 1 —', '=== Attempt 2 —', '=== Attempt 3 —']);

    // failed_report.json exists with exactly one entry pointing at the per-lesson log.
    const reportRaw = await fs.readFile(
      path.join(coursesRoot, 'demo', '.gen-logs', 'failed_report.json'),
      'utf8',
    );
    const report = JSON.parse(reportRaw) as Array<{
      lessonSlug: string;
      attempts: number;
      lastError: string;
      logPath: string;
    }>;
    expect(report).toHaveLength(1);
    expect(report[0].lessonSlug).toBe('doomed');
    expect(report[0].attempts).toBe(3);
    expect(report[0].lastError).toMatch(/exited with code 1/);
    expect(report[0].logPath).toBe('.gen-logs/doomed.log');

    // Init log was teed to .gen-logs/init_course.log.
    const initLog = await fs.readFile(
      path.join(coursesRoot, 'demo', '.gen-logs', 'init_course.log'),
      'utf8',
    );
    expect(typeof initLog).toBe('string');
  });

  it('per-attempt timeout SIGTERMs then SIGKILLs and the next attempt sees a timeout retry context', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 2,
      // Tight timing so the test runs in well under a second of real time.
      lessonTimeoutMs: 30,
      sigkillGraceMs: 30,
    });

    const init = await scripted.nextChild();
    await writeStubCourse('demo', ['hangs']);
    init.finishWithExit(0);

    // Attempt 1: child never exits on its own — let the per-attempt timeout
    // fire. FakeChildProcess.kill('SIGKILL') auto-finishes the child, so the
    // close event drains naturally and the loop moves on.
    const attempt1 = await scripted.nextChild();
    attempt1.emitStdout('working...\n');

    // Wait for the second spawn — it can only happen after attempt 1 closes,
    // which only happens after SIGTERM → grace → SIGKILL.
    const attempt2 = await scripted.nextChild();
    expect(attempt1.killSignals).toContain('SIGTERM');
    expect(attempt1.killSignals).toContain('SIGKILL');

    // Retry prompt carries the timeout context from the prior attempt.
    const retryPrompt = attempt2.args.join(' ');
    expect(retryPrompt).toContain('PREVIOUS ATTEMPT FAILED');
    expect(retryPrompt).toMatch(/timeout after \d+s/);

    // Let attempt 2 succeed so the run finalises cleanly.
    await writeStubLesson('demo', 'hangs');
    attempt2.finishWithExit(0);

    await waitForFinish(run);
    const done = run.events.find((e) => e.type === 'done') as
      | { type: 'done'; courseSlug: string; failedLessons: FailedLesson[] }
      | undefined;
    expect(done).toBeDefined();
    expect(done?.failedLessons).toEqual([]);
  });

  it('SIGTERMs the active child on cancel and SIGKILLs after the grace window', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    vi.useFakeTimers();
    try {
      const scripted = makeScriptedSpawn();
      const run = await startGeneration('demo', {
        spawn: scripted.spawn,
        isExecutableInPath: () => true,
        sigkillGraceMs: 5000,
      });
      const claude = await scripted.nextChild();
      claude.emitStdout('still alive\n');

      await run.cancel();
      expect(claude.killSignals).toContain('SIGTERM');
      expect(claude.killSignals).not.toContain('SIGKILL');

      // Grace window passes — the timer fires and we SIGKILL.
      vi.advanceTimersByTime(5001);
      expect(claude.killSignals).toContain('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /api/courses/generate (route)', () => {
  it('returns 400 for an unsafe slug', async () => {
    const req = new Request('http://localhost/api/courses/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: '../etc' }),
    });
    const res = await postGenerate(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 if course-spec.json is missing', async () => {
    const req = new Request('http://localhost/api/courses/generate', {
      method: 'POST',
      body: JSON.stringify({ slug: 'no-spec' }),
    });
    const res = await postGenerate(req);
    expect(res.status).toBe(404);
  });

  it('returns 503 when claude is not on PATH', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'demo', 'course-spec.json'),
      JSON.stringify({ stub: true }),
      'utf8',
    );
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => false,
    });
    const req = new Request('http://localhost/api/courses/generate', {
      method: 'POST',
      body: JSON.stringify({ slug: 'demo' }),
    });
    const res = await postGenerate(req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Install Claude Code CLI|sign in/i);
  });

  it('returns 202 + id on success and 409 on a second concurrent attempt', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'demo', 'course-spec.json'),
      JSON.stringify({ stub: true }),
      'utf8',
    );
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const ok = await postGenerate(
      new Request('http://localhost/api/courses/generate', {
        method: 'POST',
        body: JSON.stringify({ slug: 'demo' }),
      }),
    );
    expect(ok.status).toBe(202);
    const okBody = (await ok.json()) as { id: string; slug: string };
    expect(okBody.id).toMatch(/^gen-/);
    expect(okBody.slug).toBe('demo');

    // Hold the first child open so the slot stays busy.
    await scripted.nextChild();

    const conflict = await postGenerate(
      new Request('http://localhost/api/courses/generate', {
        method: 'POST',
        body: JSON.stringify({ slug: 'demo' }),
      }),
    );
    expect(conflict.status).toBe(409);
  });

  it('DELETE cancels the active run', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'demo', 'course-spec.json'),
      JSON.stringify({ stub: true }),
      'utf8',
    );
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const ok = await postGenerate(
      new Request('http://localhost/api/courses/generate', {
        method: 'POST',
        body: JSON.stringify({ slug: 'demo' }),
      }),
    );
    const { id } = (await ok.json()) as { id: string };
    const child = await scripted.nextChild();

    const del = await deleteGenerate(
      new Request(`http://localhost/api/courses/generate?id=${id}`, { method: 'DELETE' }),
    );
    expect(del.status).toBe(200);
    expect(child.killSignals).toContain('SIGTERM');
  });

  it('GET stream replays buffered events and emits SSE frames', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'demo', 'course-spec.json'),
      JSON.stringify({ stub: true }),
      'utf8',
    );
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const ok = await postGenerate(
      new Request('http://localhost/api/courses/generate', {
        method: 'POST',
        body: JSON.stringify({ slug: 'demo' }),
      }),
    );
    const { id } = (await ok.json()) as { id: string };

    const init = await scripted.nextChild();
    init.emitStdout('hello-world\n');
    await writeStubCourse('demo', ['intro']);
    init.finishWithExit(0);
    const lesson = await scripted.nextChild();
    lesson.emitStdout('lesson-line\n');
    await writeStubLesson('demo', 'intro');
    lesson.finishWithExit(0);

    const run = getRunById(id);
    if (!run) throw new Error('run not found');
    await waitForFinish(run);

    expect(getRunById(id)?.finished).toBe(true);
    const res = await streamGenerate(new Request(`http://localhost/stream/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    const text = await res.text();
    expect(text).toContain('event: stage');
    expect(text).toContain('event: log');
    expect(text).toContain('event: progress');
    expect(text).toContain('event: done');
    expect(text).toContain('"courseSlug":"demo"');
    expect(text).toContain('"failedLessons":[]');
  });

  it('GET stream returns 404 for unknown id', async () => {
    const res = await streamGenerate(new Request('http://localhost/stream/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });
});
