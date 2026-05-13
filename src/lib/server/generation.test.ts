import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import {
  __clearCancelCooldownForTesting,
  __getQueueForTesting,
  __resetForTesting,
  __setCoherencePassDisabledByDefault,
  __setEventsLogRotateBytesForTesting,
  __setSpawnDepsForTesting,
  ClaudeUnavailableError,
  defaultCoherencePassCommand,
  defaultDesignCourseCommand,
  defaultLessonCommand,
  defaultResearchCourseCommand,
  enqueueGeneration,
  eventsLogPath,
  formatStreamJsonLine,
  GenerationConflictError,
  GenerationStateMissingError,
  getActiveRun,
  getActiveRunSummary,
  getRunById,
  isLessonAlreadyValid,
  readEventsLogSync,
  resumeGeneration,
  sseEncode,
  startGeneration,
  type FailedLesson,
  type GenerationEvent,
  type SpawnDeps,
} from '@/lib/server/generation';

import { POST as postGenerate, DELETE as deleteGenerate } from '@/app/api/courses/generate/route';
import { GET as streamGenerate } from '@/app/api/courses/generate/stream/[id]/route';
import { POST as postResume } from '@/app/api/courses/[slug]/resume/route';
import {
  generationStateFile,
  readGenerationState,
  type GenerationState,
} from '@/lib/server/generationState';

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

/**
 * Write minimal research.md + sources.md so the post-research guard in
 * the orchestrator accepts the research_course child's "exit". Mirrors
 * writeStubCourse for the second init stage.
 */
async function writeStubResearchArtefacts(slug: string) {
  const dir = path.join(coursesRoot, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'research.md'), '# Research: stub\n', 'utf8');
  await fs.writeFile(path.join(dir, 'sources.md'), '# Sources: stub\n', 'utf8');
}

/**
 * Drive both init stages of a scripted pipeline in one call:
 *  1. consume the research_course child, write research.md + sources.md,
 *     exit 0
 *  2. consume the design_course child, write course.json with the given
 *     lesson slugs, exit 0
 * Most pipeline tests just want to fast-forward through init to start
 * scripting per-lesson children — this helper is what they call.
 */
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

/**
 * Variant of runInitStages used by US-139 idempotency tests: the test
 * pre-places course.json + research.md + sources.md before startGeneration,
 * so both init children just need to consume and exit 0 — the pre-existing
 * files satisfy the post-stage guards on read-back.
 */
async function passInitStagesNoWrite(scripted: ScriptedSpawn): Promise<void> {
  const research = await scripted.nextChild();
  research.finishWithExit(0);
  const design = await scripted.nextChild();
  design.finishWithExit(0);
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
  // US-107: pin the persisted FIFO queue to a per-test tmpfile so concurrent
  // suites and the user's real ~/.ai-lecturer/generation-queue.json don't
  // bleed into each other.
  process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(coursesRoot, 'generation-queue.json');
  __resetForTesting();
  // US-141: existing pipeline tests pre-date the final coherence-pass stage
  // and assert exact spawn counts / stage event sequences that don't account
  // for it. Default the stage to disabled for the whole suite — the new
  // US-141 tests opt back in via `disableCoherencePass: false` (or by
  // toggling this flag locally).
  __setCoherencePassDisabledByDefault(true);
});

