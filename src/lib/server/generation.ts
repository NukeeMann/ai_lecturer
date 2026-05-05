// Server-only module that owns the (single) running course-generation
// subprocess and exposes its output as a stream of structured events.
//
// Pipeline: a natural-language brief that points `claude -p` at the
// init_course skill, then ONE `claude -p` per lesson driven directly from
// course.json — no ralph.sh, no worktrees, no branches, no git push. Both
// stages run with stdout+stderr captured to the run's event log AND tee'd to
// `/courses/<slug>/.generation.log`. Per-stage output is also tee'd to
// structured per-stage logs under `/courses/<slug>/logs/` so the wizard can
// reload completed-stage scrollback after the pipeline moves on (US-105).
// Per-lesson
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
import os from 'node:os';
import path from 'node:path';
import { CourseSchema } from '@/lib/schemas/course';
import { LessonSchema } from '@/lib/schemas/lesson';
import {
  assertSafeSlug,
  courseDir,
  courseFile,
  courseSpecFile,
  coursesRoot,
  genLogsDir,
  lessonFile,
} from './paths';
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
  /**
   * Name of the most recently started stage ('init_course', 'lesson:<slug>',
   * etc.) — used by the resume banner (US-106) to label what's currently
   * running. `null` until the first stage:started fires.
   */
  currentStage: string | null;
  subscribe: (listener: GenerationListener) => () => void;
  cancel: () => Promise<void>;
}

/**
 * Per-slug queue entry surfaced to the UI by GET /api/courses/active-run
 * (US-107). `position` is 1-based — entry at index 0 in the on-disk queue
 * has position 1.
 */
export interface QueueSummaryEntry {
  slug: string;
  name: string;
  position: number;
}

/**
 * Summary returned by GET /api/courses/active-run (US-106). Lets the /create
 * page detect a still-running generation after a tab/server reload and offer
 * the user a one-click resume. As of US-107 the response also carries the
 * pending queue so callers can show "X w kolejce" context.
 */
export type ActiveRunSummary =
  | { active: false; queue: QueueSummaryEntry[] }
  | { active: true; slug: string; name: string; stage: string; queue: QueueSummaryEntry[] };

/**
 * Result of POST /api/courses/generate (US-107). Either we started the run
 * straight away (and got an SSE id back) or we appended it to the FIFO
 * queue — in which case the caller polls /api/courses/active-run to learn
 * when the slug becomes active and the SSE id is finally available.
 */
export type EnqueueResult =
  | { kind: 'started'; run: GenerationRun }
  | { kind: 'queued'; slug: string; position: number; total: number };

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
// US-107: when the very first POST for a slug is mid-`startGeneration`
// (between the synchronous reservation and the `activeRun = run` assignment),
// a concurrent POST from React's StrictMode dev double-mount lands while
// activeRun is still null and would otherwise be enqueued as a *separate*
// queue entry. Tracking the starting slug lets us collapse the second call
// into idempotent same-slug behaviour just like once activeRun has been
// assigned.
let startingSlug: string | null = null;
const runsById = new Map<string, GenerationRun>();
let depsOverride: SpawnDeps | null = null;

// US-107 — sequential FIFO queue for course generations. When a POST arrives
// while activeRun is still running, the new slug is appended to `queue` and
// persisted to disk so it survives server restarts; finalize() pops the head
// and starts it as soon as the active run finishes.
interface QueueEntry {
  slug: string;
  enqueuedAt: string;
}

let queue: QueueEntry[] = [];
let queueLoaded = false;

function queueFile(): string {
  const override = process.env.GENERATION_QUEUE_FILE_OVERRIDE;
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), '.ai-lecturer', 'generation-queue.json');
}

async function loadQueueFromDisk(): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(queueFile(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      queue = [];
      return;
    }
    queue = [];
    return;
  }
  try {
    const parsed = JSON.parse(raw) as { entries?: unknown };
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    queue = entries.flatMap((e): QueueEntry[] => {
      if (typeof e !== 'object' || e === null) return [];
      const slug = (e as { slug?: unknown }).slug;
      const enqueuedAt = (e as { enqueuedAt?: unknown }).enqueuedAt;
      if (typeof slug !== 'string' || slug.length === 0) return [];
      return [
        { slug, enqueuedAt: typeof enqueuedAt === 'string' ? enqueuedAt : new Date().toISOString() },
      ];
    });
  } catch {
    queue = [];
  }
}

