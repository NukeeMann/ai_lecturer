// Server-only module that owns the (single) running course-generation
// subprocess and exposes its output as a stream of structured events.
//
// Pipeline: a natural-language brief that points `claude -p` at the
// init_course skill, then ONE `claude -p` per lesson driven directly from
// course.json — no ralph.sh, no worktrees, no branches, no git push. Both
// stages run with stdout+stderr captured to the run's event log AND tee'd to
// `/courses/<slug>/.generation.log`. Concurrency is gated to 1.

import {
  spawn as defaultSpawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { promises as fs, createWriteStream, type WriteStream } from 'node:fs';
import path from 'node:path';
import { CourseSchema } from '@/lib/schemas/course';
import { LessonSchema } from '@/lib/schemas/lesson';
import { assertSafeSlug, courseDir, courseFile, lessonFile } from './paths';

export interface FailedLesson {
  slug: string;
  reason: string;
}

export type GenerationEvent =
  | { type: 'log'; line: string }
  | { type: 'stage'; name: string; status: 'started' | 'done' | 'error' }
  | { type: 'progress'; current: number; total: number }
  | { type: 'done'; courseSlug: string; failedLessons: FailedLesson[] }
  | { type: 'error'; message: string; failedLessons?: FailedLesson[] };

export type GenerationListener = (event: GenerationEvent) => void;

export interface GenerationRun {
  id: string;
  slug: string;
  events: GenerationEvent[];
  finished: boolean;
  subscribe: (listener: GenerationListener) => () => void;
  cancel: () => Promise<void>;
}

export interface SpawnDeps {
  spawn?: typeof defaultSpawn;
  isExecutableInPath?: (cmd: string) => boolean;
  initCourseCommand?: (slug: string) => { command: string; args: string[] };
  lessonCommand?: (slug: string, lessonSlug: string) => { command: string; args: string[] };
  cwd?: string;
  sigkillGraceMs?: number;
}

export class GenerationConflictError extends Error {
  constructor() {
    super('A generation is already running');
    this.name = 'GenerationConflictError';
  }
}

export class ClaudeUnavailableError extends Error {
  constructor() {
    super('Install Claude Code CLI or sign in to Claude Max');
    this.name = 'ClaudeUnavailableError';
  }
}

let activeRun: GenerationRun | null = null;
const runsById = new Map<string, GenerationRun>();
let depsOverride: SpawnDeps | null = null;

export function getActiveRun(): GenerationRun | null {
  return activeRun;
}

export function getRunById(id: string): GenerationRun | undefined {
  return runsById.get(id);
}

/** Test-only: replace global spawn deps for the next startGeneration calls. */
export function __setSpawnDepsForTesting(deps: SpawnDeps | null): void {
  depsOverride = deps;
}

/** Test-only: drop all bookkeeping and force-kill any active child. */
export function __resetForTesting(): void {
  if (activeRun && !activeRun.finished) {
    activeRun.finished = true;
  }
  activeRun = null;
  runsById.clear();
  depsOverride = null;
}

function defaultIsExecutableInPath(cmd: string): boolean {
  try {
    const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      stdio: 'ignore',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function defaultInitCourseCommand(slug: string): { command: string; args: string[] } {
  // Defence-in-depth: callers (the route + courseDir) already assert this, but
  // we re-check here so the slug we splice into the prompt cannot escape.
  assertSafeSlug(slug);
  // Test-only escape hatches for the playwright browser test:
  //   GENERATION_MOCK=broken           — every run emulates the pre-fix bug
  //   GENERATION_MOCK=1 + slug starts with `broken-` — same, but per-slug so a
  //                                        single dev server can drive BOTH
  //                                        the broken and the happy scenario
  //                                        in one playwright run.
  // The broken stub prints 'Unknown command: /init_course' and exits 0 without
  // ever writing course.json — exactly what `claude -p '/init_course <slug>'`
  // did before the fix, so the post-init guard can be exercised end-to-end.
  if (
    process.env.GENERATION_MOCK === 'broken' ||
    (process.env.GENERATION_MOCK === '1' && slug.startsWith('broken-'))
  ) {
    const script = `
console.log('Unknown command: /init_course');
process.exit(0);
`;
    return { command: process.execPath, args: ['-e', script] };
  }
  if (process.env.GENERATION_MOCK === '1') {
    // Test-only fast path that writes a valid stub course.json (lessons live
    // in their own per-lesson mock — see defaultLessonCommand). Lets the
    // playwright browser test exercise the full Stage-5-streaming →
    // redirect-to-/courses/<slug> flow without depending on a real `claude`
    // CLI being on PATH.
    const courseJson = {
      schemaVersion: 1,
      slug,
      title: 'Mock Course',
      description: 'Auto-generated by GENERATION_MOCK=1',
      accentColor: 'indigo',
      icon: 'sigma',
      modules: [
        {
          id: 'm1',
          title: 'Module 1',
          summary: 'Stub module',
          lessons: [{ slug: 'intro', title: 'Intro', estimatedMinutes: 5 }],
        },
      ],
      createdAt: '2026-05-04T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:00.000Z',
    };
    const script = `
const fs = require('fs');
const path = require('path');
const root = process.env.COURSES_ROOT_OVERRIDE || path.join(process.cwd(), 'courses');
const dir = path.join(root, ${JSON.stringify(slug)});
fs.mkdirSync(path.join(dir, 'lessons'), { recursive: true });
console.log('[mock init_course] researching topic...');
setTimeout(() => {
  console.log('[mock init_course] writing course.json');
  fs.writeFileSync(path.join(dir, 'course.json'), ${JSON.stringify(JSON.stringify(courseJson, null, 2))});
  console.log('[mock init_course] done');
}, 200);
`;
    return { command: process.execPath, args: ['-e', script] };
  }
  // Natural-language brief instead of a `/init_course` slash command. claude's
  // print mode (`-p`) treats slash commands as literal prompt text and just
  // prints "Unknown command:" before exiting 0 — we have to name the skill in
  // prose and point the agent at its SKILL.md so it actually runs the steps.
  // Mirrors the pattern in scripts/ralph/ralph.sh:612 / :1053. The slug is
  // safe to splice (assertSafeSlug above limits it to [A-Za-z0-9-_]) and is
  // passed as an argv element, never via a shell.
  const prompt =
    `Run the init_course skill defined in scripts/ralph/skills/init_course/SKILL.md. ` +
    `Argument: slug = "${slug}". ` +
    `Read that SKILL.md and execute its steps end-to-end against /courses/${slug}/course-spec.json: ` +
    `do the research pass (write /courses/${slug}/research.md and /courses/${slug}/sources.md), ` +
    `do the architect pass (write /courses/${slug}/course.json validated against CourseSchema). ` +
    `Do not generate lesson content here — the webapp's generation backend will invoke generate_lesson once per lesson after this step. ` +
    `Do NOT touch scripts/ralph/.`;
  return {
    command: 'claude',
    args: ['-p', prompt, '--dangerously-skip-permissions'],
  };
}

export function defaultLessonCommand(
  slug: string,
  lessonSlug: string,
): { command: string; args: string[] } {
  // Defence-in-depth: same rule as the slug — re-validate before we splice
  // either value into the prompt or a shell argv.
  assertSafeSlug(slug);
  assertSafeSlug(lessonSlug);
  if (process.env.GENERATION_MOCK === '1') {
    // Mirror the init mock: write a valid stub lesson JSON the post-spawn
    // LessonSchema validation will accept, plus a couple of log lines so the
    // SSE log panel has something to show.
    const lessonJson = {
      schemaVersion: 1,
      slug: lessonSlug,
      courseSlug: slug,
      moduleId: 'm1',
      title: lessonSlug
        .split('-')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' '),
      eyebrow: 'MOCK',
      description: 'Stub lesson generated by GENERATION_MOCK=1.',
      estimatedMinutes: 5,
      sections: [
        {
          id: 's1',
          title: 'Read',
          type: 'theory',
          data: { markdown: 'Hello from the mock lesson generator.' },
        },
      ],
    };
    const script = `
const fs = require('fs');
const path = require('path');
const root = process.env.COURSES_ROOT_OVERRIDE || path.join(process.cwd(), 'courses');
const dir = path.join(root, ${JSON.stringify(slug)}, 'lessons');
fs.mkdirSync(dir, { recursive: true });
console.log('[mock generate_lesson] writing ${lessonSlug}.json');
fs.writeFileSync(path.join(dir, ${JSON.stringify(`${lessonSlug}.json`)}), ${JSON.stringify(JSON.stringify(lessonJson, null, 2))});
console.log('[mock generate_lesson] done ${lessonSlug}');
`;
    return { command: process.execPath, args: ['-e', script] };
  }
  // Natural-language brief that names the generate_lesson skill and points
  // the agent at its SKILL.md. The two slugs are passed through the prompt
  // body (after assertSafeSlug above limits each to [A-Za-z0-9-_], which
  // makes them safe to splice) and `claude -p` runs in --dangerously-skip-
  // permissions mode so the agent can write the lesson file unattended.
  const prompt =
    `Run the generate_lesson skill defined in scripts/ralph/skills/generate_lesson/SKILL.md. ` +
    `Arguments: slug = "${slug}", lesson-slug = "${lessonSlug}". ` +
    `Read that SKILL.md and execute its steps end-to-end against /courses/${slug}/course.json, ` +
    `/courses/${slug}/research.md, and /courses/${slug}/sources.md to author exactly one lesson at ` +
    `/courses/${slug}/lessons/${lessonSlug}.json. The file MUST validate against LessonSchema in src/lib/schemas/lesson.ts. ` +
    `Do NOT touch scripts/ralph/. Do NOT modify course.json or any other lesson file. One call, one lesson.`;
  return {
    command: 'claude',
    args: ['-p', prompt, '--dangerously-skip-permissions'],
  };
}

function makeRunId(): string {
  return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface ChildSpec {
  command: string;
  args: string[];
}

export async function startGeneration(slug: string, depsArg: SpawnDeps = {}): Promise<GenerationRun> {
  const deps: SpawnDeps = { ...(depsOverride ?? {}), ...depsArg };

  if (activeRun && !activeRun.finished) {
    throw new GenerationConflictError();
  }

  const isExecutable = deps.isExecutableInPath ?? defaultIsExecutableInPath;
  if (!isExecutable('claude')) {
    throw new ClaudeUnavailableError();
  }

  const spawnFn = deps.spawn ?? defaultSpawn;
  const initSpec = (deps.initCourseCommand ?? defaultInitCourseCommand)(slug);
  const lessonCommand = deps.lessonCommand ?? defaultLessonCommand;
  const cwd = deps.cwd ?? process.cwd();
  const sigkillGraceMs = deps.sigkillGraceMs ?? 5000;

  const dir = courseDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const logPath = path.join(dir, '.generation.log');
  const logStream: WriteStream = createWriteStream(logPath, { flags: 'w' });
  let logStreamClosed = false;
  // Swallow late "write after end" errors that can fire when a child's stdout
  // flushes one more chunk after we've already finalised the run.
  logStream.on('error', () => {
    /* no-op */
  });

  const id = makeRunId();
  const events: GenerationEvent[] = [];
  const listeners = new Set<GenerationListener>();
  let cancelled = false;
  let currentChild: ChildProcess | null = null;
  let killTimer: NodeJS.Timeout | null = null;

  const run: GenerationRun = {
    id,
    slug,
    events,
    finished: false,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async cancel() {
      if (run.finished) return;
      cancelled = true;
      const child = currentChild;
      if (!child || child.exitCode !== null) return;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      if (!killTimer) {
        killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }, sigkillGraceMs);
        // Don't keep the event loop alive just for the kill timer.
        if (typeof killTimer.unref === 'function') killTimer.unref();
      }
    },
  };

  function emit(event: GenerationEvent) {
    events.push(event);
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        /* listeners are isolated */
      }
    }
  }

  function pumpStream(child: ChildProcess) {
    let stdoutBuf = '';
    let stderrBuf = '';

    const flushLine = (line: string) => {
      if (line.length === 0 && !stdoutBuf && !stderrBuf) return;
      if (!logStreamClosed) {
        try {
          logStream.write(`${line}\n`);
        } catch {
          /* log file already closed — fall through */
        }
      }
      emit({ type: 'log', line });
    };

    const pump = (which: 'out' | 'err') => (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (which === 'out') {
        stdoutBuf += text;
        let idx;
        while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
          const line = stdoutBuf.slice(0, idx).replace(/\r$/, '');
          stdoutBuf = stdoutBuf.slice(idx + 1);
          flushLine(line);
        }
      } else {
        stderrBuf += text;
        let idx;
        while ((idx = stderrBuf.indexOf('\n')) !== -1) {
          const line = stderrBuf.slice(0, idx).replace(/\r$/, '');
          stderrBuf = stderrBuf.slice(idx + 1);
          flushLine(line);
        }
      }
    };

    child.stdout?.on('data', pump('out'));
    child.stderr?.on('data', pump('err'));
    child.once('close', () => {
      // Flush partial trailing lines so nothing is dropped on exit.
      if (stdoutBuf.length > 0) {
        flushLine(stdoutBuf.replace(/\r$/, ''));
        stdoutBuf = '';
      }
      if (stderrBuf.length > 0) {
        flushLine(stderrBuf.replace(/\r$/, ''));
        stderrBuf = '';
      }
    });
  }

  function spawnStage(name: string, spec: ChildSpec): Promise<{ exit: number }> {
    return new Promise((resolve) => {
      emit({ type: 'stage', name, status: 'started' });
      const opts: SpawnOptions = {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      };
      let child: ChildProcess;
      try {
        child = spawnFn(spec.command, spec.args, opts);
      } catch (err) {
        emit({ type: 'log', line: `spawn failed for ${spec.command}: ${(err as Error).message}` });
        resolve({ exit: -1 });
        return;
      }
      currentChild = child;
      pumpStream(child);
      let exitCode: number | null = null;
      child.once('error', (err) => {
        emit({ type: 'log', line: `${name} error: ${err.message}` });
      });
      child.once('exit', (code) => {
        exitCode = code;
      });
      // Use 'close' (not 'exit'): in Node child_process, 'close' fires after
      // stdio streams have been fully drained, so all data events for this
      // child have already been delivered. Resolving on 'exit' would race
      // with pending stdout chunks that arrive on a later tick.
      child.once('close', (code) => {
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = null;
        }
        currentChild = null;
        resolve({ exit: (exitCode ?? code) ?? -1 });
      });
    });
  }

  function finalize(
    kind: 'done' | 'error',
    message?: string,
    failedLessons: FailedLesson[] = [],
  ) {
    if (run.finished) return;
    run.finished = true;
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }
    if (kind === 'done') {
      emit({ type: 'done', courseSlug: slug, failedLessons });
    } else {
      const ev: GenerationEvent = {
        type: 'error',
        message: message ?? 'Generation failed',
      };
      if (failedLessons.length > 0) ev.failedLessons = failedLessons;
      emit(ev);
    }
    logStreamClosed = true;
    try {
      logStream.end();
    } catch {
      /* ignore */
    }
    if (activeRun === run) activeRun = null;
  }

  activeRun = run;
  runsById.set(id, run);

  const pipeline = (async () => {
    // ── Stage 1: init_course ────────────────────────────────────────────────
    const initResult = await spawnStage('init_course', initSpec);
    if (cancelled) {
      emit({ type: 'stage', name: 'init_course', status: 'error' });
      finalize('error', 'Cancelled by user');
      return;
    }
    if (initResult.exit !== 0) {
      emit({ type: 'stage', name: 'init_course', status: 'error' });
      finalize('error', `init_course failed (exit ${initResult.exit})`);
      return;
    }
    // Post-init guard: claude in -p mode silently no-ops on prompts it
    // doesn't understand (the original bug printed "Unknown command:" and
    // exited 0). If course.json is missing, we cannot iterate lessons —
    // bail out before the per-lesson loop tries to read a file that's
    // not there.
    let courseRaw: string;
    try {
      courseRaw = await fs.readFile(courseFile(slug), 'utf8');
    } catch {
      emit({ type: 'stage', name: 'init_course', status: 'error' });
      finalize(
        'error',
        'init_course did not produce course.json — check .generation.log',
      );
      return;
    }
    let course;
    try {
      course = CourseSchema.parse(JSON.parse(courseRaw));
    } catch (err) {
      emit({ type: 'stage', name: 'init_course', status: 'error' });
      const reason = err instanceof Error ? err.message : String(err);
      finalize('error', `init_course produced invalid course.json: ${reason}`);
      return;
    }
    emit({ type: 'stage', name: 'init_course', status: 'done' });

    // ── Stage 2..N+1: one claude call per lesson, sequentially ─────────────
    const lessons = course.modules.flatMap((m) =>
      m.lessons.map((l) => ({ slug: l.slug, moduleId: m.id })),
    );
    const total = lessons.length;
    const failedLessons: FailedLesson[] = [];

    if (total === 0) {
      // Nothing to generate — surface as success-with-empty so the wizard can
      // still redirect; the course page will render an empty TOC.
      emit({ type: 'progress', current: 0, total: 0 });
      finalize('done', undefined, failedLessons);
      return;
    }

    emit({ type: 'progress', current: 0, total });

    for (let i = 0; i < lessons.length; i++) {
      if (cancelled) {
        finalize('error', 'Cancelled by user', failedLessons);
        return;
      }
      const lesson = lessons[i];
      const stageName = `lesson:${lesson.slug}`;
      const spec = lessonCommand(slug, lesson.slug);
      const result = await spawnStage(stageName, spec);

      if (cancelled) {
        emit({ type: 'stage', name: stageName, status: 'error' });
        failedLessons.push({ slug: lesson.slug, reason: 'Cancelled by user' });
        finalize('error', 'Cancelled by user', failedLessons);
        return;
      }

      if (result.exit !== 0) {
        emit({ type: 'stage', name: stageName, status: 'error' });
        failedLessons.push({
          slug: lesson.slug,
          reason: `exited ${result.exit}`,
        });
        emit({ type: 'progress', current: i + 1, total });
        continue;
      }

      // Validate the produced lesson file against LessonSchema. A failed
      // validation (or a missing file) marks this lesson as failed but does
      // NOT abort the run — the next lesson still gets a chance.
      try {
        const raw = await fs.readFile(lessonFile(slug, lesson.slug), 'utf8');
        LessonSchema.parse(JSON.parse(raw));
        emit({ type: 'stage', name: stageName, status: 'done' });
      } catch (err) {
        emit({ type: 'stage', name: stageName, status: 'error' });
        const reason = err instanceof Error ? err.message : String(err);
        failedLessons.push({ slug: lesson.slug, reason });
      }
      emit({ type: 'progress', current: i + 1, total });
    }

    // If every lesson failed there's nothing for the wizard to redirect to —
    // surface an error. Otherwise the run is `done` with a non-empty
    // failedLessons summary so the UI can show what's missing.
    if (failedLessons.length === total) {
      finalize(
        'error',
        `All ${total} lesson(s) failed to generate — see .generation.log`,
        failedLessons,
      );
      return;
    }
    finalize('done', undefined, failedLessons);
  })();

  pipeline.catch((err) => {
    finalize('error', err instanceof Error ? err.message : String(err));
  });

  return run;
}

export function sseEncode(event: GenerationEvent): Uint8Array {
  return new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}