afterEach(async () => {
  __resetForTesting();
  __setSpawnDepsForTesting(null);
  __setCoherencePassDisabledByDefault(false);
  delete process.env.COURSES_ROOT_OVERRIDE;
  delete process.env.GENERATION_QUEUE_FILE_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('formatStreamJsonLine (US-102)', () => {
  it('passes non-JSON lines through unchanged', () => {
    expect(formatStreamJsonLine('hello world')).toEqual(['hello world']);
    expect(formatStreamJsonLine('[mock research_course] working...')).toEqual([
      '[mock research_course] working...',
    ]);
    expect(formatStreamJsonLine('Unknown command: /research_course')).toEqual([
      'Unknown command: /research_course',
    ]);
    expect(formatStreamJsonLine('')).toEqual(['']);
  });

  it('passes malformed JSON-looking lines through unchanged', () => {
    expect(formatStreamJsonLine('{not json')).toEqual(['{not json']);
    expect(formatStreamJsonLine('{}')).toEqual(['{}']);
    // valid JSON but no `type` field — fall back to raw line
    expect(formatStreamJsonLine('{"foo":"bar"}')).toEqual(['{"foo":"bar"}']);
  });

  it('formats a system init event as a compact tag', () => {
    const ev = JSON.stringify({
      type: 'system',
      subtype: 'init',
      model: 'claude-opus-4-7',
      tools: ['Read', 'Write'],
    });
    expect(formatStreamJsonLine(ev)).toEqual(['[system init claude-opus-4-7]']);
  });

  it('extracts assistant text deltas as one line per non-empty paragraph', () => {
    const ev = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Researching topic.\n\nWriting course.json now.' }],
      },
    });
    expect(formatStreamJsonLine(ev)).toEqual([
      'Researching topic.',
      'Writing course.json now.',
    ]);
  });

  it('renders tool_use blocks with the most informative argument', () => {
    const read = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Read',
            input: { file_path: '/tmp/courses/demo/research.md' },
          },
        ],
      },
    });
    expect(formatStreamJsonLine(read)).toEqual([
      '→ Read(file_path: /tmp/courses/demo/research.md)',
    ]);

    const bash = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'npm run build' } },
        ],
      },
    });
    expect(formatStreamJsonLine(bash)).toEqual(['→ Bash(command: npm run build)']);
  });

  it('truncates long string args in tool invocations', () => {
    const longPath = '/very/'.padEnd(200, 'x');
    const ev = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: longPath } }],
      },
    });
    const out = formatStreamJsonLine(ev);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('→ Read(file_path: ');
    expect(out[0]).toMatch(/…\)$/);
    expect(out[0].length).toBeLessThan(longPath.length);
  });

  it('combines text and tool_use blocks from a single assistant event', () => {
    const ev = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading the spec.' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/spec.md' } },
        ],
      },
    });
    expect(formatStreamJsonLine(ev)).toEqual([
      'Reading the spec.',
      '→ Read(file_path: /tmp/spec.md)',
    ]);
  });

  it('summarises tool_result user events with first line of output', () => {
    const ev = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            content: [{ type: 'text', text: 'line one\nline two\nline three' }],
          },
        ],
      },
    });
    expect(formatStreamJsonLine(ev)).toEqual(['← line one']);
  });

  it('formats result events with subtype and duration', () => {
    const ok = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 12345,
    });
    expect(formatStreamJsonLine(ok)).toEqual(['[result success (12.3s)]']);

    const err = JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
    });
    expect(formatStreamJsonLine(err)).toEqual(['[result error]']);
  });

  it('skips assistant events that contain only suppressed blocks (e.g. thinking)', () => {
    const ev = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'pondering...' }],
      },
    });
    expect(formatStreamJsonLine(ev)).toEqual([]);
  });
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
      sseEncode({ type: 'stage', name: 'research_course', status: 'started' }),
    );
    expect(text).toContain('event: stage\n');
    expect(text).toContain('"name":"research_course"');
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

  it('runs both init stages then iterates lessons sequentially and emits stage/log/progress/done', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();

    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    // Child #1 is research_course — write research.md + sources.md and exit
    // so the post-research guard accepts the artefacts.
    const research = await scripted.nextChild();
    research.emitStdout('researching\n');
    await writeStubResearchArtefacts('demo');
    research.finishWithExit(0);

    // Child #2 is design_course — write the 2-lesson course.json so the
    // post-design guard / per-lesson loop see real output.
    const design = await scripted.nextChild();
    design.emitStdout('designing\n');
    await writeStubCourse('demo', ['intro', 'outro']);
    design.finishWithExit(0);

    // Child #3 is the per-lesson claude for `intro` — write the file before exit.
    const intro = await scripted.nextChild();
    intro.emitStdout('working on intro\n');
    await writeStubLesson('demo', 'intro');
    intro.finishWithExit(0);

    // Child #4 is the per-lesson claude for `outro`.
    const outro = await scripted.nextChild();
    outro.emitStdout('working on outro\n');
    await writeStubLesson('demo', 'outro');
    outro.finishWithExit(0);

    await waitForFinish(run);
    const events: GenerationEvent[] = run.events;

    const stageEvents = events.filter((e) => e.type === 'stage');
    expect(stageEvents).toEqual([
      { type: 'stage', name: 'research_course', status: 'started' },
      { type: 'stage', name: 'research_course', status: 'done' },
      { type: 'stage', name: 'design_course', status: 'started' },
      { type: 'stage', name: 'design_course', status: 'done' },
      { type: 'stage', name: 'lesson:intro', status: 'started' },
      { type: 'stage', name: 'lesson:intro', status: 'done' },
      { type: 'stage', name: 'lesson:outro', status: 'started' },
      { type: 'stage', name: 'lesson:outro', status: 'done' },
    ]);

    const logLines = events.filter((e) => e.type === 'log').map((e) => (e as { line: string }).line);
    expect(logLines).toContain('researching');
    expect(logLines).toContain('designing');
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

    await runInitStages(scripted, 'demo', ['alpha', 'beta']);

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
    await runInitStages(scripted, 'demo', ['good', 'bad']);

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
      { type: 'stage', name: 'research_course', status: 'started' },
      { type: 'stage', name: 'research_course', status: 'done' },
      { type: 'stage', name: 'design_course', status: 'started' },
      { type: 'stage', name: 'design_course', status: 'done' },
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

    await runInitStages(scripted, 'demo', ['malformed']);

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

    await runInitStages(scripted, 'demo', ['first', 'second']);

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

    // Pipeline finalized as error (cancelled). Spawn count = 2 init stages
    // + 2 lesson attempts (first done, second cancelled mid-flight).
    expect(scripted.children.length).toBe(4);
    const error = run.events.find((e) => e.type === 'error') as
      | { type: 'error'; message: string; failedLessons?: FailedLesson[] }
      | undefined;
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/cancel/i);
    expect(error?.failedLessons?.[0]?.slug).toBe('second');
    expect(run.events.find((e) => e.type === 'done')).toBeUndefined();
  });

  it('emits stream-json events as incremental human-readable log lines while the child is still running (US-102)', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const research = await scripted.nextChild();

    // Mid-flight stream-json events arrive line-by-line on stdout BEFORE the
    // child exits — without US-102's incremental decoding the SSE log panel
    // wouldn't surface them until close. Each emit + microtask tick lets
    // pumpStream flush the line into a `log` event before the next event
    // pushes through. We script the research child here because it is the
    // first init spawn; the same streaming code path serves design + lesson
    // children too.
    const tick = () => new Promise((r) => setImmediate(r));

    research.emitStdout(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'claude-opus-4-7',
      }) + '\n',
    );
    await tick();
    let logLinesSoFar = run.events
      .filter((e) => e.type === 'log')
      .map((e) => (e as { line: string }).line);
    expect(logLinesSoFar).toContain('[system init claude-opus-4-7]');

    research.emitStdout(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Researching topic.' }],
        },
      }) + '\n',
    );
    await tick();
    logLinesSoFar = run.events
      .filter((e) => e.type === 'log')
      .map((e) => (e as { line: string }).line);
    expect(logLinesSoFar).toContain('Researching topic.');
    // Critically: BEFORE the child exits, the assistant text must already be
    // in the log buffer — the whole point of stream-json is that we don't
    // wait for end-of-stage to see anything.
    expect(research.exitCode).toBeNull();

    research.emitStdout(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: { file_path: '/courses/demo/research.md' },
            },
          ],
        },
      }) + '\n',
    );
    await tick();

    await writeStubResearchArtefacts('demo');
    research.emitStdout(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 4500,
      }) + '\n',
    );
    research.finishWithExit(0);

    // Design stage just needs to land course.json so the per-lesson loop
    // can pick up the single 'intro' lesson.
    const design = await scripted.nextChild();
    await writeStubCourse('demo', ['intro']);
    design.finishWithExit(0);

    const lesson = await scripted.nextChild();
    await writeStubLesson('demo', 'intro');
    lesson.finishWithExit(0);

    await waitForFinish(run);

    const lines = run.events
      .filter((e) => e.type === 'log')
      .map((e) => (e as { line: string }).line);
    // Raw stream-json JSON should NOT have leaked into the SSE log panel —
    // every line must already be a decoded human-readable form.
    expect(lines.some((l) => l.startsWith('{"type":'))).toBe(false);
    expect(lines).toEqual(
      expect.arrayContaining([
        '[system init claude-opus-4-7]',
        'Researching topic.',
        '→ Write(file_path: /courses/demo/research.md)',
        '[result success (4.5s)]',
      ]),
    );

    // The .generation.log file should also contain the human-readable lines,
    // not the raw stream-json blob.
    const logRaw = await fs.readFile(
      path.join(coursesRoot, 'demo', '.generation.log'),
      'utf8',
    );
    expect(logRaw).toContain('[system init claude-opus-4-7]');
    expect(logRaw).toContain('Researching topic.');
    expect(logRaw).toContain('→ Write(file_path: /courses/demo/research.md)');
    expect(logRaw).not.toContain('"type":"assistant"');
  });

  it('captures stdout AND stderr to /courses/<slug>/.generation.log across all stages', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const research = await scripted.nextChild();
    research.emitStdout('research-stdout-line\n');
    research.emitStderr('research-stderr-line\n');
    await writeStubResearchArtefacts('demo');
    research.finishWithExit(0);

    const design = await scripted.nextChild();
    design.emitStdout('design-stdout-line\n');
    design.emitStderr('design-stderr-line\n');
    await writeStubCourse('demo', ['only']);
    design.finishWithExit(0);

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
        'research-stdout-line',
        'research-stderr-line',
        'design-stdout-line',
        'design-stderr-line',
        'lesson-stdout-line',
        'lesson-stderr-line',
      ]),
    );
    const log = await fs.readFile(path.join(coursesRoot, 'demo', '.generation.log'), 'utf8');
    expect(log).toContain('research-stdout-line');
    expect(log).toContain('research-stderr-line');
    expect(log).toContain('design-stdout-line');
    expect(log).toContain('design-stderr-line');
    expect(log).toContain('lesson-stdout-line');
    expect(log).toContain('lesson-stderr-line');
  });

  it('idempotently returns the active run when the same slug is requested again (US-105)', async () => {
    // The wizard's Stage 6 effect can fire POST /generate twice under React
    // StrictMode dev double-mount; we'd rather hand back the existing run
    // than 409 the user. Idempotency is keyed strictly on the slug.
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    await scripted.nextChild(); // claude is now running but not exited

    const sameRun = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    expect(sameRun).toBe(run);
  });

  it('rejects a concurrent run for a DIFFERENT slug while one is in flight', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.mkdir(path.join(coursesRoot, 'other'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    void run;
    await scripted.nextChild(); // claude is now running but not exited

    await expect(
      startGeneration('other', {
        spawn: scripted.spawn,
        isExecutableInPath: () => true,
      }),
    ).rejects.toBeInstanceOf(GenerationConflictError);
  });

  it('rejects two concurrent startGeneration calls for the same slug atomically (US-101)', async () => {
    // Repro for US-101: before the fix, the activeRun guard check happened
    // synchronously but the activeRun assignment came AFTER several
    // `await fs.mkdir(...)` calls. Two POSTs fired in the same tick (e.g.
    // React StrictMode double-mounting the Stage 5 effect) both passed the
    // guard, both started a pipeline, and both spawned claude — overwriting
    // each other's lesson files in /courses/<slug>/lessons/.
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();

    const results = await Promise.allSettled([
      startGeneration('demo', {
        spawn: scripted.spawn,
        isExecutableInPath: () => true,
      }),
      startGeneration('demo', {
        spawn: scripted.spawn,
        isExecutableInPath: () => true,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(GenerationConflictError);

    // Only ONE pipeline started — confirm exactly one claude was spawned.
    await scripted.nextChild();
    expect(scripted.children.length).toBe(1);
  });

  it('finalizes as error when research exits 0 but research.md is missing (Unknown command bug)', async () => {
    // Reproduces US-095 for the first init stage: `claude -p` in print mode
    // silently no-ops on prompts it doesn't understand (printing "Unknown
    // command:" and exiting 0). With no research.md on disk the design
    // stage has nothing to read; the pipeline must surface an error rather
    // than silently emit done. Same risk profile, same defensive guard.
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const claude = await scripted.nextChild();
    claude.emitStdout('Unknown command: /research_course\n');
    claude.finishWithExit(0); // intentionally do NOT write research.md

    await waitForFinish(run);

    const stages = run.events.filter((e) => e.type === 'stage');
    expect(stages).toEqual([
      { type: 'stage', name: 'research_course', status: 'started' },
      { type: 'stage', name: 'research_course', status: 'error' },
    ]);

    const error = run.events.find((e) => e.type === 'error') as
      | { type: 'error'; message: string }
      | undefined;
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/research_course did not produce research\.md/i);
    expect(error?.message).toMatch(/\.generation\.log/i);

    expect(run.events.find((e) => e.type === 'done')).toBeUndefined();

    // Pipeline must NOT have proceeded to the design spawn (let alone any
    // per-lesson spawn).
    expect(scripted.children.length).toBe(1);

    // research.md, sources.md, and course.json were never written (sanity).
    await expect(
      fs.access(path.join(coursesRoot, 'demo', 'research.md')),
    ).rejects.toBeDefined();
    await expect(
      fs.access(path.join(coursesRoot, 'demo', 'course.json')),
    ).rejects.toBeDefined();
    expect(run.finished).toBe(true);
    expect(getActiveRun()).toBeNull();
  });

  it('finalizes as error when design exits 0 but course.json is missing', async () => {
    // Same defensive guard as the research stage, but for design_course:
    // research produced its artefacts, so the pipeline advances; design
    // then silently no-ops and the per-lesson loop has no course.json to
    // walk. The orchestrator must surface this as an error too.
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const research = await scripted.nextChild();
    await writeStubResearchArtefacts('demo');
    research.finishWithExit(0);

    const design = await scripted.nextChild();
    design.emitStdout('Unknown command: /design_course\n');
    design.finishWithExit(0); // intentionally do NOT write course.json

    await waitForFinish(run);

    const stages = run.events.filter((e) => e.type === 'stage');
    expect(stages).toEqual([
      { type: 'stage', name: 'research_course', status: 'started' },
      { type: 'stage', name: 'research_course', status: 'done' },
      { type: 'stage', name: 'design_course', status: 'started' },
      { type: 'stage', name: 'design_course', status: 'error' },
    ]);

    const error = run.events.find((e) => e.type === 'error') as
      | { type: 'error'; message: string }
      | undefined;
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/design_course did not produce course\.json/i);

    // No per-lesson child spawned.
    expect(scripted.children.length).toBe(2);

    await expect(
      fs.access(path.join(coursesRoot, 'demo', 'course.json')),
    ).rejects.toBeDefined();
  });

  it('default research prompt names the SKILL.md path and avoids the slash-command form', () => {
    const spec = defaultResearchCourseCommand('demo');
    expect(spec.command).toBe('claude');
    expect(spec.args[0]).toBe('-p');
    const prompt = spec.args[1];
    expect(prompt).toContain('research_course');
    expect(prompt).toContain('scripts/ralph/skills/research_course/SKILL.md');
    expect(prompt).toContain('demo');
    // The pre-fix bug was using `/init_course <slug>` as the prompt body —
    // claude in -p mode treats that as literal text and prints "Unknown
    // command:" before exiting 0. Guard against a regression on the new
    // skill name too.
    expect(prompt).not.toMatch(/^\s*\/research_course\b/);
    expect(spec.args).toContain('--dangerously-skip-permissions');
    // US-102: incremental streaming requires --output-format stream-json
    // (and --verbose to satisfy claude -p's flag combo) so the SSE log
    // panel sees output line-by-line instead of one end-of-stage blob.
    expect(spec.args).toContain('--output-format');
    expect(spec.args).toContain('stream-json');
    expect(spec.args).toContain('--verbose');
    // Research is the first init stage — must explicitly tell the agent
    // NOT to write course.json (that belongs to design_course).
    expect(prompt).toContain('course.json');
    expect(prompt).toMatch(/Do NOT write.*course\.json/i);
  });

  it('default research prompt rejects unsafe slugs (assertSafeSlug)', () => {
    expect(() => defaultResearchCourseCommand('../etc')).toThrow(/Invalid slug/i);
    expect(() => defaultResearchCourseCommand('a/b')).toThrow(/Invalid slug/i);
  });

  it('default design prompt names the SKILL.md path, references the prior stage outputs, and asks for course.json', () => {
    const spec = defaultDesignCourseCommand('demo');
    expect(spec.command).toBe('claude');
    expect(spec.args[0]).toBe('-p');
    const prompt = spec.args[1];
    expect(prompt).toContain('design_course');
    expect(prompt).toContain('scripts/ralph/skills/design_course/SKILL.md');
    expect(prompt).toContain('demo');
    // Design MUST be told to Read research_course's outputs before it writes
    // course.json — the whole point of the split is that design consumes
    // research's artefacts, not re-does them.
    expect(prompt).toContain('research.md');
    expect(prompt).toContain('sources.md');
    expect(prompt).toContain('course.json');
    expect(prompt).toContain('CourseSchema');
    // Same regression guard.
    expect(prompt).not.toMatch(/^\s*\/design_course\b/);
    expect(spec.args).toContain('--dangerously-skip-permissions');
    expect(spec.args).toContain('--output-format');
    expect(spec.args).toContain('stream-json');
    expect(spec.args).toContain('--verbose');
  });

  it('default design prompt rejects unsafe slugs', () => {
    expect(() => defaultDesignCourseCommand('../etc')).toThrow(/Invalid slug/i);
    expect(() => defaultDesignCourseCommand('a/b')).toThrow(/Invalid slug/i);
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
    // US-102: per-lesson generation must also stream incrementally.
    expect(spec.args).toContain('--output-format');
    expect(spec.args).toContain('stream-json');
    expect(spec.args).toContain('--verbose');
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

  // ── US-104: source-materials injection ─────────────────────────────────
  // Both init stages (research_course + design_course) and the per-lesson
  // command share the same `buildInitSourcesSection` helper, so the
  // uploaded-files block must appear in all three when sources are present
  // and stay absent when the sources/ dir is empty or missing.
  it('research + design prompts are unchanged when /courses/<slug>/sources/ is absent (US-104)', () => {
    // Default test setup has the slug dir created but NO sources subdir.
    expect(defaultResearchCourseCommand('demo').args[1]).not.toMatch(/Source materials/i);
    expect(defaultDesignCourseCommand('demo').args[1]).not.toMatch(/Source materials/i);
  });

  it('research + design prompts are unchanged when /courses/<slug>/sources/ is empty (US-104)', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo', 'sources'), { recursive: true });
    expect(defaultResearchCourseCommand('demo').args[1]).not.toMatch(/Source materials/i);
    expect(defaultDesignCourseCommand('demo').args[1]).not.toMatch(/Source materials/i);
  });

  it('research prompt injects absolute paths for every uploaded source file (US-104)', async () => {
    const sourcesDir = path.join(coursesRoot, 'demo', 'sources');
    await fs.mkdir(sourcesDir, { recursive: true });
    await fs.writeFile(path.join(sourcesDir, 'lecture-01.pdf'), 'x');
    await fs.writeFile(path.join(sourcesDir, 'notes.txt'), 'x');

    const prompt = defaultResearchCourseCommand('demo').args[1];
    expect(prompt).toContain('Source materials');
    // Instructions must direct claude to use the Read tool BEFORE drafting.
    expect(prompt).toContain('Read tool');
    expect(prompt).toMatch(/BEFORE/i);
    // Both files must appear with absolute paths.
    const lec = path.join(sourcesDir, 'lecture-01.pdf');
    const notes = path.join(sourcesDir, 'notes.txt');
    expect(prompt).toContain(lec);
    expect(prompt).toContain(notes);
    expect(path.isAbsolute(lec)).toBe(true);
    expect(path.isAbsolute(notes)).toBe(true);
  });

  it('design prompt also injects the absolute uploaded-source paths (US-104)', async () => {
    // The design stage benefits from the same grounding: if the user
    // uploaded a syllabus PDF, the architect should Read it before
    // committing module/lesson shape.
    const sourcesDir = path.join(coursesRoot, 'demo', 'sources');
    await fs.mkdir(sourcesDir, { recursive: true });
    await fs.writeFile(path.join(sourcesDir, 'syllabus.pdf'), 'x');

    const prompt = defaultDesignCourseCommand('demo').args[1];
    expect(prompt).toContain('Source materials');
    expect(prompt).toContain('Read tool');
    expect(prompt).toContain(path.join(sourcesDir, 'syllabus.pdf'));
  });

  it('default lesson prompt is unchanged when /courses/<slug>/sources/ is absent (US-104)', () => {
    const spec = defaultLessonCommand('demo', 'intro');
    const prompt = spec.args[1];
    expect(prompt).not.toMatch(/Source materials/i);
  });

  it('default lesson prompt injects absolute source-file paths when sources are present (US-104)', async () => {
    const sourcesDir = path.join(coursesRoot, 'demo', 'sources');
    await fs.mkdir(sourcesDir, { recursive: true });
    await fs.writeFile(path.join(sourcesDir, 'slides.pptx'), 'x');

    const spec = defaultLessonCommand('demo', 'intro');
    const prompt = spec.args[1];
    expect(prompt).toContain('Source materials');
    expect(prompt).toContain('Read tool');
    expect(prompt).toContain(path.join(sourcesDir, 'slides.pptx'));
  });

  it('default lesson prompt carries source paths through retry-prefix prompts (US-104)', async () => {
    const sourcesDir = path.join(coursesRoot, 'demo', 'sources');
    await fs.mkdir(sourcesDir, { recursive: true });
    await fs.writeFile(path.join(sourcesDir, 'paper.pdf'), 'x');

    const spec = defaultLessonCommand('demo', 'intro', 'rate limited');
    const prompt = spec.args[1];
    expect(prompt).toMatch(/^PREVIOUS ATTEMPT FAILED:/);
    expect(prompt).toContain('rate limited');
    // Source materials section must still be present so retries don't regress
    // to ungrounded content.
    expect(prompt).toContain('Source materials');
    expect(prompt).toContain(path.join(sourcesDir, 'paper.pdf'));
  });

  // ── GENERATION_MOCK fixture wiring ─────────────────────────────────────
  // The mock branches in each default*Command function spawn .cjs files
  // under src/lib/server/generationMockScripts/. These tests pin the
  // wiring so a rename or move of those files breaks the unit suite
  // (loud) instead of only the playwright e2e suite (slow).
  describe('GENERATION_MOCK fixture wiring', () => {
    const fsSync = require('node:fs') as typeof import('node:fs');
    const mockScriptsDir = path.join(
      process.cwd(),
      'src',
      'lib',
      'server',
      'generationMockScripts',
    );

    afterEach(() => {
      delete process.env.GENERATION_MOCK;
      delete process.env.GENERATION_MOCK_INIT_DELAY_MS;
      delete process.env.GENERATION_MOCK_DESIGN_DELAY_MS;
    });

    it('GENERATION_MOCK=broken points research at the broken stub script', () => {
      process.env.GENERATION_MOCK = 'broken';
      const spec = defaultResearchCourseCommand('demo');
      expect(spec.command).toBe(process.execPath);
      const scriptPath = path.join(mockScriptsDir, 'researchCourseBroken.cjs');
      expect(spec.args).toEqual([scriptPath]);
      expect(fsSync.existsSync(scriptPath)).toBe(true);
    });

    it('GENERATION_MOCK=1 + slug starting with `broken-` points research at the broken stub script', () => {
      process.env.GENERATION_MOCK = '1';
      const spec = defaultResearchCourseCommand('broken-demo');
      const scriptPath = path.join(mockScriptsDir, 'researchCourseBroken.cjs');
      expect(spec.args[0]).toBe(scriptPath);
    });

    it('GENERATION_MOCK=1 points research at researchCourse.cjs with slug + initDelay argv', () => {
      process.env.GENERATION_MOCK = '1';
      process.env.GENERATION_MOCK_INIT_DELAY_MS = '750';
      const spec = defaultResearchCourseCommand('demo');
      expect(spec.command).toBe(process.execPath);
      const scriptPath = path.join(mockScriptsDir, 'researchCourse.cjs');
      expect(spec.args).toEqual([scriptPath, 'demo', '750']);
      expect(fsSync.existsSync(scriptPath)).toBe(true);
    });

    it('GENERATION_MOCK=1 research delay falls back to the 200ms default when the env var is unset / invalid', () => {
      process.env.GENERATION_MOCK = '1';
      delete process.env.GENERATION_MOCK_INIT_DELAY_MS;
      expect(defaultResearchCourseCommand('demo').args[2]).toBe('200');

      process.env.GENERATION_MOCK_INIT_DELAY_MS = 'not-a-number';
      expect(defaultResearchCourseCommand('demo').args[2]).toBe('200');

      process.env.GENERATION_MOCK_INIT_DELAY_MS = '-5';
      expect(defaultResearchCourseCommand('demo').args[2]).toBe('200');
    });

    it('GENERATION_MOCK=1 points design at designCourse.cjs with slug + designDelay argv', () => {
      process.env.GENERATION_MOCK = '1';
      process.env.GENERATION_MOCK_DESIGN_DELAY_MS = '125';
      const spec = defaultDesignCourseCommand('demo');
      expect(spec.command).toBe(process.execPath);
      const scriptPath = path.join(mockScriptsDir, 'designCourse.cjs');
      expect(spec.args).toEqual([scriptPath, 'demo', '125']);
      expect(fsSync.existsSync(scriptPath)).toBe(true);
    });

    it('GENERATION_MOCK=1 design delay defaults to 0 when the env var is unset / invalid', () => {
      process.env.GENERATION_MOCK = '1';
      delete process.env.GENERATION_MOCK_DESIGN_DELAY_MS;
      expect(defaultDesignCourseCommand('demo').args[2]).toBe('0');

      process.env.GENERATION_MOCK_DESIGN_DELAY_MS = 'abc';
      expect(defaultDesignCourseCommand('demo').args[2]).toBe('0');
    });

    it('GENERATION_MOCK=1 does NOT short-circuit design via the `broken-` slug prefix', () => {
      // The `broken-` short-circuit lives on the research stage only —
      // research is always the first init child so that's the path the
      // playwright "broken init" scenario needs to fire. The design mock
      // stays happy regardless of slug prefix.
      process.env.GENERATION_MOCK = '1';
      const spec = defaultDesignCourseCommand('broken-demo');
      const scriptPath = path.join(mockScriptsDir, 'designCourse.cjs');
      expect(spec.args[0]).toBe(scriptPath);
    });

    it('GENERATION_MOCK=1 points lessons at generateLesson.cjs with slug + lessonSlug argv', () => {
      process.env.GENERATION_MOCK = '1';
      const spec = defaultLessonCommand('demo', 'intro');
      expect(spec.command).toBe(process.execPath);
      const scriptPath = path.join(mockScriptsDir, 'generateLesson.cjs');
      expect(spec.args).toEqual([scriptPath, 'demo', 'intro']);
      expect(fsSync.existsSync(scriptPath)).toBe(true);
    });

    it('GENERATION_MOCK=1 points coherence-pass at coherencePass.cjs with no argv', () => {
      process.env.GENERATION_MOCK = '1';
      const spec = defaultCoherencePassCommand('demo');
      expect(spec.command).toBe(process.execPath);
      const scriptPath = path.join(mockScriptsDir, 'coherencePass.cjs');
      expect(spec.args).toEqual([scriptPath]);
      expect(fsSync.existsSync(scriptPath)).toBe(true);
    });
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

    await runInitStages(scripted, 'demo', ['retryme']);

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
      path.join(coursesRoot, 'demo', 'logs', 'retryme.log'),
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
      .access(path.join(coursesRoot, 'demo', 'logs', 'failed_report.json'))
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

    await runInitStages(scripted, 'demo', ['doomed', 'lucky']);

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
      path.join(coursesRoot, 'demo', 'logs', 'doomed.log'),
      'utf8',
    );
    const headers = logRaw.match(/=== Attempt \d+ —/g) ?? [];
    expect(headers).toEqual(['=== Attempt 1 —', '=== Attempt 2 —', '=== Attempt 3 —']);

    // failed_report.json exists with exactly one entry pointing at the per-lesson log.
    const reportRaw = await fs.readFile(
      path.join(coursesRoot, 'demo', 'logs', 'failed_report.json'),
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
    expect(report[0].logPath).toBe('logs/doomed.log');

    // Init logs were teed to logs/research_course.log + logs/design_course.log.
    const researchLog = await fs.readFile(
      path.join(coursesRoot, 'demo', 'logs', 'research_course.log'),
      'utf8',
    );
    expect(typeof researchLog).toBe('string');
    const designLog = await fs.readFile(
      path.join(coursesRoot, 'demo', 'logs', 'design_course.log'),
      'utf8',
    );
    expect(typeof designLog).toBe('string');
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

    await runInitStages(scripted, 'demo', ['hangs']);

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

  it('returns 202 + the same id on a repeat POST for the same slug (US-105)', async () => {
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

    const same = await postGenerate(
      new Request('http://localhost/api/courses/generate', {
        method: 'POST',
        body: JSON.stringify({ slug: 'demo' }),
      }),
    );
    expect(same.status).toBe(202);
    const sameBody = (await same.json()) as { id: string; slug: string };
    expect(sameBody.id).toBe(okBody.id);
    expect(sameBody.slug).toBe('demo');
  });

  it('queues a second concurrent attempt for a DIFFERENT slug instead of 409 (US-107)', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.mkdir(path.join(coursesRoot, 'other'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'demo', 'course-spec.json'),
      JSON.stringify({ stub: true }),
      'utf8',
    );
    await fs.writeFile(
      path.join(coursesRoot, 'other', 'course-spec.json'),
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
    await scripted.nextChild();

    const queued = await postGenerate(
      new Request('http://localhost/api/courses/generate', {
        method: 'POST',
        body: JSON.stringify({ slug: 'other' }),
      }),
    );
    expect(queued.status).toBe(202);
    const queuedBody = (await queued.json()) as {
      queued: boolean;
      slug: string;
      position: number;
      total: number;
    };
    expect(queuedBody.queued).toBe(true);
    expect(queuedBody.slug).toBe('other');
    expect(queuedBody.position).toBe(1);
    expect(queuedBody.total).toBe(1);
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

    const research = await scripted.nextChild();
    research.emitStdout('hello-world\n');
    await writeStubResearchArtefacts('demo');
    research.finishWithExit(0);
    const design = await scripted.nextChild();
    await writeStubCourse('demo', ['intro']);
    design.finishWithExit(0);
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

describe('getActiveRunSummary (US-106)', () => {
  it('returns {active:false} when nothing is in flight', async () => {
    const summary = await getActiveRunSummary();
    expect(summary).toEqual({ active: false, queue: [] });
  });

  it('reports the in-memory run with its current stage and resolves the name from course-spec.json', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'demo', 'course-spec.json'),
      JSON.stringify({
        topic: 'whatever',
        level: 'beginner',
        durationTarget: 'short',
        theoryPracticeRatio: 0.5,
        draftStructure: {
          courseTitle: 'My Resumed Course',
          courseDescription: '',
          modules: [],
        },
        createdAt: '2026-04-30T00:00:00Z',
      }),
      'utf8',
    );
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    void run;

    // Init child has spawned and stage:started has fired.
    await scripted.nextChild();
    // Flush microtasks so the synchronous emit() has updated currentStage.
    await new Promise((r) => setImmediate(r));

    const summary = await getActiveRunSummary();
    expect(summary).toEqual({
      active: true,
      slug: 'demo',
      name: 'My Resumed Course',
      stage: 'research_course',
      queue: [],
    });
  });

  it('writes a .generating.json marker while the run is active and removes it on finalize', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    const init = await scripted.nextChild();
    // Marker writes are fire-and-forget; poll briefly for the latest write
    // (the one with the spawned child's PID) to land on disk.
    const markerPath = path.join(coursesRoot, 'demo', '.generating.json');
    let raw = '';
    for (let i = 0; i < 100; i++) {
      try {
        raw = await fs.readFile(markerPath, 'utf8');
        const m = JSON.parse(raw) as { childPid: number | null };
        if (typeof m.childPid === 'number' && m.childPid > 0) break;
      } catch {
        /* not yet */
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    const marker = JSON.parse(raw) as {
      slug: string;
      stage: string | null;
      childPid: number | null;
    };
    expect(marker.slug).toBe('demo');
    // First spawn is the research_course child — marker reflects the
    // most-recently started stage.
    expect(marker.stage).toBe('research_course');
    expect(marker.childPid).toBe(init.pid);

    // Finish the research child with a non-zero exit so the pipeline
    // bails to the error finalize branch (no design child spawns) — that
    // path also removes the marker.
    init.finishWithExit(1);
    await waitForFinish(run);

    await expect(fs.access(markerPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cold-start: skips a stale marker (dead PID) and unlinks it', async () => {
    const dir = path.join(coursesRoot, 'ghosted');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, '.generating.json'),
      JSON.stringify({
        childPid: 9999999, // very high — guaranteed ESRCH on modern kernels
        slug: 'ghosted',
        stage: 'research_course',
        startedAt: '2026-05-04T00:00:00.000Z',
      }),
      'utf8',
    );
    const summary = await getActiveRunSummary();
    expect(summary.active).toBe(false);
    await expect(fs.access(path.join(dir, '.generating.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('cold-start: returns the live-PID marker and falls back to slug for the name', async () => {
    const dir = path.join(coursesRoot, 'survivor');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, '.generating.json'),
      JSON.stringify({
        childPid: process.pid, // current process is alive by definition
        slug: 'survivor',
        stage: 'lesson:intro',
        startedAt: '2026-05-04T00:00:00.000Z',
      }),
      'utf8',
    );
    const summary = await getActiveRunSummary();
    expect(summary).toEqual({
      active: true,
      slug: 'survivor',
      name: 'survivor',
      stage: 'lesson:intro',
      queue: [],
    });
  });
});

describe('enqueueGeneration / sequential queue (US-107)', () => {
  it('starts immediately when nothing is active', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const result = await enqueueGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    expect(result.kind).toBe('started');
    if (result.kind === 'started') {
      expect(result.run.slug).toBe('demo');
    }
  });

  it('queues a different slug when one is already in flight, in FIFO order', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.mkdir(path.join(coursesRoot, 'second'), { recursive: true });
    await fs.mkdir(path.join(coursesRoot, 'third'), { recursive: true });
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const first = await enqueueGeneration('demo');
    expect(first.kind).toBe('started');
    await scripted.nextChild();

    const second = await enqueueGeneration('second');
    expect(second.kind).toBe('queued');
    if (second.kind === 'queued') {
      expect(second.slug).toBe('second');
      expect(second.position).toBe(1);
      expect(second.total).toBe(1);
    }

    const third = await enqueueGeneration('third');
    expect(third.kind).toBe('queued');
    if (third.kind === 'queued') {
      expect(third.position).toBe(2);
      expect(third.total).toBe(2);
    }

    expect(await __getQueueForTesting()).toEqual(['second', 'third']);
  });

  it('returns existing run idempotently when same slug is enqueued while active', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const first = await enqueueGeneration('demo');
    expect(first.kind).toBe('started');
    await scripted.nextChild();

    const same = await enqueueGeneration('demo');
    expect(same.kind).toBe('started');
    if (first.kind === 'started' && same.kind === 'started') {
      expect(same.run).toBe(first.run);
    }
    expect(await __getQueueForTesting()).toEqual([]);
  });

  it('returns existing position when same slug is enqueued while already pending', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.mkdir(path.join(coursesRoot, 'pending'), { recursive: true });
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    await enqueueGeneration('demo');
    await scripted.nextChild();

    const queued = await enqueueGeneration('pending');
    expect(queued.kind).toBe('queued');

    const sameQueued = await enqueueGeneration('pending');
    expect(sameQueued.kind).toBe('queued');
    if (sameQueued.kind === 'queued') {
      expect(sameQueued.position).toBe(1);
      expect(sameQueued.total).toBe(1);
    }
    // Still exactly one entry in the queue (not two duplicates).
    expect(await __getQueueForTesting()).toEqual(['pending']);
  });

  it('persists the queue to disk on every change', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.mkdir(path.join(coursesRoot, 'next'), { recursive: true });
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    await enqueueGeneration('demo');
    await scripted.nextChild();
    await enqueueGeneration('next');

    const queueFile = process.env.GENERATION_QUEUE_FILE_OVERRIDE!;
    const raw = await fs.readFile(queueFile, 'utf8');
    const parsed = JSON.parse(raw) as { entries: Array<{ slug: string }> };
    expect(parsed.entries.map((e) => e.slug)).toEqual(['next']);
  });

  it('auto-starts the next queued slug when the active run finishes', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.mkdir(path.join(coursesRoot, 'next'), { recursive: true });
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const first = await enqueueGeneration('demo');
    expect(first.kind).toBe('started');

    const init = await scripted.nextChild();

    const second = await enqueueGeneration('next');
    expect(second.kind).toBe('queued');

    // Finish 'demo' research child with no research.md so the
    // post-research guard trips and the pipeline finalizes via the error
    // path — finalize must still drain the queue.
    init.finishWithExit(0);

    if (first.kind !== 'started') throw new Error('first not started');
    await waitForFinish(first.run);
    // The drainer is fire-and-forget — give it a tick to advance.
    for (let i = 0; i < 20; i++) {
      if (getActiveRun() && getActiveRun()?.slug === 'next') break;
      await new Promise((r) => setImmediate(r));
    }

    const active = getActiveRun();
    expect(active).not.toBeNull();
    expect(active?.slug).toBe('next');
    expect(await __getQueueForTesting()).toEqual([]);
  });

  it('reports queue context via getActiveRunSummary while a run is active', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.mkdir(path.join(coursesRoot, 'next'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'next', 'course-spec.json'),
      JSON.stringify({
        topic: 'x',
        level: 'beginner',
        durationTarget: 'short',
        theoryPracticeRatio: 0.5,
        draftStructure: { courseTitle: 'Next One', courseDescription: '', modules: [] },
        createdAt: '2026-04-30T00:00:00Z',
      }),
      'utf8',
    );

    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    await enqueueGeneration('demo');
    await scripted.nextChild();
    await enqueueGeneration('next');

    const summary = await getActiveRunSummary();
    expect(summary.active).toBe(true);
    if (summary.active) {
      expect(summary.slug).toBe('demo');
      expect(summary.queue).toEqual([
        { slug: 'next', name: 'Next One', position: 1 },
      ]);
    }
  });

  it('loads the persisted queue on cold start and resumes the head', async () => {
    // Simulate a server restart: pre-write a queue file for a slug whose
    // course-spec.json is on disk, then trigger getActiveRunSummary which
    // is the load-and-drain entry point.
    await fs.mkdir(path.join(coursesRoot, 'resume-me'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'resume-me', 'course-spec.json'),
      JSON.stringify({ stub: true }),
      'utf8',
    );
    const queueFile = process.env.GENERATION_QUEUE_FILE_OVERRIDE!;
    await fs.mkdir(path.dirname(queueFile), { recursive: true });
    await fs.writeFile(
      queueFile,
      JSON.stringify({
        entries: [{ slug: 'resume-me', enqueuedAt: '2026-05-05T00:00:00.000Z' }],
      }),
      'utf8',
    );

    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    // First poll triggers ensureQueueLoaded + maybeStartQueueHead. The
    // active run isn't synchronously assigned (startGeneration awaits
    // before activeRun = run), so the first response shows queue but no
    // active. The next tick will spawn.
    await getActiveRunSummary();

    // Allow the drainer to finish starting.
    await scripted.nextChild();
    expect(getActiveRun()?.slug).toBe('resume-me');
  });
});

