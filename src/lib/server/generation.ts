// Server-only module that owns the (single) running course-generation
// subprocess and exposes its output as a stream of structured events.
//
// Pipeline: a natural-language brief that points `claude -p` at the
// init_course skill, then ONE `claude -p` per lesson driven directly from
// course.json — no ralph.sh, no worktrees, no branches, no git push. Both
// stages run with stdout+stderr captured to the run's event log AND tee'd to
// `/courses/<slug>/.generation.log`. Per-stage output is also tee'd to
// structured per-stage logs under `/courses/<slug>/.gen-logs/`. Per-lesson
// `claude` calls are retried up to N times (LESSON_MAX_RETRIES, default 2 →
// 3 total attempts) with each attempt subject to LESSON_TIMEOUT_SEC
// (default 1800s); on retry the prompt is prepended with a
// `PREVIOUS ATTEMPT FAILED:\n<reason>` block. Concurrency is gated to 1.

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
import { assertSafeSlug, courseDir, courseFile, genLogsDir, lessonFile } from './paths';
import { listCourseSourceFilesSync } from './sources';

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
  lessonCommand?: (
    slug: string,
    lessonSlug: string,
    previousAttemptReason?: string,
  ) => { command: string; args: string[] };
  cwd?: string;
  sigkillGraceMs?: number;
  /** Number of retries per lesson (additional attempts after the first). */
  lessonMaxRetries?: number;
  /** Per-attempt wall-clock timeout in milliseconds. */
  lessonTimeoutMs?: number;
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
// Synchronous reservation flag bridging the await gap between the activeRun
// guard check and the activeRun assignment in startGeneration. Without it,
// two concurrent POSTs (e.g. React StrictMode double-mount of the Stage 5
// effect) both pass the guard before either has had a chance to assign
// activeRun and end up spawning parallel pipelines that overwrite each
// other's lesson files. See US-101.
let startingGeneration = false;
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
  startingGeneration = false;
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

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
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
  // US-104: when the user uploaded source materials in Stage 0 (US-103), the
  // files now live at /courses/<slug>/sources/. Enumerate them and inject
  // their absolute paths into the prompt so claude knows to ground the
  // curriculum in user-supplied content. When the directory is empty/absent
  // (the "Start from scratch" path) the prompt is unchanged.
  const sourcePaths = listCourseSourceFilesSync(slug);
  const sourcesSection =
    sourcePaths.length > 0
      ? ` Source materials uploaded by the user (the curriculum MUST be grounded in these files — invoke the Read tool on EACH path BEFORE drafting course.json so every module/lesson/quiz item traces back to this content rather than generic textbook material):\n${sourcePaths
          .map((p) => `- ${p}`)
          .join('\n')}\n`
      : '';
  const prompt =
    `Run the init_course skill defined in scripts/ralph/skills/init_course/SKILL.md. ` +
    `Argument: slug = "${slug}". ` +
    `Read that SKILL.md and execute its steps end-to-end against /courses/${slug}/course-spec.json: ` +
    `do the research pass (write /courses/${slug}/research.md and /courses/${slug}/sources.md), ` +
    `do the architect pass (write /courses/${slug}/course.json validated against CourseSchema). ` +
    `Do not generate lesson content here — the webapp's generation backend will invoke generate_lesson once per lesson after this step. ` +
    `Do NOT touch scripts/ralph/.` +
    sourcesSection;
  return {
    command: 'claude',
    args: [
      '-p',
      prompt,
      // --output-format stream-json makes claude emit one JSON event per
      // stdout line as it works (assistant deltas, tool invocations) instead
      // of buffering everything until the run finishes. claude requires
      // --verbose alongside stream-json under -p; pumpStream / formatStreamJsonLine
      // turn each event into a human-readable log line. See US-102.
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ],
  };
}