async function persistQueue(): Promise<void> {
  const file = queueFile();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ entries: queue }, null, 2), 'utf8');
  } catch {
    /* best-effort — losing the queue file across a restart degrades to the
     * pre-US-107 single-run behaviour, never breaks the active run. */
  }
}

async function ensureQueueLoaded(): Promise<void> {
  if (queueLoaded) return;
  queueLoaded = true;
  await loadQueueFromDisk();
}

/**
 * Snapshot of the persisted queue surfaced to the UI. Walks the in-memory
 * queue (loaded lazily on first call), resolves a human-readable name for
 * each entry, and assigns 1-based positions.
 */
async function getQueueSummary(): Promise<QueueSummaryEntry[]> {
  if (queue.length === 0) return [];
  const out: QueueSummaryEntry[] = [];
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    const name = await resolveCourseName(entry.slug);
    out.push({ slug: entry.slug, name, position: i + 1 });
  }
  return out;
}

export function getActiveRun(): GenerationRun | null {
  return activeRun;
}

/**
 * Filename for the per-course "this slug has a generation in flight" marker
 * used to reconcile the active-run state across server restarts (US-106).
 * Lives inside the course directory next to .generation.log so a `rm -rf` on
 * the course also wipes the marker.
 */
const GENERATING_MARKER = '.generating.json';

interface GeneratingMarker {
  childPid: number | null;
  slug: string;
  stage: string | null;
  startedAt: string;
}

async function writeGeneratingMarker(slug: string, marker: GeneratingMarker): Promise<void> {
  try {
    await fs.mkdir(courseDir(slug), { recursive: true });
    await fs.writeFile(
      path.join(courseDir(slug), GENERATING_MARKER),
      JSON.stringify(marker),
      'utf8',
    );
  } catch {
    /* best-effort — banner reconciliation is a UX nicety, not load-bearing */
  }
}

async function removeGeneratingMarker(slug: string): Promise<void> {
  try {
    await fs.unlink(path.join(courseDir(slug), GENERATING_MARKER));
  } catch {
    /* file may already be gone */
  }
}

function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 doesn't kill — only checks deliverability. Throws ESRCH if the
    // process is gone, EPERM if alive but not ours (alive is what we want).
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Resolve a human-readable course name for the active-run banner. Prefer
 * `course.json#title` (set after the init phase), fall back to the spec's
 * `draftStructure.courseTitle`, and finally to the slug itself.
 */
async function resolveCourseName(slug: string): Promise<string> {
  try {
    const raw = await fs.readFile(courseFile(slug), 'utf8');
    const json = JSON.parse(raw) as { title?: unknown };
    if (typeof json.title === 'string' && json.title.length > 0) return json.title;
  } catch {
    /* fall through to spec */
  }
  try {
    const raw = await fs.readFile(courseSpecFile(slug), 'utf8');
    const json = JSON.parse(raw) as { draftStructure?: { courseTitle?: unknown } };
    const t = json.draftStructure?.courseTitle;
    if (typeof t === 'string' && t.length > 0) return t;
  } catch {
    /* fall through to slug */
  }
  return slug;
}

/**
 * Walk the most-recently-modified per-stage log file for `slug` and return
 * its basename (e.g. 'init_course' or 'intro'). Used to recover the current
 * stage of a server-restart-survivor run when the in-memory run is gone.
 */