describe('.generation-state.json lifecycle (US-136)', () => {
  it('writes the state file after init, advances each lesson through inflight→done, and DELETES on full success', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 2,
      lessonTimeoutMs: 60_000,
    });

    await runInitStages(scripted, 'demo', ['intro', 'outro']);

    // After init success the state file exists with both lessons pending.
    // Poll until BOTH init stages are persisted as 'done' — research lands
    // first, then design, with the lesson loop kicking off right after.
    const statePath = generationStateFile('demo');
    let snapshot = await readGenerationState('demo');
    for (let i = 0; i < 50; i++) {
      snapshot = await readGenerationState('demo');
      if (snapshot && snapshot.design.status === 'done') break;
      await new Promise((r) => setImmediate(r));
    }
    expect(snapshot).not.toBeNull();
    expect(snapshot!.research.status).toBe('done');
    expect(snapshot!.design.status).toBe('done');
    expect(snapshot!.lessons.map((l) => l.slug)).toEqual(['intro', 'outro']);
    expect(snapshot!.lessons.every((l) => l.status === 'pending')).toBe(true);
    expect(snapshot!.config.lessonMaxRetries).toBe(2);
    expect(snapshot!.config.lessonTimeoutMs).toBe(60_000);

    const intro = await scripted.nextChild();
    // After the spawn for intro the file should reflect inflight + attempts=1.
    let inflight = await readGenerationState('demo');
    for (let i = 0; i < 50; i++) {
      inflight = await readGenerationState('demo');
      if (inflight?.lessons.find((l) => l.slug === 'intro')?.status === 'inflight') break;
      await new Promise((r) => setImmediate(r));
    }
    expect(inflight!.lessons.find((l) => l.slug === 'intro')).toMatchObject({
      status: 'inflight',
      attempts: 1,
    });
    await writeStubLesson('demo', 'intro');
    intro.finishWithExit(0);

    const outro = await scripted.nextChild();
    await writeStubLesson('demo', 'outro');
    outro.finishWithExit(0);

    await waitForFinish(run);

    // Full success → state file is deleted.
    await expect(fs.access(statePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readGenerationState('demo')).toBeNull();
  });

  it('leaves the state file in place when a lesson fails after exhausting retries, with status=failed + lastError', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 1, // 2 attempts max — keeps the test short
      lessonTimeoutMs: 60_000,
    });

    await runInitStages(scripted, 'demo', ['lucky', 'doomed']);

    const lucky = await scripted.nextChild();
    await writeStubLesson('demo', 'lucky');
    lucky.finishWithExit(0);

    // 'doomed' fails on every attempt.
    for (let i = 0; i < 2; i++) {
      const attempt = await scripted.nextChild();
      attempt.emitStderr(`boom ${i + 1}\n`);
      attempt.finishWithExit(1);
    }

    await waitForFinish(run);

    const state = await readGenerationState('demo');
    expect(state).not.toBeNull();
    expect(state!.research.status).toBe('done');
    expect(state!.design.status).toBe('done');
    const lucky2 = state!.lessons.find((l) => l.slug === 'lucky');
    const doomed = state!.lessons.find((l) => l.slug === 'doomed');
    expect(lucky2?.status).toBe('done');
    expect(lucky2?.finishedAt).toMatch(/T/);
    expect(doomed?.status).toBe('failed');
    expect(doomed?.attempts).toBe(2);
    expect(doomed?.lastError).toMatch(/exited with code 1/);
  });

  it('atomic write leaves no .tmp leftover even if the child is killed mid-lesson', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 0,
      lessonTimeoutMs: 60_000,
      sigkillGraceMs: 50,
    });

    await runInitStages(scripted, 'demo', ['only']);

    // Wait until the lesson child is alive (state file shows inflight) then
    // simulate a SIGKILL. atomicWriteJson always renames from .tmp → final;
    // there should never be a .tmp residue once the write completes.
    const lesson = await scripted.nextChild();
    for (let i = 0; i < 50; i++) {
      const s = await readGenerationState('demo');
      if (s?.lessons[0].status === 'inflight') break;
      await new Promise((r) => setImmediate(r));
    }

    // Simulate kill-9: child exits 137 without writing the lesson file.
    lesson.finishWithExit(137);

    await waitForFinish(run);

    // No .tmp file dangles next to the state file.
    const dir = path.join(coursesRoot, 'demo');
    const entries = await fs.readdir(dir);
    const tmpLeftovers = entries.filter((n) => n.endsWith('.generation-state.json.tmp'));
    expect(tmpLeftovers).toEqual([]);

    // The state file is still readable + valid (resume target for US-137).
    const state = await readGenerationState('demo');
    expect(state).not.toBeNull();
    expect(state!.lessons[0].status).toBe('failed');
  });

  it('records research.status=failed on research_course failure (no research.md produced)', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const claude = await scripted.nextChild();
    claude.emitStdout('Unknown command: /research_course\n');
    claude.finishWithExit(0); // exits 0 but does NOT write research.md

    await waitForFinish(run);

    const state = await readGenerationState('demo');
    expect(state).not.toBeNull();
    expect(state!.research.status).toBe('failed');
    expect(state!.research.reason).toMatch(/did not produce research\.md/i);
    // Design stage never ran — stays pending.
    expect(state!.design.status).toBe('pending');
    expect(state!.lessons).toEqual([]);
  });

  it('records design.status=failed on design_course failure (research done, course.json missing)', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const research = await scripted.nextChild();
    await writeStubResearchArtefacts('demo');
    research.finishWithExit(0);

    const design = await scripted.nextChild();
    design.emitStdout('Unknown command: /design_course\n');
    design.finishWithExit(0); // exits 0 but does NOT write course.json

    await waitForFinish(run);

    const state = await readGenerationState('demo');
    expect(state).not.toBeNull();
    expect(state!.research.status).toBe('done');
    expect(state!.design.status).toBe('failed');
    expect(state!.design.reason).toMatch(/did not produce course\.json/i);
    expect(state!.lessons).toEqual([]);
  });
});