export function defaultLessonCommand(
  slug: string,
  lessonSlug: string,
  previousAttemptReason?: string,
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
  // US-104: same source-materials injection as defaultInitCourseCommand —
  // per-lesson generation must also be able to pull facts/quotes/figures
  // from the originals. When no sources were uploaded, the brief is
  // unchanged.
  const sourcePaths = listCourseSourceFilesSync(slug);
  const sourcesSection =
    sourcePaths.length > 0
      ? ` Source materials uploaded by the user (pull facts, quotes, examples, and figures from these files — invoke the Read tool on the relevant path(s) BEFORE authoring this lesson so its content is grounded in the originals rather than invented):\n${sourcePaths
          .map((p) => `- ${p}`)
          .join('\n')}\n`
      : '';
  const baseBrief =
    `Run the generate_lesson skill defined in scripts/ralph/skills/generate_lesson/SKILL.md. ` +
    `Arguments: slug = "${slug}", lesson-slug = "${lessonSlug}". ` +
    `Read that SKILL.md and execute its steps end-to-end against /courses/${slug}/course.json, ` +
    `/courses/${slug}/research.md, and /courses/${slug}/sources.md to author exactly one lesson at ` +
    `/courses/${slug}/lessons/${lessonSlug}.json. The file MUST validate against LessonSchema in src/lib/schemas/lesson.ts. ` +
    `Do NOT touch scripts/ralph/. Do NOT modify course.json or any other lesson file. One call, one lesson.` +
    sourcesSection;
  // Mirrors the retry-context pattern from scripts/ralph/ralph.sh:992-996 —
  // when a previous attempt failed, prepend the failure reason so the agent
  // can fix the specific issue rather than repeat the same mistake.
  const prompt = previousAttemptReason
    ? `PREVIOUS ATTEMPT FAILED:\n${previousAttemptReason}\n\nFix these issues specifically.\n\n${baseBrief}`
    : baseBrief;
  return {
    command: 'claude',
    args: [
      '-p',
      prompt,
      // See defaultInitCourseCommand for why --output-format stream-json
      // + --verbose is set; same incremental-streaming requirement applies
      // per-lesson. US-102.
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ],
  };
}

function makeRunId(): string {
  return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Convert one raw stdout/stderr line to zero or more human-readable log lines.
 *
 * Lines that look like Claude Code's `--output-format stream-json` events
 * (one JSON object per line with a known `type` field) are decoded into
 * concise text — assistant text deltas, tool invocations, tool results, and
 * lifecycle markers — so the SSE log panel surfaces incremental progress
 * instead of opaque JSON. Any line that isn't a recognised stream-json event
 * (mock output, plain stderr, the "Unknown command:" pre-fix path) passes
 * through unchanged.
 */
export function formatStreamJsonLine(rawLine: string): string[] {
  if (rawLine.length === 0) return [rawLine];
  if (rawLine[0] !== '{') return [rawLine];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return [rawLine];
  }
  if (typeof parsed !== 'object' || parsed === null) return [rawLine];
  const obj = parsed as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== 'string') return [rawLine];

  switch (type) {
    case 'system': {
      const subtype = typeof obj.subtype === 'string' ? obj.subtype : '';
      const model = typeof obj.model === 'string' ? obj.model : '';
      const tag = [subtype, model].filter(Boolean).join(' ');
      return [tag ? `[system ${tag}]` : '[system]'];
    }
    case 'assistant': {
      const message = obj.message as { content?: unknown } | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      const out: string[] = [];
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue;
        const b = block as Record<string, unknown>;
        const blockType = b.type;
        if (blockType === 'text' && typeof b.text === 'string') {
          for (const ln of b.text.split(/\r?\n/)) {
            if (ln.length > 0) out.push(ln);
          }
        } else if (blockType === 'tool_use') {
          const name = typeof b.name === 'string' ? b.name : 'tool';
          out.push(`→ ${name}(${formatToolInput(b.input)})`);
        }
        // 'thinking' blocks deliberately suppressed — they're verbose and
        // not user-facing context.
      }
      return out;
    }
    case 'user': {
      const message = obj.message as { content?: unknown } | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      const out: string[] = [];
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue;
        const b = block as Record<string, unknown>;
        if (b.type !== 'tool_result') continue;
        const text = extractToolResultText(b.content);
        const firstLine = text.split(/\r?\n/)[0] ?? '';
        const trimmed = firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
        out.push(trimmed.length > 0 ? `← ${trimmed}` : '← (empty)');
      }
      return out;
    }
    case 'result': {
      const subtype = typeof obj.subtype === 'string' ? obj.subtype : '';
      const isError = obj.is_error === true;
      const durationMs = typeof obj.duration_ms === 'number' ? obj.duration_ms : null;
      const tag = isError ? 'error' : subtype || 'ok';
      const tail = durationMs !== null ? ` (${(durationMs / 1000).toFixed(1)}s)` : '';
      return [`[result ${tag}${tail}]`];
    }
    default:
      return [`[${type}]`];
  }
}

function formatToolInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return '';
  // Pick the most informative key for one-line summaries. Order matches the
  // Claude Code tool catalog: file ops first, then shell, then search/web.
  const PREFERRED = ['file_path', 'path', 'command', 'pattern', 'url', 'description', 'query'];
  for (const k of PREFERRED) {
    const v = obj[k];
    if (typeof v === 'string') return `${k}: ${truncate(v, 80)}`;
  }
  const firstKey = keys[0];
  const v = obj[firstKey];
  const stringy = typeof v === 'string' ? v : JSON.stringify(v);
  return `${firstKey}: ${truncate(stringy ?? '', 80)}`;
}

function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue;
    const p = part as Record<string, unknown>;
    if (p.type === 'text' && typeof p.text === 'string') return p.text;
  }
  return '';
}

function truncate(s: string, limit: number): string {
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

interface ChildSpec {
  command: string;
  args: string[];
}

interface SpawnChildOptions {
  /** When set + > 0, send SIGTERM after this many ms; SIGKILL after sigkillGraceMs more. */
  timeoutMs?: number;
  /** Optional secondary stream to receive every captured line in addition to the master log. */
  extraLogStream?: WriteStream | null;
}

interface SpawnChildResult {
  exit: number;
  timedOut: boolean;
  stderrTail: string;
}

interface FailedReportEntry {
  lessonSlug: string;
  attempts: number;
  lastError: string;
  logPath: string;
}

export async function startGeneration(slug: string, depsArg: SpawnDeps = {}): Promise<GenerationRun> {
  // Atomic check + reservation. MUST stay synchronous (no await between the
  // guard and the `startingGeneration = true` assignment) — otherwise two
  // concurrent callers both pass the guard before either reaches the
  // assignment and both go on to spawn a pipeline. See US-101.
  if ((activeRun && !activeRun.finished) || startingGeneration) {
    throw new GenerationConflictError();
  }
  startingGeneration = true;

  try {
    return await startGenerationInner(slug, depsArg);
  } finally {
    // By this point activeRun has either been assigned (success path) or the
    // setup threw before the assignment (rollback). Either way the
    // reservation is no longer needed: subsequent callers see activeRun
    // directly. On the rollback path activeRun stays null so the next call
    // is free to start.
    startingGeneration = false;
  }
}

async function startGenerationInner(
  slug: string,
  depsArg: SpawnDeps,
): Promise<GenerationRun> {
  const deps: SpawnDeps = { ...(depsOverride ?? {}), ...depsArg };

  const isExecutable = deps.isExecutableInPath ?? defaultIsExecutableInPath;
  if (!isExecutable('claude')) {
    throw new ClaudeUnavailableError();
  }

  const spawnFn = deps.spawn ?? defaultSpawn;
  const initSpec = (deps.initCourseCommand ?? defaultInitCourseCommand)(slug);
  const lessonCommand = deps.lessonCommand ?? defaultLessonCommand;
  const cwd = deps.cwd ?? process.cwd();
  const sigkillGraceMs = deps.sigkillGraceMs ?? 5000;
  const lessonMaxRetries =
    deps.lessonMaxRetries ?? parseNonNegativeInt(process.env.LESSON_MAX_RETRIES, 2);
  const lessonTimeoutMs =
    deps.lessonTimeoutMs ??
    parseNonNegativeInt(process.env.LESSON_TIMEOUT_SEC, 1800) * 1000;

  const dir = courseDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const genLogs = genLogsDir(slug);
  await fs.mkdir(genLogs, { recursive: true });
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

  function pumpStream(
    child: ChildProcess,
    opts: { extraStream?: WriteStream | null; onStderrLine?: (line: string) => void } = {},
  ) {
    let stdoutBuf = '';
    let stderrBuf = '';
    const extraStream = opts.extraStream ?? null;

    const flushLine = (rawLine: string) => {
      if (rawLine.length === 0 && !stdoutBuf && !stderrBuf) return;
      // claude -p --output-format stream-json emits one JSON event per line;
      // formatStreamJsonLine decodes each into zero-or-more human-readable
      // lines (assistant text deltas, tool invocations, lifecycle markers).
      // Non-JSON lines (mock output, stderr, the "Unknown command:" path)
      // pass through unchanged. See US-102.
      const formatted = formatStreamJsonLine(rawLine);
      for (const line of formatted) {
        if (line.length === 0 && !stdoutBuf && !stderrBuf) continue;
        if (!logStreamClosed) {
          try {
            logStream.write(`${line}\n`);
          } catch {
            /* log file already closed — fall through */
          }
        }
        if (extraStream) {
          try {
            extraStream.write(`${line}\n`);
          } catch {
            /* per-stage stream may already be closed — ignore */
          }
        }
        emit({ type: 'log', line });
      }
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
          if (opts.onStderrLine) opts.onStderrLine(line);
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
        const line = stderrBuf.replace(/\r$/, '');
        if (opts.onStderrLine) opts.onStderrLine(line);
        flushLine(line);
        stderrBuf = '';
      }
    });
  }

  function spawnChild(spec: ChildSpec, opts: SpawnChildOptions = {}): Promise<SpawnChildResult> {
    return new Promise((resolve) => {
      const stderrTailLines: string[] = [];
      const STDERR_TAIL_LIMIT = 30;
      let timedOut = false;
      let attemptTimer: NodeJS.Timeout | null = null;

      const spawnOpts: SpawnOptions = {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      };
      let child: ChildProcess;
      try {
        child = spawnFn(spec.command, spec.args, spawnOpts);
      } catch (err) {
        emit({ type: 'log', line: `spawn failed for ${spec.command}: ${(err as Error).message}` });
        resolve({ exit: -1, timedOut: false, stderrTail: '' });
        return;
      }
      currentChild = child;
      pumpStream(child, {
        extraStream: opts.extraLogStream ?? null,
        onStderrLine: (line) => {
          stderrTailLines.push(line);
          if (stderrTailLines.length > STDERR_TAIL_LIMIT) stderrTailLines.shift();
        },
      });
      let exitCode: number | null = null;
      child.once('error', (err) => {
        emit({ type: 'log', line: `error: ${err.message}` });
      });
      child.once('exit', (code) => {
        exitCode = code;
      });

      if (opts.timeoutMs && opts.timeoutMs > 0) {
        attemptTimer = setTimeout(() => {
          if (child.exitCode !== null) return;
          timedOut = true;
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
            if (typeof killTimer.unref === 'function') killTimer.unref();
          }
        }, opts.timeoutMs);
        if (typeof attemptTimer.unref === 'function') attemptTimer.unref();
      }

      // Use 'close' (not 'exit'): in Node child_process, 'close' fires after
      // stdio streams have been fully drained, so all data events for this
      // child have already been delivered. Resolving on 'exit' would race
      // with pending stdout chunks that arrive on a later tick.
      child.once('close', (code) => {
        if (attemptTimer) {
          clearTimeout(attemptTimer);
          attemptTimer = null;
        }
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = null;
        }
        currentChild = null;
        resolve({
          exit: (exitCode ?? code) ?? -1,
          timedOut,
          stderrTail: stderrTailLines.join('\n'),
        });
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

  async function writeFailedReport(entries: FailedReportEntry[]) {
    const reportPath = path.join(genLogs, 'failed_report.json');
    if (entries.length === 0) {
      // Drop any stale report from a previous run.
      try {
        await fs.unlink(reportPath);
      } catch {
        /* ignore — no stale file */
      }
      return;
    }
    try {
      await fs.writeFile(reportPath, JSON.stringify(entries, null, 2), 'utf8');
    } catch {
      /* best-effort — surface via SSE failedLessons regardless */
    }
  }

  async function runLesson(
    lessonSlug: string,
  ): Promise<{ success: boolean; attempts: number; lastError: string }> {
    const stageName = `lesson:${lessonSlug}`;
    emit({ type: 'stage', name: stageName, status: 'started' });

    const lessonLogPath = path.join(genLogs, `${lessonSlug}.log`);
    const maxAttempts = lessonMaxRetries + 1;
    let lastError = '';
    let success = false;
    let attemptsRun = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (cancelled) break;
      attemptsRun = attempt;

      // Wipe any stale lesson file before each attempt so the post-spawn
      // schema check sees only THIS attempt's output. Without this, a previous
      // attempt's invalid file would be picked up by the next attempt's
      // validation if claude exits 0 without writing.
      try {
        await fs.unlink(lessonFile(slug, lessonSlug));
      } catch {
        /* file may not exist — ignore */
      }

      // Open per-lesson log: truncate on attempt 1, append on retries so
      // every attempt's output lands in a single per-lesson .log file.
      const flags = attempt === 1 ? 'w' : 'a';
      const lessonLogStream = createWriteStream(lessonLogPath, { flags });
      lessonLogStream.on('error', () => {
        /* swallow late writes after end */
      });
      try {
        lessonLogStream.write(`=== Attempt ${attempt} — ${new Date().toISOString()} ===\n`);
      } catch {
        /* ignore */
      }

      const previousReason = attempt > 1 ? lastError : undefined;
      const spec = lessonCommand(slug, lessonSlug, previousReason);
      const result = await spawnChild(spec, {
        timeoutMs: lessonTimeoutMs,
        extraLogStream: lessonLogStream,
      });

      lessonLogStream.end();

      if (cancelled) break;

      if (result.timedOut) {
        const seconds = Math.round(lessonTimeoutMs / 1000);
        lastError = `timeout after ${seconds}s`;
        continue;
      }
      if (result.exit !== 0) {
        const tail = result.stderrTail.trim();
        lastError = tail
          ? `exited with code ${result.exit}\n${tail}`
          : `exited with code ${result.exit}`;
        continue;
      }
      // Validate the produced lesson file against LessonSchema. A failed
      // validation (or a missing file) marks this attempt as failed and
      // triggers the next retry (if any remain).
      try {
        const raw = await fs.readFile(lessonFile(slug, lessonSlug), 'utf8');
        LessonSchema.parse(JSON.parse(raw));
        success = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        continue;
      }
    }

    if (cancelled) {
      emit({ type: 'stage', name: stageName, status: 'error' });
      return { success: false, attempts: attemptsRun, lastError: 'Cancelled by user' };
    }
    if (success) {
      emit({ type: 'stage', name: stageName, status: 'done' });
    } else {
      emit({ type: 'stage', name: stageName, status: 'error' });
    }
    return { success, attempts: attemptsRun, lastError };
  }

  activeRun = run;
  runsById.set(id, run);

  const pipeline = (async () => {
    // ── Stage 1: init_course ────────────────────────────────────────────────
    emit({ type: 'stage', name: 'init_course', status: 'started' });
    const initLogPath = path.join(genLogs, 'init_course.log');
    const initLogStream = createWriteStream(initLogPath, { flags: 'w' });
    initLogStream.on('error', () => {
      /* swallow late writes */
    });
    const initResult = await spawnChild(initSpec, { extraLogStream: initLogStream });
    initLogStream.end();
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

    // ── Stage 2..N+1: one (retried) claude call per lesson, sequentially ───
    const lessons = course.modules.flatMap((m) =>
      m.lessons.map((l) => ({ slug: l.slug, moduleId: m.id })),
    );
    const total = lessons.length;
    const failedLessons: FailedLesson[] = [];
    const failedReport: FailedReportEntry[] = [];

    if (total === 0) {
      // Nothing to generate — surface as success-with-empty so the wizard can
      // still redirect; the course page will render an empty TOC.
      emit({ type: 'progress', current: 0, total: 0 });
      await writeFailedReport(failedReport);
      finalize('done', undefined, failedLessons);
      return;
    }

    emit({ type: 'progress', current: 0, total });

    for (let i = 0; i < lessons.length; i++) {
      if (cancelled) {
        await writeFailedReport(failedReport);
        finalize('error', 'Cancelled by user', failedLessons);
        return;
      }
      const lesson = lessons[i];
      const result = await runLesson(lesson.slug);

      if (cancelled) {
        failedLessons.push({ slug: lesson.slug, reason: result.lastError || 'Cancelled by user' });
        failedReport.push({
          lessonSlug: lesson.slug,
          attempts: result.attempts,
          lastError: result.lastError || 'Cancelled by user',
          logPath: `.gen-logs/${lesson.slug}.log`,
        });
        await writeFailedReport(failedReport);
        finalize('error', 'Cancelled by user', failedLessons);
        return;
      }

      if (!result.success) {
        failedLessons.push({ slug: lesson.slug, reason: result.lastError });
        failedReport.push({
          lessonSlug: lesson.slug,
          attempts: result.attempts,
          lastError: result.lastError,
          logPath: `.gen-logs/${lesson.slug}.log`,
        });
      }
      emit({ type: 'progress', current: i + 1, total });
    }

    await writeFailedReport(failedReport);

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