async function deriveStageFromLogs(slug: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(genLogsDir(slug));
  } catch {
    return null;
  }
  const candidates: { stage: string; mtimeMs: number }[] = [];
  for (const name of entries) {
    if (!name.endsWith('.log')) continue;
    try {
      const stat = await fs.stat(path.join(genLogsDir(slug), name));
      if (!stat.isFile()) continue;
      candidates.push({ stage: name.slice(0, -'.log'.length), mtimeMs: stat.mtimeMs });
    } catch {
      /* ignore unreadable entry */
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const top = candidates[0].stage;
  // The disk log file for a per-lesson stage is `<lessonSlug>.log`; the SSE
  // event name is `lesson:<lessonSlug>`. Re-attach the prefix so banner stage
  // labels are consistent regardless of whether the in-memory run is alive.
  return top === 'init_course' ? 'init_course' : `lesson:${top}`;
}

/**
 * Returns a summary of the currently-running generation for the /create
 * page's resume banner (US-106). Prefers the in-memory active run; falls
 * back to scanning per-course `.generating.json` markers so a run survives
 * a server restart if the spawned child process is still alive. Stale
 * markers (PID not alive) are unlinked on encounter.
 */
export async function getActiveRunSummary(): Promise<ActiveRunSummary> {
  await ensureQueueLoaded();
  const result = await computeActiveRunSummary();
  // US-107: if the server restarted with a non-empty queue and nothing is
  // active, kick off the head right now so the user's POST-and-walk-away
  // expectation holds. Fire AFTER the snapshot is built so the caller sees
  // the queue they just enqueued; the next poll will see it promoted.
  maybeStartQueueHead();
  return result;
}

async function computeActiveRunSummary(): Promise<ActiveRunSummary> {
  if (activeRun && !activeRun.finished) {
    const slug = activeRun.slug;
    const stage = activeRun.currentStage ?? 'init_course';
    const name = await resolveCourseName(slug);
    const queueSummary = await getQueueSummary();
    return { active: true, slug, name, stage, queue: queueSummary };
  }

  // Cold-start reconciliation. Scan for `.generating.json` markers — each
  // identifies a course whose generation was in flight when this process (or
  // the previous server) last saw it. If the child PID is still alive, the
  // run is still going; otherwise the marker is stale.
  const root = coursesRoot();
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return { active: false, queue: await getQueueSummary() };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // skip /.drafts/ etc.
    const markerPath = path.join(root, entry.name, GENERATING_MARKER);
    let raw: string;
    try {
      raw = await fs.readFile(markerPath, 'utf8');
    } catch {
      continue;
    }
    let marker: GeneratingMarker;
    try {
      marker = JSON.parse(raw) as GeneratingMarker;
    } catch {
      try {
        await fs.unlink(markerPath);
      } catch {
        /* ignore */
      }
      continue;
    }
    if (typeof marker.childPid === 'number' && marker.childPid > 0 && !isPidAlive(marker.childPid)) {
      try {
        await fs.unlink(markerPath);
      } catch {
        /* ignore */
      }
      continue;
    }
    const slug = typeof marker.slug === 'string' && marker.slug.length > 0 ? marker.slug : entry.name;
    const stage =
      (typeof marker.stage === 'string' && marker.stage.length > 0 ? marker.stage : null) ??
      (await deriveStageFromLogs(slug)) ??
      'init_course';
    const name = await resolveCourseName(slug);
    return { active: true, slug, name, stage, queue: await getQueueSummary() };
  }
  return { active: false, queue: await getQueueSummary() };
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
  startingSlug = null;
  runsById.clear();
  depsOverride = null;
  queue = [];
  queueLoaded = false;
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
    //
    // The mock honours an existing course-spec.json's draftStructure so a
    // multi-lesson curriculum from the wizard survives into the realised
    // course.json (used by US-108's lesson-progress slider playwright test).
    // Falls back to a single 'intro' lesson when no spec exists yet.
    // The default 200ms is fast enough for the wizard's smoke tests but too
    // fast to verify the US-106 resume banner — we want a window where the
    // run is mid-flight while the test navigates away and back. Setting
    // GENERATION_MOCK_INIT_DELAY_MS extends the init phase.
    const initDelayMs = parseInt(process.env.GENERATION_MOCK_INIT_DELAY_MS ?? '', 10);
    const initDelay = Number.isFinite(initDelayMs) && initDelayMs >= 0 ? initDelayMs : 200;
    const script = `
const fs = require('fs');
const path = require('path');
const root = process.env.COURSES_ROOT_OVERRIDE || path.join(process.cwd(), 'courses');
const dir = path.join(root, ${JSON.stringify(slug)});
fs.mkdirSync(path.join(dir, 'lessons'), { recursive: true });
console.log('[mock init_course] researching topic...');
setTimeout(() => {
  console.log('[mock init_course] writing course.json');
  function slugify(input) {
    return String(input)
      .normalize('NFKD')
      .replace(/\\p{M}/gu, '')
      .toLowerCase()
      .replace(/[_\\s]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  let modules = [{
    id: 'm1',
    title: 'Module 1',
    summary: 'Stub module',
    lessons: [{ slug: 'intro', title: 'Intro', estimatedMinutes: 5 }],
  }];
  let title = 'Mock Course';
  try {
    const specRaw = fs.readFileSync(path.join(dir, 'course-spec.json'), 'utf8');
    const spec = JSON.parse(specRaw);
    if (spec && spec.draftStructure && Array.isArray(spec.draftStructure.modules) && spec.draftStructure.modules.length > 0) {
      title = spec.draftStructure.courseTitle || title;
      const usedSlugs = new Set();
      modules = spec.draftStructure.modules.map((m, mi) => ({
        id: 'm' + (mi + 1),
        title: m.title,
        summary: 'Stub module',
        lessons: (m.lessons || []).map((l) => {
          let s = slugify(l.title) || ('lesson-' + (usedSlugs.size + 1));
          while (usedSlugs.has(s)) s = s + '-x';
          usedSlugs.add(s);
          return {
            slug: s,
            title: l.title,
            estimatedMinutes: l.estimatedMinutes || 5,
          };
        }),
      }));
    }
  } catch (e) { /* no spec — keep single-lesson default */ }
  const courseJson = {
    schemaVersion: 1,
    slug: ${JSON.stringify(slug)},
    title,
    description: 'Auto-generated by GENERATION_MOCK=1',
    accentColor: 'indigo',
    icon: 'sigma',
    modules,
    createdAt: '2026-05-04T00:00:00.000Z',
    updatedAt: '2026-05-04T00:00:00.000Z',
  };
  fs.writeFileSync(path.join(dir, 'course.json'), JSON.stringify(courseJson, null, 2));
  console.log('[mock init_course] done');
}, ${initDelay});
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

/** Test-only escape hatch: returns the persisted slugs in FIFO order. */
export async function __getQueueForTesting(): Promise<string[]> {
  await ensureQueueLoaded();
  return queue.map((e) => e.slug);
}

/**
 * Whether `slug` already has an entry in the FIFO queue. Used to keep POST
 * /api/courses/generate idempotent when the same course is re-submitted while
 * still pending.
 */
function queuePosition(slug: string): number {
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].slug === slug) return i + 1;
  }
  return -1;
}

/**
 * Append `slug` to the persisted FIFO queue and return its new 1-based
 * position. No-op (returns the existing position) when the slug is already
 * queued.
 */
async function appendToQueue(slug: string): Promise<number> {
  const existing = queuePosition(slug);
  if (existing > 0) return existing;
  queue.push({ slug, enqueuedAt: new Date().toISOString() });
  await persistQueue();
  return queue.length;
}

/**
 * If activeRun is null and the queue has entries, pop the head and try to
 * start it. Fire-and-forget — failures (e.g. claude offline, missing spec)
 * are surfaced via the run's own error event when applicable, otherwise the
 * head is dropped and the next entry is tried.
 *
 * Re-entrant safe: `startingGeneration`/`activeRun` guard inside
 * `startGeneration` prevents duplicate spawns, and `inFlight` here prevents
 * recursive `maybeStartQueueHead → finalize → maybeStartQueueHead` loops
 * from re-entering before the previous head has fully assigned activeRun.
 */
let queueDrainerInFlight = false;
function maybeStartQueueHead(): void {
  if (queueDrainerInFlight) return;
  if (activeRun && !activeRun.finished) return;
  if (startingGeneration) return;
  if (queue.length === 0) return;
  queueDrainerInFlight = true;
  void (async () => {
    try {
      while (queue.length > 0) {
        if (activeRun && !activeRun.finished) return;
        if (startingGeneration) return;
        // Pop the head BEFORE starting so failures cleanly drop the broken
        // entry and the next iteration sees the new head.
        const head = queue.shift()!;
        await persistQueue();
        try {
          // Use the global depsOverride so tests that drive the queue
          // through the route handler see consistent spawn deps.
          await startGeneration(head.slug);
          return;
        } catch {
          // The head was already removed; try the next one.
          continue;
        }
      }
    } finally {
      queueDrainerInFlight = false;
    }
  })();
}

/**
 * Front door for POST /api/courses/generate (US-107). Returns either a fresh
 * run (when nothing is active) or a queued response (when activeRun is busy
 * with a different slug). Same-slug requests stay idempotent: if the slug is
 * already running, the existing run is returned; if it's already queued, the
 * existing queued position is returned.
 */
export async function enqueueGeneration(
  slug: string,
  depsArg: SpawnDeps = {},
): Promise<EnqueueResult> {
  await ensureQueueLoaded();

  // Idempotent attach for same-slug-already-active. Mirror startGeneration's
  // own check so callers don't have to special-case it.
  if (activeRun && !activeRun.finished && activeRun.slug === slug) {
    return { kind: 'started', run: activeRun };
  }

  // Same slug already pending → return its current position. Skip the
  // append; FIFO is preserved.
  const existingPos = queuePosition(slug);
  if (existingPos > 0) {
    return { kind: 'queued', slug, position: existingPos, total: queue.length };
  }

  // Same slug is mid-startGeneration but activeRun isn't assigned yet (the
  // narrow window between the synchronous reservation and the awaited
  // mkdir/etc inside startGenerationInner). React StrictMode dev double-mount
  // routinely lands a second POST here. Wait briefly for the first call to
  // finish setup, then attach idempotently.
  if (startingGeneration && startingSlug === slug) {
    for (let i = 0; i < 100 && startingGeneration && startingSlug === slug; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    if (activeRun && !activeRun.finished && activeRun.slug === slug) {
      return { kind: 'started', run: activeRun };
    }
    // Fall through — first call finished and dropped its reservation; we
    // can take the open slot.
  }

  // Different slug while one is in flight → enqueue.
  if ((activeRun && !activeRun.finished) || startingGeneration) {
    const position = await appendToQueue(slug);
    return { kind: 'queued', slug, position, total: queue.length };
  }

  // Slot is open. Start straight away.
  const run = await startGeneration(slug, depsArg);
  return { kind: 'started', run };
}

export async function startGeneration(slug: string, depsArg: SpawnDeps = {}): Promise<GenerationRun> {
  // Atomic check + reservation. MUST stay synchronous (no await between the
  // guard and the `startingGeneration = true` assignment) — otherwise two
  // concurrent callers both pass the guard before either reaches the
  // assignment and both go on to spawn a pipeline. See US-101.
  // Idempotent attach for SAME slug: when the wizard's Stage 6 effect
  // double-fires (React StrictMode dev double-mount, or US-106 banner
  // resume), we'd rather hand back the existing run than 409 the user. The
  // safety net only fires when slug matches; a different slug while a run
  // is in flight still conflicts as before. See US-105.
  if (activeRun && !activeRun.finished && activeRun.slug === slug) {
    return activeRun;
  }
  if ((activeRun && !activeRun.finished) || startingGeneration) {
    throw new GenerationConflictError();
  }
  startingGeneration = true;
  startingSlug = slug;

  try {
    return await startGenerationInner(slug, depsArg);
  } finally {
    // By this point activeRun has either been assigned (success path) or the
    // setup threw before the assignment (rollback). Either way the
    // reservation is no longer needed: subsequent callers see activeRun
    // directly. On the rollback path activeRun stays null so the next call
    // is free to start.
    startingGeneration = false;
    startingSlug = null;
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
    currentStage: null,
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
    if (event.type === 'stage' && event.status === 'started') {
      run.currentStage = event.name;
      // Refresh the on-disk marker so a server restart can recover the
      // in-flight stage label even if the in-memory run is gone (US-106).
      void writeGeneratingMarker(slug, {
        childPid: currentChild?.pid ?? null,
        slug,
        stage: event.name,
        startedAt: new Date().toISOString(),
      });
    }
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
      // Refresh the .generating.json marker with the freshly-spawned child's
      // PID so cold-start reconciliation (US-106) can probe it for liveness.
      void writeGeneratingMarker(slug, {
        childPid: child.pid ?? null,
        slug,
        stage: run.currentStage,
        startedAt: new Date().toISOString(),
      });
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
    // Drop the .generating.json marker so a subsequent /api/courses/active-run
    // call no longer sees this slug as in flight (US-106).
    void removeGeneratingMarker(slug);
    if (activeRun === run) activeRun = null;
    // US-107: pop the next queued slug (if any) and start it. Defers to a
    // microtask so the current emit() chain finishes first; the drainer is
    // re-entrant safe (sees activeRun cleared above and its own
    // queueDrainerInFlight guard).
    maybeStartQueueHead();
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

  // Seed the .generating.json marker before the pipeline kicks off so a tab
  // reload that lands between activeRun assignment and the first child spawn
  // still sees the active run (US-106). The PID/stage will be refreshed on
  // each spawnChild and stage:started.
  void writeGeneratingMarker(slug, {
    childPid: null,
    slug,
    stage: null,
    startedAt: new Date().toISOString(),
  });

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
          logPath: `logs/${lesson.slug}.log`,
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
          logPath: `logs/${lesson.slug}.log`,
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