describe('resumeGeneration (US-137)', () => {
  /** Helper: write a stub state file directly to disk, bypassing the pipeline. */
  async function writeStubState(slug: string, state: GenerationState) {
    const dir = path.join(coursesRoot, slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(generationStateFile(slug), JSON.stringify(state, null, 2), 'utf8');
  }

  it('throws GenerationStateMissingError when no .generation-state.json exists', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await expect(
      resumeGeneration('demo', { isExecutableInPath: () => true }),
    ).rejects.toBeInstanceOf(GenerationStateMissingError);
  });

  it('skips done lessons, retries the inflight lesson, and runs pending lessons in order', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });

    // Run #1: drive lesson 'one' to done, leave lesson 'two' inflight when
    // the user cancels mid-attempt; lesson 'three' never gets a chance to start.
    const scripted1 = makeScriptedSpawn();
    const run1 = await startGeneration('demo', {
      spawn: scripted1.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 2,
      lessonTimeoutMs: 60_000,
      sigkillGraceMs: 5,
    });

    await runInitStages(scripted1, 'demo', ['one', 'two', 'three']);

    const one = await scripted1.nextChild();
    await writeStubLesson('demo', 'one');
    one.finishWithExit(0);

    // Lesson 'two' is mid-spawn — wait until state.lessons['two'] flips to
    // inflight, then cancel so the run finalises with 'two' inflight on disk.
    await scripted1.nextChild();
    for (let i = 0; i < 100; i++) {
      const s = await readGenerationState('demo');
      if (s?.lessons.find((l) => l.slug === 'two')?.status === 'inflight') break;
      await new Promise((r) => setImmediate(r));
    }
    await run1.cancel();
    await waitForFinish(run1);

    const beforeResume = await readGenerationState('demo');
    expect(beforeResume).not.toBeNull();
    expect(beforeResume!.lessons.find((l) => l.slug === 'one')?.status).toBe('done');
    expect(beforeResume!.lessons.find((l) => l.slug === 'two')?.status).toBe('inflight');
    expect(beforeResume!.lessons.find((l) => l.slug === 'two')?.attempts).toBe(1);
    expect(beforeResume!.lessons.find((l) => l.slug === 'three')?.status).toBe('pending');

    // Resume — different scripted spawn so we can count children fresh.
    // Clear the post-cancel cooldown that would otherwise block resume.
    __clearCancelCooldownForTesting();
    const scripted2 = makeScriptedSpawn();
    const run2 = await resumeGeneration('demo', {
      spawn: scripted2.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 2,
      lessonTimeoutMs: 60_000,
    });

    // Wait for the resumed event to land. It MUST be the very first event.
    for (let i = 0; i < 100; i++) {
      if (run2.events.find((e) => e.type === 'resumed')) break;
      await new Promise((r) => setImmediate(r));
    }
    expect(run2.events[0]).toEqual({
      type: 'resumed',
      completed: ['one'],
      remaining: ['two', 'three'],
      inflightSlug: 'two',
    });

    // Lesson 'two' spawns directly — no init re-run.
    const two2 = await scripted2.nextChild();
    let mid: GenerationState | null = null;
    for (let i = 0; i < 100; i++) {
      mid = await readGenerationState('demo');
      if (mid?.lessons.find((l) => l.slug === 'two')?.attempts === 2) break;
      await new Promise((r) => setImmediate(r));
    }
    expect(mid!.lessons.find((l) => l.slug === 'two')?.attempts).toBe(2);
    expect(mid!.lessons.find((l) => l.slug === 'two')?.status).toBe('inflight');
    await writeStubLesson('demo', 'two');
    two2.finishWithExit(0);

    // Lesson 'three' spawns next.
    const three2 = await scripted2.nextChild();
    await writeStubLesson('demo', 'three');
    three2.finishWithExit(0);

    await waitForFinish(run2);

    // Exactly two children spawned in the resume run — init was skipped and
    // 'one' was skipped as already-done.
    expect(scripted2.children.length).toBe(2);

    const done = run2.events.find((e) => e.type === 'done') as
      | { type: 'done'; courseSlug: string; failedLessons: FailedLesson[] }
      | undefined;
    expect(done).toBeDefined();
    expect(done?.failedLessons).toEqual([]);

    // Full success → state file deleted.
    await expect(fs.access(generationStateFile('demo'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('marks a lesson failed without spawning when its remaining attempt budget is 0', async () => {
    // lessonMaxRetries=2 → 3 total attempts. attempts=3 → remaining=0.
    await writeStubCourse('demo', ['alpha', 'beta', 'gamma']);
    await writeStubLesson('demo', 'alpha');
    await writeStubState('demo', {
      schemaVersion: 1,
      slug: 'demo',
      startedAt: '2026-05-08T00:00:00.000Z',
      lastUpdatedAt: '2026-05-08T00:00:00.000Z',
      research: { status: 'done' },
      design: { status: 'done' },
      lessons: [
        {
          slug: 'alpha',
          status: 'done',
          attempts: 1,
          finishedAt: '2026-05-08T00:00:01.000Z',
        },
        { slug: 'beta', status: 'failed', attempts: 3, lastError: 'budget burned' },
        { slug: 'gamma', status: 'pending', attempts: 0 },
      ],
      config: { lessonMaxRetries: 2, lessonTimeoutMs: 60_000 },
    });

    const scripted = makeScriptedSpawn();
    const run = await resumeGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    // Only 'gamma' should spawn — 'alpha' is done, 'beta' has no remaining budget.
    const gamma = await scripted.nextChild();
    await writeStubLesson('demo', 'gamma');
    gamma.finishWithExit(0);

    await waitForFinish(run);

    expect(scripted.children.length).toBe(1);

    const done = run.events.find((e) => e.type === 'done') as
      | { type: 'done'; failedLessons: FailedLesson[] }
      | undefined;
    expect(done).toBeDefined();
    expect(done?.failedLessons.map((f) => f.slug)).toEqual(['beta']);
    expect(done?.failedLessons[0]?.reason).toBe('budget burned');

    // State file is left in place because a lesson failed.
    const after = await readGenerationState('demo');
    expect(after).not.toBeNull();
    expect(after!.lessons.find((l) => l.slug === 'beta')?.status).toBe('failed');
    expect(after!.lessons.find((l) => l.slug === 'beta')?.attempts).toBe(3);
  });

  it('removes a stale <lesson>.tmp before the spawn but leaves a sibling .json untouched', async () => {
    await writeStubCourse('demo', ['alpha', 'beta']);
    // 'alpha' is already done with a valid alpha.json on disk; 'beta' is pending
    // with a stale beta.tmp leftover from a prior atomic-write crash.
    await writeStubLesson('demo', 'alpha');
    const lessonsDir = path.join(coursesRoot, 'demo', 'lessons');
    await fs.mkdir(lessonsDir, { recursive: true });
    await fs.writeFile(path.join(lessonsDir, 'beta.tmp'), 'partial garbage', 'utf8');

    await writeStubState('demo', {
      schemaVersion: 1,
      slug: 'demo',
      startedAt: '2026-05-08T00:00:00.000Z',
      lastUpdatedAt: '2026-05-08T00:00:00.000Z',
      research: { status: 'done' },
      design: { status: 'done' },
      lessons: [
        {
          slug: 'alpha',
          status: 'done',
          attempts: 1,
          finishedAt: '2026-05-08T00:00:01.000Z',
        },
        { slug: 'beta', status: 'pending', attempts: 0 },
      ],
      config: { lessonMaxRetries: 2, lessonTimeoutMs: 60_000 },
    });

    const scripted = makeScriptedSpawn();
    const run = await resumeGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 2,
      lessonTimeoutMs: 60_000,
    });

    const beta = await scripted.nextChild();

    // The unlink runs before spawnChild, so by the time the child exists on
    // the test side the stale .tmp must already be gone.
    await expect(fs.access(path.join(lessonsDir, 'beta.tmp'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    // Sibling alpha.json was never touched by the cleanup.
    await fs.access(path.join(lessonsDir, 'alpha.json'));

    await writeStubLesson('demo', 'beta');
    beta.finishWithExit(0);
    await waitForFinish(run);
  });

  it('emits the resumed event before any stage events even when init is rerun', async () => {
    // research not done → resume must still emit the resumed event FIRST,
    // then go on to re-run the init pipeline (research + design).
    await writeStubState('demo', {
      schemaVersion: 1,
      slug: 'demo',
      startedAt: '2026-05-08T00:00:00.000Z',
      lastUpdatedAt: '2026-05-08T00:00:00.000Z',
      research: { status: 'failed', reason: 'crashed' },
      design: { status: 'pending' },
      lessons: [],
      config: { lessonMaxRetries: 2, lessonTimeoutMs: 60_000 },
    });

    const scripted = makeScriptedSpawn();
    const run = await resumeGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    for (let i = 0; i < 100; i++) {
      if (run.events.find((e) => e.type === 'resumed')) break;
      await new Promise((r) => setImmediate(r));
    }
    expect(run.events[0]).toEqual({
      type: 'resumed',
      completed: [],
      remaining: [],
      inflightSlug: null,
    });

    // Init re-runs (both stages succeed; course.json lands with one lesson).
    await runInitStages(scripted, 'demo', ['only']);

    const only = await scripted.nextChild();
    await writeStubLesson('demo', 'only');
    only.finishWithExit(0);

    await waitForFinish(run);
    expect(run.events.find((e) => e.type === 'done')).toBeDefined();
  });

  it('returns the active run idempotently when the same slug is already resuming', async () => {
    await writeStubCourse('demo', ['x']);
    await writeStubState('demo', {
      schemaVersion: 1,
      slug: 'demo',
      startedAt: '2026-05-08T00:00:00.000Z',
      lastUpdatedAt: '2026-05-08T00:00:00.000Z',
      research: { status: 'done' },
      design: { status: 'done' },
      lessons: [{ slug: 'x', status: 'pending', attempts: 0 }],
      config: { lessonMaxRetries: 2, lessonTimeoutMs: 60_000 },
    });

    const scripted = makeScriptedSpawn();
    const first = await resumeGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    await scripted.nextChild();
    const same = await resumeGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    expect(same).toBe(first);
  });

  it('throws GenerationConflictError when a different slug is already in flight', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await writeStubCourse('other', ['x']);
    await writeStubState('other', {
      schemaVersion: 1,
      slug: 'other',
      startedAt: '2026-05-08T00:00:00.000Z',
      lastUpdatedAt: '2026-05-08T00:00:00.000Z',
      research: { status: 'done' },
      design: { status: 'done' },
      lessons: [{ slug: 'x', status: 'pending', attempts: 0 }],
      config: { lessonMaxRetries: 2, lessonTimeoutMs: 60_000 },
    });

    const scripted = makeScriptedSpawn();
    const live = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    void live;
    await scripted.nextChild();

    await expect(
      resumeGeneration('other', {
        spawn: scripted.spawn,
        isExecutableInPath: () => true,
      }),
    ).rejects.toBeInstanceOf(GenerationConflictError);
  });
});

describe('POST /api/courses/[slug]/resume (US-137)', () => {
  async function writeStubState(slug: string, state: GenerationState) {
    const dir = path.join(coursesRoot, slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(generationStateFile(slug), JSON.stringify(state, null, 2), 'utf8');
  }

  it('returns 200 + runId when the state file exists', async () => {
    await writeStubCourse('demo', ['x']);
    await writeStubState('demo', {
      schemaVersion: 1,
      slug: 'demo',
      startedAt: '2026-05-08T00:00:00.000Z',
      lastUpdatedAt: '2026-05-08T00:00:00.000Z',
      research: { status: 'done' },
      design: { status: 'done' },
      lessons: [{ slug: 'x', status: 'pending', attempts: 0 }],
      config: { lessonMaxRetries: 2, lessonTimeoutMs: 60_000 },
    });
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({ spawn: scripted.spawn, isExecutableInPath: () => true });

    const req = new Request('http://localhost/api/courses/demo/resume', {
      method: 'POST',
    });
    const res = await postResume(req, { params: Promise.resolve({ slug: 'demo' }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId?: string; slug?: string };
    expect(typeof body.runId).toBe('string');
    expect(body.runId).toMatch(/^gen-/);
    expect(body.slug).toBe('demo');

    // Drive the resumed pipeline to completion so afterEach's tmp-dir
    // teardown happens AFTER all deferred persistGenState writes — otherwise
    // a final write fires once COURSES_ROOT_OVERRIDE has been cleared and
    // leaks state into the project's real courses/ tree.
    const run = getRunById(body.runId!);
    expect(run).toBeDefined();
    const child = await scripted.nextChild();
    await writeStubLesson('demo', 'x');
    child.finishWithExit(0);
    await waitForFinish(run!);
  });

  it('returns 409 no-resumable-state when no state file exists', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    __setSpawnDepsForTesting({ isExecutableInPath: () => true });

    const req = new Request('http://localhost/api/courses/demo/resume', {
      method: 'POST',
    });
    const res = await postResume(req, { params: Promise.resolve({ slug: 'demo' }) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('no-resumable-state');
  });

  it('returns 409 busy when a different slug is already in flight', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await writeStubCourse('other', ['x']);
    await writeStubState('other', {
      schemaVersion: 1,
      slug: 'other',
      startedAt: '2026-05-08T00:00:00.000Z',
      lastUpdatedAt: '2026-05-08T00:00:00.000Z',
      research: { status: 'done' },
      design: { status: 'done' },
      lessons: [{ slug: 'x', status: 'pending', attempts: 0 }],
      config: { lessonMaxRetries: 2, lessonTimeoutMs: 60_000 },
    });

    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({ spawn: scripted.spawn, isExecutableInPath: () => true });
    await startGeneration('demo');
    await scripted.nextChild();

    const req = new Request('http://localhost/api/courses/other/resume', {
      method: 'POST',
    });
    const res = await postResume(req, { params: Promise.resolve({ slug: 'other' }) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('busy');
  });
});

describe('persistent generation events ndjson + SSE replay (US-138)', () => {
  // Writes a course.json with zero modules so the per-lesson loop is a no-op
  // — the test is then free to drive arbitrary log events through the
  // research child's stdout without spawning a chain of lesson children.
  async function writeEmptyCourse(slug: string) {
    const dir = path.join(coursesRoot, slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'course.json'),
      JSON.stringify({
        schemaVersion: 1,
        slug,
        title: 'Stub',
        description: 'Empty course for ndjson tests',
        accentColor: 'indigo',
        icon: 'sigma',
        modules: [],
        createdAt: '2026-05-04T00:00:00.000Z',
        updatedAt: '2026-05-04T00:00:00.000Z',
      }),
      'utf8',
    );
  }

  // Empty-course variant of runInitStages: caller-supplied research stdout
  // drives the log events for these ndjson tests; then research finishes,
  // design writes an empty course.json (zero modules), pipeline finalises
  // with no per-lesson spawns.
  async function emitOnResearchAndFinishInit(
    scripted: ScriptedSpawn,
    slug: string,
    researchStdout: string,
  ): Promise<void> {
    const research = await scripted.nextChild();
    research.emitStdout(researchStdout);
    await writeStubResearchArtefacts(slug);
    research.finishWithExit(0);
    const design = await scripted.nextChild();
    await writeEmptyCourse(slug);
    design.finishWithExit(0);
  }

  it('appends every emitted event to .generation-events.ndjson with a monotonic seq', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    await emitOnResearchAndFinishInit(scripted, 'demo', 'a\nb\nc\n');
    await waitForFinish(run);

    const raw = await fs.readFile(eventsLogPath('demo'), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines.length).toBe(run.events.length);
    expect(lines.length).toBe(run.eventSeqs.length);
    expect(run.eventSeqs[0]).toBe(1);
    for (let i = 1; i < run.eventSeqs.length; i++) {
      expect(run.eventSeqs[i]).toBe(run.eventSeqs[i - 1] + 1);
    }
    // Each line is { seq, timestamp, event } and the in-memory order
    // matches the on-disk order.
    const parsed = lines.map((line) => JSON.parse(line) as { seq: number; event: GenerationEvent });
    expect(parsed.map((p) => p.seq)).toEqual(Array.from({ length: parsed.length }, (_, i) => i + 1));
    for (let i = 0; i < parsed.length; i++) {
      expect(parsed[i].event).toEqual(run.events[i]);
    }
    expect(run.lastSeq).toBe(parsed.length);
  });

  it('replays only events with seq > Last-Event-ID and never duplicates', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    // Drive enough log events that capturing seq=42 leaves a long tail to
    // replay (and the AC's "100 events" target is comfortably exceeded).
    let blob = '';
    for (let i = 1; i <= 100; i++) blob += `line ${i}\n`;
    await emitOnResearchAndFinishInit(scripted, 'demo', blob);
    await waitForFinish(run);
    expect(run.lastSeq).toBeGreaterThanOrEqual(100);

    const res = await streamGenerate(
      new Request(`http://localhost/stream/${run.id}`, {
        headers: { 'Last-Event-ID': '42' },
      }),
      { params: Promise.resolve({ id: run.id }) },
    );
    expect(res.status).toBe(200);
    const text = await res.text();

    // Frame structure: each chunk begins with `id: <seq>\n`. The first id
    // returned must be 43; ids 1..42 must be entirely absent.
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids[0]).toBe(43);
    // No duplicates and strictly monotonic.
    for (let i = 1; i < ids.length; i++) expect(ids[i]).toBe(ids[i - 1] + 1);
    // Tail covers every event beyond seq=42.
    expect(ids[ids.length - 1]).toBe(run.lastSeq);
    expect(ids.includes(42)).toBe(false);
    expect(ids.includes(1)).toBe(false);
  });

  it('honours ?from= query when no Last-Event-ID header is present', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    await emitOnResearchAndFinishInit(scripted, 'demo', 'one\ntwo\nthree\n');
    await waitForFinish(run);

    const res = await streamGenerate(
      new Request(`http://localhost/stream/${run.id}?from=2`),
      { params: Promise.resolve({ id: run.id }) },
    );
    const text = await res.text();
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids[0]).toBe(3);
  });

  it('Last-Event-ID header takes precedence over ?from= when both are present', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    await emitOnResearchAndFinishInit(scripted, 'demo', 'a\nb\nc\nd\ne\n');
    await waitForFinish(run);

    const res = await streamGenerate(
      new Request(`http://localhost/stream/${run.id}?from=1`, {
        headers: { 'Last-Event-ID': '4' },
      }),
      { params: Promise.resolve({ id: run.id }) },
    );
    const text = await res.text();
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    // Header wins → first id is 5, not 2.
    expect(ids[0]).toBe(5);
  });

  it('only replays events from the active file after rotation past 5 MB', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    // Shrink the rotation threshold so the test trips it after ~3 KB
    // instead of ~5 MB — production-equivalent behaviour, just cheaper.
    __setEventsLogRotateBytesForTesting(1024);

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    const research = await scripted.nextChild();
    // ~10 events of ~200 bytes each blow past the 1 KB threshold.
    let blob = '';
    for (let i = 0; i < 10; i++) blob += `${'x'.repeat(200)}\n`;
    research.emitStdout(blob);
    // Pump a small idle so all data events drain before research exits,
    // then fire a second batch — the rotation must have occurred by then so
    // these later events land in the *fresh* active file.
    await new Promise((r) => setImmediate(r));
    research.emitStdout(`${'y'.repeat(50)}\n${'y'.repeat(50)}\n${'y'.repeat(50)}\n`);
    await writeStubResearchArtefacts('demo');
    research.finishWithExit(0);
    const design = await scripted.nextChild();
    await writeEmptyCourse('demo');
    design.finishWithExit(0);
    await waitForFinish(run);

    // A rotated file exists alongside the still-present active file.
    const dir = path.join(coursesRoot, 'demo');
    const entries = await fs.readdir(dir);
    const rotated = entries.filter(
      (n) => n.startsWith('.generation-events.') && n.endsWith('.ndjson') && n !== '.generation-events.ndjson',
    );
    expect(rotated.length).toBeGreaterThanOrEqual(1);

    // Read the ACTIVE file directly to discover its first seq — that's the
    // floor of what replay can return; everything below it lives only in
    // the rotated file and is intentionally NOT surfaced to clients.
    const activeRaw = await fs.readFile(eventsLogPath('demo'), 'utf8');
    const activeSeqs = activeRaw
      .split('\n')
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { seq: number }).seq);
    expect(activeSeqs.length).toBeGreaterThan(0);
    const minActiveSeq = Math.min(...activeSeqs);
    expect(minActiveSeq).toBeGreaterThan(1);

    // Replay from a seq before the rotation. The wizard expects to see
    // ONLY the active-file tail — older events live on disk for forensics
    // but the rotation contract drops them from the live SSE replay.
    const res = await streamGenerate(
      new Request(`http://localhost/stream/${run.id}`, {
        headers: { 'Last-Event-ID': '1' },
      }),
      { params: Promise.resolve({ id: run.id }) },
    );
    const text = await res.text();
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids.length).toBe(activeSeqs.length);
    for (const id of ids) expect(id).toBeGreaterThanOrEqual(minActiveSeq);
    // None of the rotated seqs (everything strictly below minActiveSeq) are
    // surfaced.
    for (let s = 2; s < minActiveSeq; s++) expect(ids.includes(s)).toBe(false);
  });

  it('skips a malformed line in the middle of the active file and continues', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    await emitOnResearchAndFinishInit(scripted, 'demo', 'a\nb\nc\nd\ne\n');
    await waitForFinish(run);

    // Inject a corrupt line in the middle of the active file (simulating a
    // partial-write at crash). The parser must skip it and still surface
    // the surrounding valid entries.
    const filePath = eventsLogPath('demo');
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const mid = Math.floor(lines.length / 2);
    const corrupted = [
      ...lines.slice(0, mid),
      '{"seq":99,"timestamp":"oops","event":{trun', // truncated mid-write
      ...lines.slice(mid),
    ].join('\n') + '\n';
    await fs.writeFile(filePath, corrupted, 'utf8');

    // Direct readEventsLogSync — easier to assert than walking SSE bytes.
    const replay = readEventsLogSync('demo', 0);
    expect(replay.skippedMalformed).toBe(1);
    // Valid entries flank the malformed one.
    const seqs = replay.entries.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    expect(replay.entries.length).toBe(lines.length);

    // The SSE route also tolerates the malformed line and emits a single
    // console.warn for the whole replay.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await streamGenerate(
        new Request(`http://localhost/stream/${run.id}`),
        { params: Promise.resolve({ id: run.id }) },
      );
      const text = await res.text();
      const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
      // Malformed line had seq=99 — must be absent from the surfaced ids.
      expect(ids.includes(99)).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        '[gen] skipped 1 malformed lines in events log',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('resume continues seq from where the previous run left off when ndjson is still present', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();

    // Run #1: drive a few events then bail with a non-success finish so
    // the .generation-state.json file persists for resume.
    const run1 = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    const init1 = await scripted.nextChild();
    init1.emitStdout('p\nq\nr\n');
    // Exit non-zero so the pipeline marks init failed and finalize keeps
    // the state file on disk for a later resume.
    init1.finishWithExit(1);
    await waitForFinish(run1);
    const seqAfterRun1 = run1.lastSeq;
    expect(seqAfterRun1).toBeGreaterThan(0);

    // Run #2: a real resume can't go through here because init failed —
    // but the AC's "resume continues incrementing from where the previous
    // run left off when the ndjson file is still present" applies to ANY
    // run launched on top of an existing ndjson via resumeGeneration.
    // Seed a state file by hand so resumeGeneration has something to read,
    // then verify the next emit's seq is seqAfterRun1 + 1.
    await fs.writeFile(
      path.join(coursesRoot, 'demo', '.generation-state.json'),
      JSON.stringify({
        schemaVersion: 1,
        slug: 'demo',
        startedAt: '2026-05-08T00:00:00.000Z',
        lastUpdatedAt: '2026-05-08T00:00:00.000Z',
        research: { status: 'done' },
      design: { status: 'done' },
        lessons: [],
        config: { lessonMaxRetries: 2, lessonTimeoutMs: 60_000 },
      }),
      'utf8',
    );
    // Run #2 has init.status='done' so no init child is spawned; the empty
    // lessons array means it finishes immediately with a 'done' event.
    const run2 = await resumeGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    await waitForFinish(run2);

    // First event of run #2 (the 'resumed' hydration event) must carry a
    // seq strictly greater than the last seq of run #1.
    expect(run2.eventSeqs[0]).toBe(seqAfterRun1 + 1);
    expect(run2.events[0].type).toBe('resumed');
  });
});

describe('isLessonAlreadyValid (US-139)', () => {
  it('returns missing when no lesson file is on disk', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const result = await isLessonAlreadyValid('demo', 'absent');
    expect(result).toEqual({ valid: false, reason: 'missing' });
  });

  it('returns parse-error on truncated json', async () => {
    const dir = path.join(coursesRoot, 'demo', 'lessons');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'broken.json'), '{"slug":"broken"', 'utf8');
    const result = await isLessonAlreadyValid('demo', 'broken');
    expect(result).toEqual({ valid: false, reason: 'parse-error' });
  });

  it('returns schema-error when required fields are missing', async () => {
    const dir = path.join(coursesRoot, 'demo', 'lessons');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'partial.json'),
      JSON.stringify({ slug: 'partial' }),
      'utf8',
    );
    const result = await isLessonAlreadyValid('demo', 'partial');
    expect(result).toEqual({ valid: false, reason: 'schema-error' });
  });

  it('returns valid + the parsed lesson on a healthy file', async () => {
    await writeStubLesson('demo', 'good');
    const result = await isLessonAlreadyValid('demo', 'good');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.lesson.slug).toBe('good');
      expect(result.lesson.sections.length).toBeGreaterThan(0);
    }
  });
});

describe('pre-skip when lesson is already valid (US-139)', () => {
  it('pre-placed valid lesson skips the spawn — only init children observed', async () => {
    await writeStubCourse('demo', ['lesson-a']);
    await writeStubResearchArtefacts('demo');
    await writeStubLesson('demo', 'lesson-a');

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    // Both init children run but don't need to write anything — the
    // artefacts (research.md, sources.md, course.json) all exist on disk
    // from the pre-placement above and the post-stage guards re-read them.
    await passInitStagesNoWrite(scripted);

    await waitForFinish(run);

    // Both init stages spawned; the per-lesson stage was satisfied by the
    // pre-existing valid file.
    expect(scripted.children.length).toBe(2);

    // Stage events: research + design + lesson:lesson-a (started + done).
    const stages = run.events.filter((e) => e.type === 'stage');
    expect(stages).toEqual([
      { type: 'stage', name: 'research_course', status: 'started' },
      { type: 'stage', name: 'research_course', status: 'done' },
      { type: 'stage', name: 'design_course', status: 'started' },
      { type: 'stage', name: 'design_course', status: 'done' },
      { type: 'stage', name: 'lesson:lesson-a', status: 'started' },
      { type: 'stage', name: 'lesson:lesson-a', status: 'done' },
    ]);

    // Progress reaches 1/1 and a `done` event closes the run cleanly.
    const progress = run.events.filter((e) => e.type === 'progress');
    expect(progress).toEqual([
      { type: 'progress', current: 0, total: 1 },
      { type: 'progress', current: 1, total: 1 },
    ]);
    const done = run.events.find((e) => e.type === 'done');
    expect(done).toEqual({ type: 'done', courseSlug: 'demo', failedLessons: [] });
  });

  it('truncated lesson JSON falls through to a normal spawn and is overwritten', async () => {
    await writeStubCourse('demo', ['lesson-a']);
    await writeStubResearchArtefacts('demo');
    const lessonsDir = path.join(coursesRoot, 'demo', 'lessons');
    await fs.mkdir(lessonsDir, { recursive: true });
    // Truncated mid-write — JSON.parse will throw → reason: 'parse-error'.
    await fs.writeFile(
      path.join(lessonsDir, 'lesson-a.json'),
      '{"slug":"lesson-a"',
      'utf8',
    );

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 0,
    });

    await passInitStagesNoWrite(scripted);

    // The bad file does NOT short-circuit the iteration — claude is invoked
    // for lesson-a and overwrites the file with valid output.
    const lessonChild = await scripted.nextChild();
    await writeStubLesson('demo', 'lesson-a');
    lessonChild.finishWithExit(0);

    await waitForFinish(run);

    // 2 init + 1 lesson respawn = 3 total.
    expect(scripted.children.length).toBe(3);

    // The bad truncated file was overwritten with the valid one.
    const raw = await fs.readFile(path.join(lessonsDir, 'lesson-a.json'), 'utf8');
    const parsed = JSON.parse(raw) as { slug: string; sections: unknown[] };
    expect(parsed.slug).toBe('lesson-a');
    expect(parsed.sections.length).toBeGreaterThan(0);
  });

  it('lesson JSON missing required fields falls through to a normal spawn', async () => {
    await writeStubCourse('demo', ['lesson-a']);
    await writeStubResearchArtefacts('demo');
    const lessonsDir = path.join(coursesRoot, 'demo', 'lessons');
    await fs.mkdir(lessonsDir, { recursive: true });
    // Valid JSON but LessonSchema.safeParse will fail (missing courseSlug,
    // moduleId, title, eyebrow, description, estimatedMinutes, sections).
    await fs.writeFile(
      path.join(lessonsDir, 'lesson-a.json'),
      JSON.stringify({ slug: 'lesson-a' }),
      'utf8',
    );

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 0,
    });

    await passInitStagesNoWrite(scripted);

    const lessonChild = await scripted.nextChild();
    await writeStubLesson('demo', 'lesson-a');
    lessonChild.finishWithExit(0);

    await waitForFinish(run);
    // 2 init + 1 lesson = 3 total.
    expect(scripted.children.length).toBe(3);
  });

  it('stale .tmp alongside valid .json: tmp removed and no spawn', async () => {
    await writeStubCourse('demo', ['lesson-a']);
    await writeStubResearchArtefacts('demo');
    await writeStubLesson('demo', 'lesson-a');
    const lessonsDir = path.join(coursesRoot, 'demo', 'lessons');
    await fs.writeFile(
      path.join(lessonsDir, 'lesson-a.tmp'),
      'partial garbage from a prior crash',
      'utf8',
    );

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    await passInitStagesNoWrite(scripted);

    await waitForFinish(run);

    // Only the 2 init children spawned — pre-existing valid .json wins.
    expect(scripted.children.length).toBe(2);
    // The stale .tmp is dropped regardless of validity.
    await expect(
      fs.access(path.join(lessonsDir, 'lesson-a.tmp')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    // The valid .json is untouched.
    await fs.access(path.join(lessonsDir, 'lesson-a.json'));
  });

  it('stale .tmp only (no .json): tmp removed and spawn proceeds', async () => {
    await writeStubCourse('demo', ['lesson-b']);
    await writeStubResearchArtefacts('demo');
    const lessonsDir = path.join(coursesRoot, 'demo', 'lessons');
    await fs.mkdir(lessonsDir, { recursive: true });
    await fs.writeFile(
      path.join(lessonsDir, 'lesson-b.tmp'),
      'partial garbage',
      'utf8',
    );

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    await passInitStagesNoWrite(scripted);

    // The unlink runs at the start of the iteration BEFORE the spawn — by the
    // time the lesson child exists on the test side, the stale .tmp must
    // already be gone.
    const lessonChild = await scripted.nextChild();
    await expect(
      fs.access(path.join(lessonsDir, 'lesson-b.tmp')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    await writeStubLesson('demo', 'lesson-b');
    lessonChild.finishWithExit(0);

    await waitForFinish(run);
    // 2 init + 1 lesson = 3 total.
    expect(scripted.children.length).toBe(3);
  });

  it('integration: 3-lesson course with lessons 1+3 valid pre-placed → only lesson 2 spawns, progress reaches 3/3', async () => {
    await writeStubCourse('demo', ['lesson1', 'lesson2', 'lesson3']);
    await writeStubResearchArtefacts('demo');
    await writeStubLesson('demo', 'lesson1');
    await writeStubLesson('demo', 'lesson3');

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    await passInitStagesNoWrite(scripted);

    // ONLY lesson2 spawns — lesson1 and lesson3 are pre-skipped via
    // isLessonAlreadyValid.
    const lesson2 = await scripted.nextChild();
    await writeStubLesson('demo', 'lesson2');
    lesson2.finishWithExit(0);

    await waitForFinish(run);

    // Spawn count: 2 init + 1 lesson 2 = 3 total children.
    expect(scripted.children.length).toBe(3);

    // Progress walks every lesson in order.
    const progress = run.events.filter((e) => e.type === 'progress');
    expect(progress).toEqual([
      { type: 'progress', current: 0, total: 3 },
      { type: 'progress', current: 1, total: 3 },
      { type: 'progress', current: 2, total: 3 },
      { type: 'progress', current: 3, total: 3 },
    ]);

    // Stage events: research + design + every lesson emits started+done in
    // order, regardless of whether the lesson was pre-skipped or spawned.
    const stages = run.events.filter((e) => e.type === 'stage');
    expect(stages).toEqual([
      { type: 'stage', name: 'research_course', status: 'started' },
      { type: 'stage', name: 'research_course', status: 'done' },
      { type: 'stage', name: 'design_course', status: 'started' },
      { type: 'stage', name: 'design_course', status: 'done' },
      { type: 'stage', name: 'lesson:lesson1', status: 'started' },
      { type: 'stage', name: 'lesson:lesson1', status: 'done' },
      { type: 'stage', name: 'lesson:lesson2', status: 'started' },
      { type: 'stage', name: 'lesson:lesson2', status: 'done' },
      { type: 'stage', name: 'lesson:lesson3', status: 'started' },
      { type: 'stage', name: 'lesson:lesson3', status: 'done' },
    ]);

    // Run finishes cleanly with no failed lessons.
    const done = run.events.find((e) => e.type === 'done');
    expect(done).toEqual({ type: 'done', courseSlug: 'demo', failedLessons: [] });
  });

  it('pre-skip path writes status=done + attempts=0 + finishedAt to .generation-state.json when state file exists', async () => {
    // 2-lesson course where the first lesson is pre-skipped and the second
    // fails — the failure keeps the state file on disk so we can assert the
    // skipped lesson's state was persisted as `done` with attempts=0.
    await writeStubCourse('demo', ['skip-me', 'fail-me']);
    await writeStubResearchArtefacts('demo');
    await writeStubLesson('demo', 'skip-me');

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonMaxRetries: 0, // single attempt for fail-me
    });

    await passInitStagesNoWrite(scripted);

    // fail-me spawns and exits non-zero so the state file persists.
    const failChild = await scripted.nextChild();
    failChild.emitStderr('boom\n');
    failChild.finishWithExit(1);

    await waitForFinish(run);

    const state = await readGenerationState('demo');
    expect(state).not.toBeNull();
    const skipMe = state!.lessons.find((l) => l.slug === 'skip-me');
    expect(skipMe).toBeDefined();
    expect(skipMe!.status).toBe('done');
    expect(skipMe!.attempts).toBe(0);
    expect(skipMe!.finishedAt).toMatch(/T/);
    expect(skipMe!.lastError).toBeUndefined();
  });
});

describe('coherence-pass final stage (US-141)', () => {
  it('defaultCoherencePassCommand names the coherence_pass skill in the prompt', () => {
    const spec = defaultCoherencePassCommand('demo');
    expect(spec.command).toBe('claude');
    // Two slugs are spliced via assertSafeSlug — same defence-in-depth as the
    // other command factories. The skill name and slug both appear in the
    // prompt body so the agent can locate the SKILL file and the course dir.
    const prompt = spec.args[1] ?? '';
    expect(prompt).toContain('coherence_pass');
    expect(prompt).toContain('coherence_pass.md');
    expect(prompt).toContain('"demo"');
    expect(prompt).toContain('/courses/demo/');
    // The flag is still required for unattended execution.
    expect(spec.args).toContain('--dangerously-skip-permissions');
    // Critically — NO --output-format stream-json, because the skill emits
    // raw markdown that we capture verbatim.
    expect(spec.args).not.toContain('stream-json');
  });

  it('runs coherence-pass after every lesson stage and writes the report from stdout', async () => {
    // Pre-place a 3-lesson course with all lessons valid so the per-lesson
    // loop pre-skips every spawn (US-139) and the only post-init children
    // are the two init stages plus the coherence-pass spawn.
    await writeStubCourse('demo', ['lesson1', 'lesson2', 'lesson3']);
    await writeStubResearchArtefacts('demo');
    await writeStubLesson('demo', 'lesson1');
    await writeStubLesson('demo', 'lesson2');
    await writeStubLesson('demo', 'lesson3');

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      // Opt back in to the coherence stage — the suite-wide default is
      // disabled (see beforeEach).
      disableCoherencePass: false,
    });

    // Both init children run but don't need to write anything — the
    // artefacts already exist on disk from the pre-placement above.
    await passInitStagesNoWrite(scripted);

    // No per-lesson children — all three lessons pre-skipped via US-139.
    // The very next spawn must be the coherence-pass child.
    const coherence = await scripted.nextChild();
    expect(coherence.command).toBe('claude');
    const args = coherence.args.join(' ');
    expect(args).toContain('coherence_pass');
    expect(args).toContain('coherence_pass.md');
    // Stream-json must NOT be passed to coherence-pass (we capture raw markdown).
    expect(args).not.toContain('stream-json');

    const reportMarkdown =
      '## Prerequisite Order\n\nNo issues found.\n\n' +
      '## Redundancy\n\nNo issues found.\n\n' +
      '## Notation Consistency\n\nNo issues found.\n';
    coherence.emitStdout(reportMarkdown);
    coherence.finishWithExit(0);

    await waitForFinish(run);

    // Spawn count: 2 init + 1 coherence (no per-lesson children).
    expect(scripted.children.length).toBe(3);

    // The on-disk report is the captured stdout, byte-for-byte.
    const reportPath = path.join(coursesRoot, 'demo', 'coherence-report.md');
    const written = await fs.readFile(reportPath, 'utf8');
    expect(written).toBe(reportMarkdown);

    // stage:done for coherence-pass appears AFTER every lesson:* done event.
    const stages = run.events.filter((e) => e.type === 'stage') as Array<{
      type: 'stage';
      name: string;
      status: 'started' | 'done' | 'error';
    }>;
    const coherenceDoneIdx = stages.findIndex(
      (s) => s.name === 'coherence-pass' && s.status === 'done',
    );
    const lastLessonStageIdx = stages
      .map((s, i) => (s.name.startsWith('lesson:') ? i : -1))
      .filter((i) => i >= 0)
      .pop();
    expect(coherenceDoneIdx).toBeGreaterThan(-1);
    expect(lastLessonStageIdx).toBeGreaterThan(-1);
    expect(coherenceDoneIdx).toBeGreaterThan(lastLessonStageIdx!);

    // Stage events end with started + done for coherence-pass.
    expect(stages.at(-2)).toEqual({
      type: 'stage',
      name: 'coherence-pass',
      status: 'started',
    });
    expect(stages.at(-1)).toEqual({
      type: 'stage',
      name: 'coherence-pass',
      status: 'done',
    });

    // The completion summary surfaces the relative report path.
    const done = run.events.find((e) => e.type === 'done') as
      | { type: 'done'; courseSlug: string; failedLessons: FailedLesson[]; coherenceReportPath?: string }
      | undefined;
    expect(done).toBeDefined();
    expect(done?.coherenceReportPath).toBe('coherence-report.md');
    expect(done?.failedLessons).toEqual([]);
  });

  it('coherence-pass spawn returning non-zero emits stage:error and leaves no report on disk', async () => {
    await writeStubCourse('demo', ['lesson1', 'lesson2', 'lesson3']);
    await writeStubResearchArtefacts('demo');
    await writeStubLesson('demo', 'lesson1');
    await writeStubLesson('demo', 'lesson2');
    await writeStubLesson('demo', 'lesson3');

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      disableCoherencePass: false,
    });

    await passInitStagesNoWrite(scripted);

    const coherence = await scripted.nextChild();
    coherence.emitStderr('boom\n');
    coherence.finishWithExit(1);

    await waitForFinish(run);

    // Course generation still completes — no error event, all lessons remain.
    expect(run.events.find((e) => e.type === 'error')).toBeUndefined();
    const done = run.events.find((e) => e.type === 'done') as
      | { type: 'done'; courseSlug: string; failedLessons: FailedLesson[]; coherenceReportPath?: string }
      | undefined;
    expect(done).toBeDefined();
    expect(done?.failedLessons).toEqual([]);
    // Field is absent on failure — only the SSE event log surfaces the failure.
    expect(done?.coherenceReportPath).toBeUndefined();

    // Existing lesson files are untouched.
    for (const slug of ['lesson1', 'lesson2', 'lesson3']) {
      await fs.access(path.join(coursesRoot, 'demo', 'lessons', `${slug}.json`));
    }

    // Stage:error emitted for coherence-pass.
    const stages = run.events.filter((e) => e.type === 'stage');
    expect(stages).toContainEqual({
      type: 'stage',
      name: 'coherence-pass',
      status: 'started',
    });
    expect(stages).toContainEqual({
      type: 'stage',
      name: 'coherence-pass',
      status: 'error',
    });

    // No report on disk.
    await expect(
      fs.access(path.join(coursesRoot, 'demo', 'coherence-report.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('coherence-pass is skipped when any per-lesson stage fails', async () => {
    // 2-lesson course where the second lesson fails; coherence-pass would
    // produce a misleading audit on partial coverage and the AC requires it
    // skip in that case.
    await writeStubCourse('demo', ['ok-lesson', 'bad-lesson']);
    await writeStubResearchArtefacts('demo');
    await writeStubLesson('demo', 'ok-lesson');

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      disableCoherencePass: false,
      lessonMaxRetries: 0,
    });

    await passInitStagesNoWrite(scripted);

    // ok-lesson is pre-skipped (US-139). bad-lesson spawns and exits non-zero.
    const bad = await scripted.nextChild();
    bad.emitStderr('boom\n');
    bad.finishWithExit(2);

    await waitForFinish(run);

    // No coherence-pass child was spawned — only 2 init + bad-lesson.
    expect(scripted.children.length).toBe(3);

    const stages = run.events.filter((e) => e.type === 'stage');
    expect(stages).not.toContainEqual({
      type: 'stage',
      name: 'coherence-pass',
      status: 'started',
    });

    // The done event still reports the failed lesson but has no
    // coherenceReportPath since the stage was skipped.
    const done = run.events.find((e) => e.type === 'done') as
      | { type: 'done'; courseSlug: string; failedLessons: FailedLesson[]; coherenceReportPath?: string }
      | undefined;
    expect(done).toBeDefined();
    expect(done?.coherenceReportPath).toBeUndefined();
    expect(done?.failedLessons.map((f) => f.slug)).toEqual(['bad-lesson']);
  });

  it('coherence-pass writes a placeholder when RALPH_TASK_ID is set and the spawn times out', async () => {
    await writeStubCourse('demo', ['lesson1']);
    await writeStubResearchArtefacts('demo');
    await writeStubLesson('demo', 'lesson1');

    process.env.RALPH_TASK_ID = 'US-TEST';
    try {
      const scripted = makeScriptedSpawn();
      const run = await startGeneration('demo', {
        spawn: scripted.spawn,
        isExecutableInPath: () => true,
        disableCoherencePass: false,
        // Trip the RALPH-mode timeout in 1ms instead of 30s so the test
        // doesn't have to wait wall-clock. The 1ms sigkill grace is the
        // SIGTERM → SIGKILL escalation; FakeChildProcess#kill on SIGKILL
        // calls finishWithExit(137) so the wrapper resolves with
        // timedOut=true.
        coherencePassTimeoutMs: 1,
        sigkillGraceMs: 1,
      });

      await passInitStagesNoWrite(scripted);

      // The coherence child is captured but NEVER calls finishWithExit on
      // its own — the wrapper's attemptTimer must fire and SIGTERM/SIGKILL
      // it. FakeChildProcess.kill('SIGKILL') triggers finishWithExit(137).
      await scripted.nextChild();

      // Give the timeout cascade (1ms attemptTimer → SIGTERM → 1ms
      // killTimer → SIGKILL → close) plenty of slack to fire.
      await new Promise((r) => setTimeout(r, 50));
      await waitForFinish(run);

      // The placeholder text was written verbatim to coherence-report.md.
      const reportPath = path.join(coursesRoot, 'demo', 'coherence-report.md');
      const written = await fs.readFile(reportPath, 'utf8');
      expect(written).toBe('Coherence pass timed out — re-run generation to retry.\n');

      // Stage:error was emitted (we don't promote a timed-out report to
      // stage:done — the placeholder is a fallback, not real output).
      const stages = run.events.filter((e) => e.type === 'stage');
      expect(stages).toContainEqual({
        type: 'stage',
        name: 'coherence-pass',
        status: 'error',
      });

      // Field is absent on completion summary — only the SSE event log
      // surfaces the timeout.
      const done = run.events.find((e) => e.type === 'done') as
        | { type: 'done'; coherenceReportPath?: string }
        | undefined;
      expect(done).toBeDefined();
      expect(done?.coherenceReportPath).toBeUndefined();
    } finally {
      delete process.env.RALPH_TASK_ID;
    }
  });
});

// ── US-157: TTS post-processing ──────────────────────────────────────────────
// Mock generate_lesson spawn → returns a lesson with one AudioPlayer
// (audioPath: AUTO_TTS, audioSourceText: 'hello world') and one
// transcript-cloze. Mock the internal TTS callable to write a stub .wav file
// and return its path. Run startGenerationInner end-to-end. Assert: lesson.json
// on disk has real audioPaths (no AUTO_TTS), .wav files exist at expected
// paths, .meta.json sidecars exist with contentHashes. Re-run with same source
// text → assert TTS callable is NOT invoked (cache hit), files unchanged.
// Modify source text → assert TTS callable IS invoked, files updated, hash
// updated.

describe('TTS post-processing (US-157)', () => {
  /** Build a minimal valid WAV header + N bytes of silence. */
  function fakeWav(dataBytes: number): Buffer {
    const sampleRate = 16000;
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * channels * bitsPerSample) / 8;
    const blockAlign = (channels * bitsPerSample) / 8;
    const buf = Buffer.alloc(44 + dataBytes);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataBytes, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(channels, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(byteRate, 28);
    buf.writeUInt16LE(blockAlign, 32);
    buf.writeUInt16LE(bitsPerSample, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(dataBytes, 40);
    return buf;
  }

  /**
   * Write a `<lessonSlug>.json` to disk under coursesRoot/<slug>/lessons/
   * containing one AudioPlayer + one transcriptCloze section, both with the
   * AUTO_TTS sentinel and (for AudioPlayer) an audioSourceText. Used by the
   * lesson-spawn stub which emulates what generate_lesson would write.
   */
  async function writeAutoTtsLesson(
    slug: string,
    lessonSlug: string,
    opts: { audioSourceText?: string; transcript?: string } = {},
  ) {
    const dir = path.join(coursesRoot, slug, 'lessons');
    await fs.mkdir(dir, { recursive: true });
    const audioSourceText = opts.audioSourceText ?? 'hello world';
    const transcript =
      opts.transcript ?? 'The quick brown fox jumps over the lazy dog.';
    const lesson = {
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
        {
          id: 's-audio',
          title: 'Listen',
          type: 'audioPlayer',
          data: {
            audioPath: 'AUTO_TTS',
            audioSourceText,
            title: 'Spoken passage',
          },
        },
        {
          id: 's-cloze',
          title: 'Fill the blanks',
          type: 'transcriptCloze',
          data: {
            audioPath: 'AUTO_TTS',
            transcript,
            blanks: [
              { wordIndex: 1, answer: 'quick' },
              { wordIndex: 5, answer: 'over' },
            ],
          },
        },
      ],
    };
    await fs.writeFile(
      path.join(dir, `${lessonSlug}.json`),
      JSON.stringify(lesson),
      'utf8',
    );
  }

  /** A TTS stub that records every invocation and writes a fresh fake WAV
   * into a per-call file under a temp dir, returning the absolute path. */
  function makeTtsStub() {
    const calls: { text: string; voice: string }[] = [];
    let counter = 0;
    const stub = async (input: { text: string; voice: string }) => {
      calls.push({ text: input.text, voice: input.voice });
      counter += 1;
      const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'ai-tts-stub-'));
      const out = path.join(tmpDir, `stub-${counter}.wav`);
      await fs.writeFile(out, fakeWav(32000));
      return {
        audioPath: `tts-cache/stub-${counter}.wav`,
        absolutePath: out,
        durationMs: 1000,
        cached: false,
      };
    };
    return { calls, stub };
  }

  function sha256(s: string): string {
    return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  }

  it('replaces AUTO_TTS sentinels with real paths, writes wav + meta sidecar, emits tts events', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const { calls, stub } = makeTtsStub();

    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      runTts: stub,
    });

    await runInitStages(scripted, 'demo', ['lesson1']);

    const lesson = await scripted.nextChild();
    await writeAutoTtsLesson('demo', 'lesson1', {
      audioSourceText: 'hello world',
    });
    lesson.finishWithExit(0);

    await waitForFinish(run);

    // No failed lessons.
    const done = run.events.find((e) => e.type === 'done') as
      | { type: 'done'; failedLessons: FailedLesson[] }
      | undefined;
    expect(done).toBeDefined();
    expect(done?.failedLessons).toEqual([]);

    // TTS callable invoked twice (once per audio section).
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.text)).toContain('hello world');
    expect(calls.map((c) => c.text)).toContain(
      'The quick brown fox jumps over the lazy dog.',
    );

    // Lesson on disk has real paths and no AUTO_TTS.
    const writtenRaw = await fs.readFile(
      path.join(coursesRoot, 'demo', 'lessons', 'lesson1.json'),
      'utf8',
    );
    const written = JSON.parse(writtenRaw);
    const audioSec = written.sections.find((s: { id: string }) => s.id === 's-audio');
    const clozeSec = written.sections.find((s: { id: string }) => s.id === 's-cloze');
    expect(audioSec.data.audioPath).toBe('assets/audio/lesson1-s-audio.wav');
    expect(clozeSec.data.audioPath).toBe('assets/audio/lesson1-s-cloze.wav');
    // audioSourceText stripped.
    expect(audioSec.data).not.toHaveProperty('audioSourceText');

    // Wav files exist at expected paths.
    const audioWav = path.join(
      coursesRoot,
      'demo',
      'assets',
      'audio',
      'lesson1-s-audio.wav',
    );
    const clozeWav = path.join(
      coursesRoot,
      'demo',
      'assets',
      'audio',
      'lesson1-s-cloze.wav',
    );
    await expect(fs.stat(audioWav)).resolves.toBeTruthy();
    await expect(fs.stat(clozeWav)).resolves.toBeTruthy();

    // Sidecars exist with contentHashes that match a sha256 of the source text.
    const audioMeta = JSON.parse(
      await fs.readFile(`${audioWav}.meta.json`, 'utf8'),
    );
    const clozeMeta = JSON.parse(
      await fs.readFile(`${clozeWav}.meta.json`, 'utf8'),
    );
    expect(audioMeta.contentHash).toBe(sha256('hello world'));
    expect(clozeMeta.contentHash).toBe(
      sha256('The quick brown fox jumps over the lazy dog.'),
    );

    // tts events emitted in started/done pairs.
    const ttsEvents = run.events.filter((e) => e.type === 'tts') as Array<{
      type: 'tts';
      lessonSlug: string;
      sectionId: string;
      status: 'started' | 'done' | 'failed';
    }>;
    expect(ttsEvents.map((e) => `${e.sectionId}:${e.status}`)).toEqual([
      's-audio:started',
      's-audio:done',
      's-cloze:started',
      's-cloze:done',
    ]);
    expect(ttsEvents.every((e) => e.lessonSlug === 'lesson1')).toBe(true);
  });

  it('skips TTS when sidecar contentHash matches; re-invokes TTS when source text changes', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });

    // ── Run #1: cold cache, both sections synthesise ────────────────────────
    {
      const scripted = makeScriptedSpawn();
      const { calls, stub } = makeTtsStub();

      const run = await startGeneration('demo', {
        spawn: scripted.spawn,
        isExecutableInPath: () => true,
        runTts: stub,
      });

      await runInitStages(scripted, 'demo', ['lesson1']);

      const lesson = await scripted.nextChild();
      await writeAutoTtsLesson('demo', 'lesson1', { audioSourceText: 'hello world' });
      lesson.finishWithExit(0);

      await waitForFinish(run);
      expect(calls).toHaveLength(2);
    }

    // Capture the wav + meta mtimes after run #1 so we can prove run #2 left
    // them untouched.
    const audioWav = path.join(
      coursesRoot,
      'demo',
      'assets',
      'audio',
      'lesson1-s-audio.wav',
    );
    const clozeWav = path.join(
      coursesRoot,
      'demo',
      'assets',
      'audio',
      'lesson1-s-cloze.wav',
    );
    const audioStat1 = await fs.stat(audioWav);
    const clozeStat1 = await fs.stat(clozeWav);

    // ── Run #2: same source text → cache hit, TTS NOT invoked ───────────────
    {
      __resetForTesting();
      // Re-set the queue override (cleared by __resetForTesting) so the second
      // run's queue file lives under the same coursesRoot.
      process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(
        coursesRoot,
        'generation-queue.json',
      );
      __setCoherencePassDisabledByDefault(true);

      // Wipe lesson file so the spawn re-runs (the validity guard would
      // otherwise skip the lesson stage entirely on a re-run).
      try {
        await fs.unlink(path.join(coursesRoot, 'demo', 'lessons', 'lesson1.json'));
      } catch {
        /* fresh worktree — ignore */
      }

      const scripted = makeScriptedSpawn();
      const { calls, stub } = makeTtsStub();

      const run = await startGeneration('demo', {
        spawn: scripted.spawn,
        isExecutableInPath: () => true,
        runTts: stub,
      });

      // course.json + research/sources already exist from run #1; both
      // init children just exit 0 and the post-stage guards pass against
      // the existing files.
      await passInitStagesNoWrite(scripted);

      const lesson = await scripted.nextChild();
      await writeAutoTtsLesson('demo', 'lesson1', { audioSourceText: 'hello world' });
      lesson.finishWithExit(0);

      await waitForFinish(run);

      // No TTS calls — the meta-sidecar hash matched.
      expect(calls).toHaveLength(0);

      // Wav files unchanged.
      const audioStat2 = await fs.stat(audioWav);
      const clozeStat2 = await fs.stat(clozeWav);
      expect(audioStat2.mtimeMs).toBe(audioStat1.mtimeMs);
      expect(clozeStat2.mtimeMs).toBe(clozeStat1.mtimeMs);
    }

    // ── Run #3: different audioSourceText → TTS invoked for that section ───
    {
      __resetForTesting();
      process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(
        coursesRoot,
        'generation-queue.json',
      );
      __setCoherencePassDisabledByDefault(true);
      try {
        await fs.unlink(path.join(coursesRoot, 'demo', 'lessons', 'lesson1.json'));
      } catch {
        /* ignore */
      }

      const scripted = makeScriptedSpawn();
      const { calls, stub } = makeTtsStub();

      const run = await startGeneration('demo', {
        spawn: scripted.spawn,
        isExecutableInPath: () => true,
        runTts: stub,
      });

      await passInitStagesNoWrite(scripted);

      const lesson = await scripted.nextChild();
      await writeAutoTtsLesson('demo', 'lesson1', {
        audioSourceText: 'goodbye world', // changed
      });
      lesson.finishWithExit(0);

      await waitForFinish(run);

      // Only the AudioPlayer section's text changed → exactly one TTS call.
      expect(calls).toHaveLength(1);
      expect(calls[0].text).toBe('goodbye world');

      // The audio wav was overwritten; the cloze wav was not.
      const audioStat3 = await fs.stat(audioWav);
      const clozeStat3 = await fs.stat(clozeWav);
      expect(audioStat3.mtimeMs).not.toBe(audioStat1.mtimeMs);
      expect(clozeStat3.mtimeMs).toBe(clozeStat1.mtimeMs);

      // Sidecar hash for the AudioPlayer section bumped.
      const audioMeta = JSON.parse(
        await fs.readFile(`${audioWav}.meta.json`, 'utf8'),
      );
      expect(audioMeta.contentHash).toBe(sha256('goodbye world'));
    }
  });

  it('marks the lesson failed when the TTS callable throws — no AUTO_TTS placeholder lands on disk', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const failingStub = async () => {
      throw new Error('TTS engine missing — install scripts/setup-tts.sh');
    };

    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      runTts: failingStub,
      lessonMaxRetries: 0, // single attempt — surface the failure immediately
    });

    await runInitStages(scripted, 'demo', ['lesson1']);

    const lesson = await scripted.nextChild();
    await writeAutoTtsLesson('demo', 'lesson1', { audioSourceText: 'hello world' });
    lesson.finishWithExit(0);

    await waitForFinish(run);

    // Lesson file is NOT on disk (the partial AUTO_TTS placeholder was
    // unlinked by the post-processor on TTS failure).
    await expect(
      fs.access(path.join(coursesRoot, 'demo', 'lessons', 'lesson1.json')),
    ).rejects.toBeTruthy();

    // With only one lesson and that lesson failing, the pipeline finalises
    // with an `error` event (not `done`) and surfaces failedLessons on it.
    const errorEv = run.events.find((e) => e.type === 'error') as
      | { type: 'error'; message: string; failedLessons?: FailedLesson[] }
      | undefined;
    expect(errorEv).toBeDefined();
    expect(errorEv?.failedLessons).toHaveLength(1);
    expect(errorEv?.failedLessons?.[0].slug).toBe('lesson1');
    expect(errorEv?.failedLessons?.[0].reason).toMatch(/TTS engine missing/);

    // tts:failed event emitted with the engine error.
    const ttsFail = run.events.find(
      (e) => e.type === 'tts' && e.status === 'failed',
    ) as
      | {
          type: 'tts';
          lessonSlug: string;
          sectionId: string;
          status: 'failed';
          errorMessage?: string;
        }
      | undefined;
    expect(ttsFail).toBeDefined();
    expect(ttsFail?.lessonSlug).toBe('lesson1');
    expect(ttsFail?.errorMessage).toMatch(/TTS engine missing/);
  });
});
