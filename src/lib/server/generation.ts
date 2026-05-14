// Server-only module that owns the (single) running course-generation
// subprocess and exposes its output as a stream of structured events.
//
// Pipeline: TWO natural-language `claude -p` briefs for the course init —
// research_course (writes research.md + sources.md) then design_course
// (writes course.json) — followed by ONE `claude -p` per lesson driven
// directly from course.json, then a final coherence_pass. No ralph.sh, no
// worktrees, no branches, no git push. Every stage runs with stdout+stderr
// captured to the run's event log AND tee'd to
// `/courses/<slug>/.generation.log`. Per-stage output is also tee'd to
// structured per-stage logs under `/courses/<slug>/logs/` so the wizard can
// reload completed-stage scrollback after the pipeline moves on (US-105).
// Per-lesson
// `claude` calls are retried up to N times (LESSON_MAX_RETRIES, default 2 →
// 3 total attempts) with each attempt subject to LESSON_TIMEOUT_SEC
// (default 1800s); on retry the prompt is prepended with a
// `PREVIOUS ATTEMPT FAILED:\n<reason>` block. Concurrency is gated to 1.

import {
  ChildProcess as RealChildProcess,
  spawn as defaultSpawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import {
  promises as fs,
  appendFileSync,
  createWriteStream,
  readFileSync,
  statSync,
  unlinkSync,
  type WriteStream,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CourseSchema } from '@/lib/schemas/course';
import {
  AUTO_TTS_SENTINEL,
  LessonSchema,
  LessonSchemaWithSentinel,
  type Lesson,
  type LessonWithSentinel,
} from '@/lib/schemas/lesson';
import { runTts as defaultRunTts, type RunTtsResult } from './tts';
import { DEFAULT_TTS_VOICE, type TtsRequest } from '@/lib/schemas/tts';
import { atomicRenameSync, atomicWriteJson } from './atomic';
import {
  findLessonAssetIssues,
  formatAssetIssuesError,
} from './lessonAssets';
import {
  assertSafeSlug,
  courseDir,
  courseFile,
  courseSpecFile,
  coursesRoot,
  genLogsDir,
  lessonFile,
} from './paths';
import { listCourseSourceFilesSync, resolveSourcePathForPrompt } from './sources';
import {
  deleteGenerationState,
  readGenerationState,
  writeGenerationState,
  type GenerationState,
} from './generationState';

export interface FailedLesson {
  slug: string;
  reason: string;
}

export type GenerationEvent =
  | { type: 'log'; line: string }
  | { type: 'stage'; name: string; status: 'started' | 'done' | 'error' }
  | { type: 'progress'; current: number; total: number }
  // US-141: `coherenceReportPath` is set on the completion summary only when
  // the final coherence-pass stage produced a report on disk (relative path
  // under /courses/<slug>/). Absent when the stage was skipped or failed —
  // surfaces only via the SSE event log in those cases per AC.
  | {
      type: 'done';
      courseSlug: string;
      failedLessons: FailedLesson[];
      coherenceReportPath?: string;
    }
  | { type: 'error'; message: string; failedLessons?: FailedLesson[] }
  // US-137: emitted as the FIRST event of a resumeGeneration() run so the
  // wizard can hydrate its lesson-status panel in one round-trip — completed
  // lessons (status='done'), the rest in source order, and the slug of the
  // lesson currently being attempted (null when the resume starts at init).
  | {
      type: 'resumed';
      completed: string[];
      remaining: string[];
      inflightSlug: string | null;
    }
  // US-157: per-section TTS sub-stage event emitted while the generation
  // pipeline post-processes AudioPlayer / transcriptCloze sections that the
  // generate_lesson agent left with `audioPath: 'AUTO_TTS'`. Sits between the
  // lesson's generate_lesson stage:done and the lesson's overall completion.
  // The optional `errorMessage` carries the TTS engine's failure detail when
  // status==='failed' so the live log surfaces what went wrong.
  | {
      type: 'tts';
      lessonSlug: string;
      sectionId: string;
      status: 'started' | 'done' | 'failed';
      errorMessage?: string;
    };

// US-138: listeners receive the per-run monotonic seq alongside the event so
// the SSE handler can emit a matching `id:` line and dedupe events whose
// seq <= the last replayed seq from the persisted ndjson log. Existing
// callers that take a single arg are still assignable — extra trailing
// params are ignored.
export type GenerationListener = (event: GenerationEvent, seq: number) => void;

export interface GenerationRun {
  id: string;
  slug: string;
  events: GenerationEvent[];
  finished: boolean;
  /**
   * Name of the most recently started stage ('research_course', 'design_course',
   * 'lesson:<slug>', 'coherence-pass') — used by the resume banner (US-106) to
   * label what's currently running. `null` until the first stage:started fires.
   */
  currentStage: string | null;
  /**
   * US-138: monotonic counter incremented on every emit() call. Equals the
   * seq id of the most recently emitted event (0 when no event has been
   * emitted yet). Mirrored on disk via the per-course
   * `.generation-events.ndjson` log; on resume it's seeded from the max seq
   * found in the existing log so the counter never wraps within a course.
   */
  lastSeq: number;
  /**
   * US-138: parallel array to `events` — `eventSeqs[i]` is the seq id
   * assigned to `events[i]`. Exposed so the SSE replay route can backstop
   * any in-memory event whose ndjson append hadn't been observed by
   * readFileSync at snapshot time (small partial-line race window).
   */
  eventSeqs: readonly number[];
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
 * US-140: per-lesson progress snapshot derived from the persisted
 * `.generation-state.json` (US-136). Surfaced by the resume banner so the
 * user sees how many lessons are done, which one is mid-flight, and which
 * are pending — and can cross-link directly to any already-finished lesson.
 */
export interface ActiveRunProgressLesson {
  slug: string;
  title: string;
  status: 'pending' | 'inflight' | 'done' | 'failed';
}

export interface ActiveRunProgress {
  initStatus: 'pending' | 'done' | 'failed';
  lessonsDone: number;
  lessonsTotal: number;
  currentLessonSlug: string | null;
  lessons: ActiveRunProgressLesson[];
}

/**
 * One course that has a `.generation-state.json` on disk but is NOT the
 * currently-active run. Produced by scanning course dirs and excluding any
 * slug whose `.generating.json` PID is still alive (or that matches the
 * in-memory activeRun). The clean-success path deletes the state file, so a
 * surviving file means the run either failed, was force-killed (laptop off,
 * server crash, Claude session limit), or finished with `failedLessons` — in
 * all of which cases POST /api/courses/<slug>/resume can pick it back up.
 */
export interface ResumableRunEntry {
  slug: string;
  name: string;
  lessonsDone: number;
  lessonsTotal: number;
  initStatus: 'pending' | 'done' | 'failed';
  lastUpdatedAt: string;
}

/**
 * Summary returned by GET /api/courses/active-run (US-106). Lets the /create
 * page detect a still-running generation after a tab/server reload and offer
 * the user a one-click resume. As of US-107 the response also carries the
 * pending queue so callers can show "X in queue" context. US-140 adds an
 * optional `progress` block (only present when `.generation-state.json`
 * from US-136 exists) so the banner can render concrete per-lesson status.
 * The optional `resumable` list (only present when non-empty) carries any
 * courses with a leftover `.generation-state.json` whose run is no longer
 * live — so the banner can offer a one-click POST /<slug>/resume even after
 * a session-limit / crash / power-off that already cleared activeRun.
 */
export type ActiveRunSummary =
  | { active: false; queue: QueueSummaryEntry[]; resumable?: ResumableRunEntry[] }
  | {
      active: true;
      slug: string;
      name: string;
      stage: string;
      queue: QueueSummaryEntry[];
      progress?: ActiveRunProgress;
      resumable?: ResumableRunEntry[];
    };

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
  /**
   * First half of the (former) init_course stage — produces research.md +
   * sources.md. Splitting init into two agents lets each one have its own
   * retry budget, log file, and SSE stage event.
   */
  researchCourseCommand?: (slug: string) => { command: string; args: string[] };
  /**
   * Second half of the (former) init_course stage — reads the research/sources
   * artefacts plus the original spec and writes course.json validated against
   * CourseSchema.
   */
  designCourseCommand?: (slug: string) => { command: string; args: string[] };
  lessonCommand?: (
    slug: string,
    lessonSlug: string,
    previousAttemptReason?: string,
  ) => { command: string; args: string[] };
  /** US-141: factory for the final coherence-pass spawn. Same shape as the
   * other command factories — defaults to `defaultCoherencePassCommand`. */
  coherencePassCommand?: (slug: string) => { command: string; args: string[] };
  /** US-141: when true, the final coherence-pass stage is skipped entirely.
   * Used by tests that don't want to script a coherence child. The default
   * is `false` in production; the vitest setup flips it to `true` globally
   * via `__setCoherencePassDisabledByDefault` so existing pipeline tests
   * don't have to be updated. */
  disableCoherencePass?: boolean;
  /** US-141: override the per-spawn timeout applied to the coherence-pass
   * child when running headless inside a ralph orchestrator iteration.
   * Defaults to 30000ms (30s) per AC; tests pass a small value to drive
   * the timeout path without waiting wall-clock seconds. Ignored when
   * `isRalphOrchestrated()` returns false. */
  coherencePassTimeoutMs?: number;
  cwd?: string;
  sigkillGraceMs?: number;
  /** Number of retries per lesson (additional attempts after the first). */
  lessonMaxRetries?: number;
  /** Per-attempt wall-clock timeout in milliseconds. */
  lessonTimeoutMs?: number;
  /**
   * US-157: injection point for the TTS callable. Defaults to the production
   * `runTts` from `./tts.ts`. Tests pass a stub that writes a fake .wav and
   * returns its absolute path so the post-processor's copy/cache logic can be
   * exercised without spawning Coqui.
   */
  runTts?: (input: TtsRequest) => Promise<RunTtsResult>;
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

/**
 * US-137: thrown by resumeGeneration() when the per-course
 * `.generation-state.json` file from US-136 isn't on disk. The route handler
 * maps this to 409 `{ error: 'no-resumable-state' }` so the UI can fall back
 * to a fresh POST /api/courses/generate.
 */
export class GenerationStateMissingError extends Error {
  constructor() {
    super('No .generation-state.json file present for slug');
    this.name = 'GenerationStateMissingError';
  }
}

/**
 * Thrown by enqueueGeneration() and resumeGeneration() when a cancel for
 * this slug landed within the last `CANCEL_COOLDOWN_MS`. Why: a Cancel
 * click can race with an auto-resume path (resume banner fallback,
 * StrictMode double-mount, stale tab) that re-fires within milliseconds —
 * the cooldown gives that storm a chance to die down so cancel actually
 * sticks. Route handlers map this to 409 `{ error: 'recently-cancelled' }`.
 */
export class CancellationCooldownError extends Error {
  constructor(public readonly slug: string) {
    super(`Generation for "${slug}" was cancelled recently — wait a few seconds before retrying`);
    this.name = 'CancellationCooldownError';
  }
}

/**
 * US-139: defensive idempotency guard for the per-lesson stage. Returns
 * `{ valid: true }` when `/courses/<slug>/lessons/<lessonSlug>.json` already
 * parses + validates against `LessonSchema` (the same schema enforced by the
 * per-lesson API route handler). Used by `startGenerationInner` to skip the
 * `claude -p generate_lesson` spawn entirely when prior work — a US-137
 * resume, a manual file copy, or a previous successful run — has already
 * landed a valid lesson on disk. Cheap protection against wasted token spend.
 *
 * Rejects are normalised to a `{ valid: false, reason }` discriminator so
 * callers can branch on cause (e.g. for telemetry); current callers treat
 * every false case the same — re-spawn.
 */
export type IsLessonAlreadyValidResult =
  | { valid: true; lesson: Lesson }
  | { valid: false; reason: 'missing' | 'parse-error' | 'schema-error' };

export async function isLessonAlreadyValid(
  slug: string,
  lessonSlug: string,
): Promise<IsLessonAlreadyValidResult> {
  let raw: string;
  try {
    raw = await fs.readFile(lessonFile(slug, lessonSlug), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { valid: false, reason: 'missing' };
    }
    return { valid: false, reason: 'parse-error' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valid: false, reason: 'parse-error' };
  }
  const result = LessonSchema.safeParse(parsed);
  if (!result.success) {
    return { valid: false, reason: 'schema-error' };
  }
  return { valid: true, lesson: result.data };
}

// ── US-138: persistent generation events log ─────────────────────────────────
// Every emitted GenerationEvent is appended to a per-course ndjson file
// BEFORE in-memory listeners are notified. The SSE handler reads the active
// file on reconnect (Last-Event-ID / ?from=) so a tab restore or server
// restart can replay scrollback without gaps or duplicates. When the active
// file outgrows EVENTS_LOG_ROTATE_BYTES it is renamed via atomic.ts so a
// fresh active file starts; rotated files are kept on disk for forensics
// but intentionally NOT replayed to clients.

const EVENTS_LOG_BASENAME = '.generation-events.ndjson';
const EVENTS_LOG_ROTATE_BYTES_DEFAULT = 5 * 1024 * 1024;
let eventsLogRotateBytesOverride: number | null = null;

export function eventsLogPath(slug: string): string {
  return path.join(courseDir(slug), EVENTS_LOG_BASENAME);
}

function eventsLogRotateBytes(): number {
  return eventsLogRotateBytesOverride ?? EVENTS_LOG_ROTATE_BYTES_DEFAULT;
}

/** Test-only: shrink the rotation threshold so a unit test can trigger it
 * without writing a real 5 MB to disk. Pass `null` to restore the default. */
export function __setEventsLogRotateBytesForTesting(bytes: number | null): void {
  eventsLogRotateBytesOverride = bytes;
}

/**
 * One entry parsed out of `.generation-events.ndjson`. The on-disk shape
 * matches this 1:1 — `{ seq, timestamp, event }`.
 */
export interface EventsLogEntry {
  seq: number;
  timestamp: string;
  event: GenerationEvent;
}

export interface EventsLogReplay {
  entries: EventsLogEntry[];
  /** The largest seq observed in the file (>= fromSeq). */
  lastSeq: number;
  /** Lines that failed to parse — surfaced once per replay via console.warn. */
  skippedMalformed: number;
}

/**
 * Synchronously read the active `.generation-events.ndjson` for `slug` and
 * return entries with `seq > fromSeq`. Sync because the SSE handler must do
 * the replay inside ReadableStream#start with no awaits — so a concurrent
 * emit() can't slip a new event into memory between snapshot and listener
 * attach. Malformed lines (truncated by partial appends at crash) are
 * skipped without throwing; callers may log the count once per replay.
 */
export function readEventsLogSync(slug: string, fromSeq: number): EventsLogReplay {
  let raw: string;
  try {
    raw = readFileSync(eventsLogPath(slug), 'utf8');
  } catch {
    return { entries: [], lastSeq: fromSeq, skippedMalformed: 0 };
  }
  const entries: EventsLogEntry[] = [];
  let lastSeq = fromSeq;
  let skippedMalformed = 0;
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skippedMalformed += 1;
      continue;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { seq?: unknown }).seq !== 'number' ||
      typeof (parsed as { event?: unknown }).event !== 'object' ||
      (parsed as { event?: unknown }).event === null
    ) {
      skippedMalformed += 1;
      continue;
    }
    const entry = parsed as EventsLogEntry;
    if (entry.seq <= fromSeq) continue;
    entries.push(entry);
    if (entry.seq > lastSeq) lastSeq = entry.seq;
  }
  return { entries, lastSeq, skippedMalformed };
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

// Slug → ms timestamp of the most recent cancel. Used to short-circuit
// auto-restart paths (resume banner fallback, StrictMode re-mount) that
// would otherwise re-spawn within milliseconds of a Cancel click.
const recentlyCancelledAt = new Map<string, number>();
const CANCEL_COOLDOWN_MS = 5_000;

function isInCancelCooldown(slug: string): boolean {
  const ts = recentlyCancelledAt.get(slug);
  if (ts === undefined) return false;
  if (Date.now() - ts < CANCEL_COOLDOWN_MS) return true;
  recentlyCancelledAt.delete(slug);
  return false;
}

/**
 * Kill the whole process group rooted at `child`. `spawnChild` launches with
 * `detached: true`, which puts the child in its own session+pgid (pgid ===
 * child.pid). Signalling `-pid` reaches every descendant claude spawned in
 * that session — without this, SIGTERM only hits the top-level claude and
 * its Bash/Read/etc. subprocesses keep running.
 *
 * The `instanceof RealChildProcess` gate is a safety net for test mocks
 * (which subclass EventEmitter, not ChildProcess) — without it, the
 * scripted spawn's fake pid would point `process.kill(-pid)` at a real
 * process group on the test runner.
 */
function killChildTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (child instanceof RealChildProcess && typeof pid === 'number') {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      /* group kill failed (race vs. exit, or non-POSIX) — fall through */
    }
  }
  try {
    child.kill(signal);
  } catch {
    /* ignore */
  }
}

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

// Pipeline stages whose disk log basename matches the SSE event name 1:1.
// Per-lesson stages use the form `lesson:<lessonSlug>` for SSE while the
// disk file is just `<lessonSlug>.log` — anything not in this set is treated
// as a lesson and re-prefixed accordingly.
const PIPELINE_STAGE_NAMES = new Set([
  'research_course',
  'design_course',
  'coherence-pass',
]);

/**
 * Walk the most-recently-modified per-stage log file for `slug` and return
 * its basename (e.g. 'research_course', 'design_course', 'intro'). Used to
 * recover the current stage of a server-restart-survivor run when the
 * in-memory run is gone.
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
  // Pipeline stages map 1:1; per-lesson stages re-attach the `lesson:` prefix
  // so banner stage labels are consistent regardless of whether the in-memory
  // run is alive.
  return PIPELINE_STAGE_NAMES.has(top) ? top : `lesson:${top}`;
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
  const queueSummary = await getQueueSummary();

  // In-memory active run wins over the disk scan — it always reflects the
  // freshest state. The disk walk below still runs so we can collect
  // `resumable[]` (every OTHER course with a leftover state file).
  const activeFromMemory =
    activeRun && !activeRun.finished
      ? { slug: activeRun.slug, stage: activeRun.currentStage ?? 'research_course' }
      : null;

  const root = coursesRoot();
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    // Courses dir missing — can't scan resumable, but still honour an
    // in-memory active run (would be unusual: active run implies a course
    // dir exists, but stay defensive).
    if (activeFromMemory) {
      const slug = activeFromMemory.slug;
      const name = await resolveCourseName(slug);
      const progress = await readProgressForActiveRun(slug);
      return progress
        ? { active: true, slug, name, stage: activeFromMemory.stage, queue: queueSummary, progress }
        : { active: true, slug, name, stage: activeFromMemory.stage, queue: queueSummary };
    }
    return { active: false, queue: queueSummary };
  }

  // Single walk: collect (a) the first live-PID cold-start marker — only
  // meaningful when activeFromMemory is null — and (b) every slug that has a
  // `.generation-state.json` on disk so we can surface them as resumable.
  let activeFromMarker: { slug: string; stage: string } | null = null;
  const stateOwners: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // skip /.drafts/ etc.

    const dirPath = path.join(root, entry.name);
    const markerPath = path.join(dirPath, GENERATING_MARKER);
    const statePath = path.join(dirPath, '.generation-state.json');

    let raw: string | null = null;
    try {
      raw = await fs.readFile(markerPath, 'utf8');
    } catch {
      /* no marker — that's fine, the dir may still own a state file */
    }
    if (raw !== null) {
      let marker: GeneratingMarker | null = null;
      try {
        marker = JSON.parse(raw) as GeneratingMarker;
      } catch {
        try {
          await fs.unlink(markerPath);
        } catch {
          /* ignore */
        }
        marker = null;
      }
      if (marker) {
        const pidIsDead =
          typeof marker.childPid === 'number' &&
          marker.childPid > 0 &&
          !isPidAlive(marker.childPid);
        if (pidIsDead) {
          try {
            await fs.unlink(markerPath);
          } catch {
            /* ignore */
          }
        } else if (!activeFromMarker) {
          const slug =
            typeof marker.slug === 'string' && marker.slug.length > 0
              ? marker.slug
              : entry.name;
          const stage =
            (typeof marker.stage === 'string' && marker.stage.length > 0
              ? marker.stage
              : null) ??
            (await deriveStageFromLogs(slug)) ??
            'research_course';
          activeFromMarker = { slug, stage };
        }
      }
    }

    try {
      await fs.access(statePath);
      stateOwners.push(entry.name);
    } catch {
      /* no state file — clean course or a fresh run that hasn't persisted yet */
    }
  }

  const active = activeFromMemory ?? activeFromMarker;
  const activeSlug = active?.slug ?? null;

  // Build resumable[] from state-file owners that aren't the active run.
  // Newest-first so the UI surfaces the most recently-paused course at the
  // top — that's almost always the one the user wants to resume.
  const resumable: ResumableRunEntry[] = [];
  for (const slug of stateOwners) {
    if (activeSlug && slug === activeSlug) continue;
    const state = await readGenerationState(slug);
    if (!state) continue;
    const name = await resolveCourseName(slug);
    const lessonsDone = state.lessons.filter((l) => l.status === 'done').length;
    const initStatus: 'pending' | 'done' | 'failed' =
      state.research.status === 'failed' || state.design.status === 'failed'
        ? 'failed'
        : state.design.status === 'done'
          ? 'done'
          : 'pending';
    resumable.push({
      slug,
      name,
      lessonsDone,
      lessonsTotal: state.lessons.length,
      initStatus,
      lastUpdatedAt: state.lastUpdatedAt,
    });
  }
  resumable.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));

  if (active) {
    const slug = active.slug;
    const name = await resolveCourseName(slug);
    const progress = await readProgressForActiveRun(slug);
    const out: Extract<ActiveRunSummary, { active: true }> = {
      active: true,
      slug,
      name,
      stage: active.stage,
      queue: queueSummary,
    };
    if (progress) out.progress = progress;
    if (resumable.length > 0) out.resumable = resumable;
    return out;
  }
  const out: Extract<ActiveRunSummary, { active: false }> = {
    active: false,
    queue: queueSummary,
  };
  if (resumable.length > 0) out.resumable = resumable;
  return out;
}

/**
 * US-140: build the per-lesson progress block surfaced by GET
 * /api/courses/active-run for the resume banner. Returns `null` when
 * `.generation-state.json` is absent (older runs predate US-136 — the banner
 * silently falls back to its US-106 single-line label) or unreadable; never
 * throws.
 */
async function readProgressForActiveRun(slug: string): Promise<ActiveRunProgress | null> {
  let state: GenerationState | null = null;
  try {
    state = await readGenerationState(slug);
  } catch {
    return null;
  }
  if (!state) return null;

  // Map lesson slug → human title via course.json. course.json lands after
  // design_course completes; before then we fall back to the slug itself.
  const titleBySlug = new Map<string, string>();
  try {
    const raw = await fs.readFile(courseFile(slug), 'utf8');
    const json = JSON.parse(raw) as {
      modules?: Array<{ lessons?: Array<{ slug?: unknown; title?: unknown }> }>;
    };
    if (Array.isArray(json.modules)) {
      for (const m of json.modules) {
        if (!m || !Array.isArray(m.lessons)) continue;
        for (const l of m.lessons) {
          if (!l) continue;
          if (typeof l.slug === 'string' && typeof l.title === 'string') {
            titleBySlug.set(l.slug, l.title);
          }
        }
      }
    }
  } catch {
    /* best-effort — fall back to slug as title */
  }

  const lessons: ActiveRunProgressLesson[] = state.lessons.map((l) => ({
    slug: l.slug,
    title: titleBySlug.get(l.slug) ?? l.slug,
    status: l.status,
  }));
  const lessonsDone = lessons.filter((l) => l.status === 'done').length;
  const inflight = lessons.find((l) => l.status === 'inflight');
  // The UI's `initStatus` is a single 'pending|done|failed' summarising the
  // (now two-stage) init pipeline. Either stage failing surfaces as 'failed';
  // we only call it 'done' once design_course has produced course.json.
  // Anything in between (research done, design pending) reads as 'pending'.
  const initStatus: 'pending' | 'done' | 'failed' =
    state.research.status === 'failed' || state.design.status === 'failed'
      ? 'failed'
      : state.design.status === 'done'
        ? 'done'
        : 'pending';
  return {
    initStatus,
    lessonsDone,
    lessonsTotal: lessons.length,
    currentLessonSlug: inflight ? inflight.slug : null,
    lessons,
  };
}

export function getRunById(id: string): GenerationRun | undefined {
  return runsById.get(id);
}

/** Test-only: replace global spawn deps for the next startGeneration calls. */
export function __setSpawnDepsForTesting(deps: SpawnDeps | null): void {
  depsOverride = deps;
}

/** Test-only: clear the post-cancel cooldown so a follow-up start/resume isn't blocked. */
export function __clearCancelCooldownForTesting(): void {
  recentlyCancelledAt.clear();
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
  eventsLogRotateBytesOverride = null;
  recentlyCancelledAt.clear();
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

// Test-only mock scripts that stand in for `claude -p` when the wizard's
// playwright suite drives the pipeline under GENERATION_MOCK. Each script
// is a self-contained .cjs that takes its arguments via argv (slug,
// lessonSlug, initDelayMs) and writes the same on-disk artefacts the real
// agent would. They live next to this file under generationMockScripts/
// rather than as inline `node -e "..."` strings so the mock logic is
// readable, lintable, and stays in sync with CourseSchema / LessonSchema.
//
// Path is resolved against process.cwd() rather than __dirname because
// Next.js bundles server code into .next/ at build time — cwd is the
// project root in `next dev` and `vitest`, the only contexts where
// GENERATION_MOCK is ever set.
const MOCK_SCRIPTS_DIR = path.join(
  process.cwd(),
  'src',
  'lib',
  'server',
  'generationMockScripts',
);
function mockScriptPath(name: string): string {
  return path.join(MOCK_SCRIPTS_DIR, name);
}

// Shared helper: build the natural-language paragraph that lists uploaded
// source materials so an init-stage agent can Read them before authoring.
// Returns '' when no sources were uploaded (the "Start from scratch" path
// in the wizard). US-104 / US-124 wire the .docx → .extracted/<name>.md
// swap because claude's Read tool can't parse the zip-of-XML directly.
function buildInitSourcesSection(slug: string, agentBlurb: string): string {
  const sourcePaths = listCourseSourceFilesSync(slug);
  const resolvedSources = sourcePaths.map(resolveSourcePathForPrompt);
  if (resolvedSources.length === 0) return '';
  return (
    ` Source materials uploaded by the user (${agentBlurb}):\n` +
    resolvedSources
      .map((s) =>
        s.extractedFrom
          ? `- ${s.readPath} (extracted text from ${s.extractedFrom})`
          : `- ${s.readPath}`,
      )
      .join('\n') +
    '\n'
  );
}

export function defaultResearchCourseCommand(
  slug: string,
): { command: string; args: string[] } {
  // Defence-in-depth: callers (the route + courseDir) already assert this, but
  // we re-check here so the slug we splice into the prompt cannot escape.
  assertSafeSlug(slug);
  // Test-only escape hatches for the playwright browser test:
  //   GENERATION_MOCK=broken           — every run emulates the pre-fix bug
  //   GENERATION_MOCK=1 + slug starts with `broken-` — same, but per-slug so a
  //                                        single dev server can drive BOTH
  //                                        the broken and the happy scenario
  //                                        in one playwright run.
  // The broken stub prints "Unknown command:" and exits 0 without ever
  // writing research.md / sources.md — the same "claude -p silently no-ops
  // on an unparseable prompt" failure mode that the post-research guard
  // exists to catch.
  if (
    process.env.GENERATION_MOCK === 'broken' ||
    (process.env.GENERATION_MOCK === '1' && slug.startsWith('broken-'))
  ) {
    return {
      command: process.execPath,
      args: [mockScriptPath('researchCourseBroken.cjs')],
    };
  }
  if (process.env.GENERATION_MOCK === '1') {
    // Test-only fast path that writes minimal research.md + sources.md so
    // design_course's preconditions are met. The default 200ms keeps the
    // run mid-flight long enough for the US-106 resume banner test;
    // GENERATION_MOCK_INIT_DELAY_MS extends the research phase if a test
    // needs a bigger window.
    const initDelayMs = parseInt(process.env.GENERATION_MOCK_INIT_DELAY_MS ?? '', 10);
    const initDelay = Number.isFinite(initDelayMs) && initDelayMs >= 0 ? initDelayMs : 200;
    return {
      command: process.execPath,
      args: [mockScriptPath('researchCourse.cjs'), slug, String(initDelay)],
    };
  }
  // Natural-language brief — claude's print mode (`-p`) treats slash
  // commands as literal text and just prints "Unknown command:" before
  // exiting 0, so we name the skill in prose and point the agent at its
  // SKILL.md to actually run the steps. assertSafeSlug above limits the
  // slug to [A-Za-z0-9-_], making the splice safe; it travels as a prompt
  // body string, never via a shell.
  const sourcesSection = buildInitSourcesSection(
    slug,
    'the research MUST be grounded in these files — invoke the Read tool on EACH path BEFORE drafting research.md so every concept and source you list traces back to this content rather than generic textbook material',
  );
  const prompt =
    `Run the research_course skill defined in scripts/ralph/skills/research_course/SKILL.md. ` +
    `Argument: slug = "${slug}". ` +
    `Read that SKILL.md and execute its steps end-to-end against /courses/${slug}/course-spec.json: ` +
    `do the research pass (write /courses/${slug}/research.md and /courses/${slug}/sources.md). ` +
    `Do NOT write /courses/${slug}/course.json — that file belongs to the design_course skill that runs after you. ` +
    `Do not generate lesson content here. ` +
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

export function defaultDesignCourseCommand(
  slug: string,
): { command: string; args: string[] } {
  assertSafeSlug(slug);
  if (process.env.GENERATION_MOCK === '1') {
    // Mock for the design stage: writes course.json honouring an existing
    // course-spec.json's draftStructure (multi-lesson curricula survive into
    // the realised course; used by US-108's lesson-progress slider playwright
    // test). Falls back to a single 'intro' lesson when no spec exists yet.
    // No `broken-` short-circuit here: the broken path is exercised at the
    // research stage instead, which is always first.
    const designDelayMs = parseInt(
      process.env.GENERATION_MOCK_DESIGN_DELAY_MS ?? '',
      10,
    );
    const designDelay =
      Number.isFinite(designDelayMs) && designDelayMs >= 0 ? designDelayMs : 0;
    return {
      command: process.execPath,
      args: [mockScriptPath('designCourse.cjs'), slug, String(designDelay)],
    };
  }
  const sourcesSection = buildInitSourcesSection(
    slug,
    'the final course shape MUST be grounded in these files — invoke the Read tool on EACH path BEFORE deciding modules/lessons so the structure reflects the user-supplied content rather than a generic outline',
  );
  const prompt =
    `Run the design_course skill defined in scripts/ralph/skills/design_course/SKILL.md. ` +
    `Argument: slug = "${slug}". ` +
    `Read that SKILL.md and execute its steps end-to-end. ` +
    `Inputs you MUST Read first: /courses/${slug}/course-spec.json, /courses/${slug}/research.md, /courses/${slug}/sources.md (the prior research_course agent has just written the last two). ` +
    `Then do the architect pass: write /courses/${slug}/course.json validated against CourseSchema in src/lib/schemas/course.ts. ` +
    `If you rename any lesson relative to course-spec.draftStructure, update the matching ## <Lesson title> heading in /courses/${slug}/sources.md in place so generate_lesson's per-lesson source lookup still resolves. ` +
    `Do NOT re-do the research. Do NOT generate lesson content. Do NOT touch scripts/ralph/.` +
    sourcesSection;
  return {
    command: 'claude',
    args: [
      '-p',
      prompt,
      // See defaultResearchCourseCommand for why stream-json + --verbose.
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
    // Mirror the init mock: spawn the per-lesson stub script which writes a
    // LessonSchema-valid file under <coursesRoot>/<slug>/lessons/. The
    // lesson body is built deterministically from lessonSlug inside the
    // .cjs (see generationMockScripts/generateLesson.cjs) — no extra
    // arguments need to round-trip through this builder.
    return {
      command: process.execPath,
      args: [mockScriptPath('generateLesson.cjs'), slug, lessonSlug],
    };
  }
  // Natural-language brief that names the generate_lesson skill and points
  // the agent at its SKILL.md. The two slugs are passed through the prompt
  // body (after assertSafeSlug above limits each to [A-Za-z0-9-_], which
  // makes them safe to splice) and `claude -p` runs in --dangerously-skip-
  // permissions mode so the agent can write the lesson file unattended.
  // US-104: same source-materials injection as the init-stage commands —
  // per-lesson generation must also be able to pull facts/quotes/figures
  // from the originals. When no sources were uploaded, the brief is
  // unchanged.
  const sourcePaths = listCourseSourceFilesSync(slug);
  // US-124: same docx → .extracted/<name>.md swap as the init-stage commands.
  // The lesson generator must point Read at a parseable text format, never at
  // the original docx blob.
  const resolvedSources = sourcePaths.map(resolveSourcePathForPrompt);
  const sourcesSection =
    resolvedSources.length > 0
      ? ` Source materials uploaded by the user (pull facts, quotes, examples, and figures from these files — invoke the Read tool on the relevant path(s) BEFORE authoring this lesson so its content is grounded in the originals rather than invented):\n${resolvedSources
          .map((s) =>
            s.extractedFrom
              ? `- ${s.readPath} (extracted text from ${s.extractedFrom})`
              : `- ${s.readPath}`,
          )
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
      // See defaultResearchCourseCommand for why --output-format stream-json
      // + --verbose is set; same incremental-streaming requirement applies
      // per-lesson. US-102.
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ],
  };
}

/**
 * US-141: build the spawn spec for the final coherence-pass stage. Mirrors
 * `defaultLessonCommand` but invokes the `coherence_pass` skill instead, runs
 * without `--output-format stream-json` so the agent's stdout is plain
 * markdown ready to be written verbatim to `coherence-report.md`, and asks
 * the agent for the report's three named sections only — no preamble, no
 * JSON wrapper, no closing remarks.
 */
export function defaultCoherencePassCommand(slug: string): {
  command: string;
  args: string[];
} {
  assertSafeSlug(slug);
  if (process.env.GENERATION_MOCK === '1') {
    // Test-only fast path: emit a static, valid coherence report (three
    // sections matching the AC) on stdout. The orchestrator captures stdout
    // and writes it verbatim to coherence-report.md. See
    // generationMockScripts/coherencePass.cjs.
    return {
      command: process.execPath,
      args: [mockScriptPath('coherencePass.cjs')],
    };
  }
  const prompt =
    `Run the coherence_pass skill defined in scripts/ralph/skills/coherence_pass/coherence_pass.md. ` +
    `Argument: slug = "${slug}". ` +
    `Read that file and execute its steps end-to-end against /courses/${slug}/course.json and every file under /courses/${slug}/lessons/. ` +
    `Output ONLY the markdown report — three sections (## Prerequisite Order, ## Redundancy, ## Notation Consistency) — with NO preamble, NO JSON wrapper, NO closing remarks. ` +
    `Do NOT touch scripts/ralph/. Do NOT modify course.json or any lesson file. Read-only audit.`;
  return {
    command: 'claude',
    args: ['-p', prompt, '--dangerously-skip-permissions'],
  };
}

/**
 * US-141: detect whether we're running headless inside a ralph orchestrator
 * iteration. When true the coherence-pass spawn is capped with a 30s timeout
 * to protect iteration token / wall-time budgets — and on timeout a
 * placeholder string is written to the report so the failure is visible
 * rather than silently dropped.
 */
function isRalphOrchestrated(): boolean {
  return Boolean(
    process.env.RALPH_TASK_ID ||
      process.env.RALPH_DEADLINE_EPOCH ||
      process.env.RALPH_ITERATION,
  );
}

// US-141: module-level test toggle that flips the `disableCoherencePass`
// default for the duration of a test file. Production keeps the default as
// `false` (coherence-pass runs); the vitest setup calls
// `__setCoherencePassDisabledByDefault(true)` so existing pipeline tests can
// continue asserting their original spawn counts and stage event sequences
// without having to script an additional coherence-pass child.
let coherencePassDisabledByDefault = false;
export function __setCoherencePassDisabledByDefault(disabled: boolean): void {
  coherencePassDisabledByDefault = disabled;
}

function makeRunId(): string {
  return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * US-157: hex-encoded SHA-256 of a UTF-8 string. Used as the per-section
 * cache key written to the `<lessonSlug>-<sectionId>.wav.meta.json` sidecar
 * so that lesson regenerations skip the TTS spawn when the source text is
 * unchanged.
 */
export function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
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
  /**
   * US-141: when set, every raw stdout chunk is forwarded to this callback in
   * addition to the existing pumpStream pipeline. Used by the coherence-pass
   * stage to buffer the full markdown report alongside the live SSE log.
   */
  onStdoutChunk?: (chunk: string) => void;
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

  // Reject restart attempts within the cooldown window after a cancel. Lets
  // explicit Cancel actually stop the pipeline even when the UI or another
  // tab fires an idempotent /generate POST a few ms later.
  if (isInCancelCooldown(slug)) {
    throw new CancellationCooldownError(slug);
  }

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

/**
 * US-137: resume a partial run from a `.generation-state.json` snapshot.
 * Skips lessons whose status is already `done`, retries `inflight` /
 * `failed` / `pending` lessons with the remaining attempt budget computed
 * against `state.config.lessonMaxRetries`, and skips each of the two init
 * spawns (research_course, design_course) when its status is already
 * `done` in the snapshot.
 *
 * Throws `GenerationStateMissingError` when no state file is present.
 * Throws `GenerationConflictError` when a different slug is already in
 * flight. Same-slug already active → idempotent attach (returns the
 * existing run), mirroring enqueueGeneration's behaviour.
 *
 * Resume is a separate code path from enqueueGeneration: it never appends
 * to the FIFO queue and it skips the queue-promotion checks. The wizard
 * banner UI (US-140) explicitly chooses between this route and POST
 * /api/courses/generate based on whether the state file exists.
 */
export async function resumeGeneration(
  slug: string,
  depsArg: SpawnDeps = {},
): Promise<GenerationRun> {
  if (activeRun && !activeRun.finished && activeRun.slug === slug) {
    return activeRun;
  }
  if ((activeRun && !activeRun.finished) || startingGeneration) {
    throw new GenerationConflictError();
  }

  // Same cooldown gate as enqueueGeneration — blocks the resume-banner
  // path that fires automatically after Cancel.
  if (isInCancelCooldown(slug)) {
    throw new CancellationCooldownError(slug);
  }

  const state = await readGenerationState(slug);
  if (!state) {
    throw new GenerationStateMissingError();
  }

  startingGeneration = true;
  startingSlug = slug;

  try {
    return await startGenerationInner(slug, depsArg, { resumeFromState: state });
  } finally {
    startingGeneration = false;
    startingSlug = null;
  }
}

async function startGenerationInner(
  slug: string,
  depsArg: SpawnDeps,
  resumeOpts?: { resumeFromState: GenerationState },
): Promise<GenerationRun> {
  const deps: SpawnDeps = { ...(depsOverride ?? {}), ...depsArg };
  const resumeFromState = resumeOpts?.resumeFromState ?? null;

  const isExecutable = deps.isExecutableInPath ?? defaultIsExecutableInPath;
  if (!isExecutable('claude')) {
    throw new ClaudeUnavailableError();
  }

  const spawnFn = deps.spawn ?? defaultSpawn;
  const researchSpec = (deps.researchCourseCommand ?? defaultResearchCourseCommand)(slug);
  const designSpec = (deps.designCourseCommand ?? defaultDesignCourseCommand)(slug);
  const lessonCommand = deps.lessonCommand ?? defaultLessonCommand;
  const cwd = deps.cwd ?? process.cwd();
  const sigkillGraceMs = deps.sigkillGraceMs ?? 5000;
  // US-137: when resuming, pull retry/timeout config from the persisted state
  // file (the values frozen at run-1 start) so re-attempts are budgeted
  // consistently. Tests/explicit deps still win so the existing harness can
  // override per-test.
  const lessonMaxRetries =
    deps.lessonMaxRetries ??
    resumeFromState?.config.lessonMaxRetries ??
    parseNonNegativeInt(process.env.LESSON_MAX_RETRIES, 2);
  const lessonTimeoutMs =
    deps.lessonTimeoutMs ??
    resumeFromState?.config.lessonTimeoutMs ??
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

  // ── US-138: per-run seq + ndjson log bootstrap ───────────────────────────
  // A fresh pipeline truncates any prior `.generation-events.ndjson` so seq
  // restarts at 1. A resume keeps the file and seeds lastSeq from the max
  // seq found inside, so the counter continues monotonically across the
  // crash+resume boundary (clients reconnecting with a stale Last-Event-ID
  // can still replay events emitted by run #1 that haven't yet been overwritten).
  const eventsFile = eventsLogPath(slug);
  let initialSeq = 0;
  if (resumeFromState) {
    try {
      const raw = readFileSync(eventsFile, 'utf8');
      for (const line of raw.split('\n')) {
        if (line.length === 0) continue;
        try {
          const parsed = JSON.parse(line) as { seq?: unknown };
          if (typeof parsed.seq === 'number' && parsed.seq > initialSeq) {
            initialSeq = parsed.seq;
          }
        } catch {
          /* malformed line — ignore */
        }
      }
    } catch {
      /* ENOENT — no prior log; resume keeps initialSeq=0 */
    }
  } else {
    try {
      unlinkSync(eventsFile);
    } catch {
      /* ENOENT — fresh slug; nothing to truncate */
    }
  }

  const id = makeRunId();
  const events: GenerationEvent[] = [];
  const eventSeqs: number[] = [];
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
    lastSeq: initialSeq,
    eventSeqs,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async cancel() {
      if (run.finished) return;
      cancelled = true;
      // Record the cancel so enqueueGeneration/resumeGeneration reject
      // restart attempts that fire automatically within the cooldown.
      recentlyCancelledAt.set(slug, Date.now());
      const child = currentChild;
      if (!child || child.exitCode !== null) return;
      killChildTree(child, 'SIGTERM');
      if (!killTimer) {
        killTimer = setTimeout(() => {
          killChildTree(child, 'SIGKILL');
        }, sigkillGraceMs);
        // Don't keep the event loop alive just for the kill timer.
        if (typeof killTimer.unref === 'function') killTimer.unref();
      }
    },
  };

  function emit(event: GenerationEvent) {
    // US-138: assign the next monotonic seq before any persistence so
    // appends and listener notifications observe the same id. Increment on
    // run.lastSeq directly so external observers (the SSE handler) see the
    // up-to-date counter without a separate sync step.
    run.lastSeq += 1;
    const seq = run.lastSeq;
    // Persist BEFORE notifying listeners. appendFileSync is sync so the
    // ordering is "ndjson append → listener fan-out" within a single
    // event-loop tick — no concurrent emit can interleave (Node is
    // single-threaded). A partial write at crash truncates the trailing
    // line; the parser skips malformed lines, which is the documented
    // contract for this log.
    try {
      const ndjsonLine = `${JSON.stringify({
        seq,
        timestamp: new Date().toISOString(),
        event,
      })}\n`;
      appendFileSync(eventsFile, ndjsonLine, 'utf8');
      // Cheap rotation check — fs.statSync is one syscall on the same path
      // we just wrote to, so the inode is hot in cache. atomicRenameSync
      // is POSIX-atomic; the next emit's appendFileSync will create a
      // fresh active file at the same path.
      const stat = statSync(eventsFile);
      if (stat.size > eventsLogRotateBytes()) {
        // Stamp comes from now() rather than the run's startedAt so two
        // rotations within a single run produce distinct filenames; ISO
        // chars that are invalid in a filename are flattened to dashes,
        // and the seq is appended so two rotations that land in the same
        // millisecond still resolve to distinct paths (otherwise the
        // second rename would silently overwrite the first via POSIX
        // rename-replace semantics, costing forensics data).
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedPath = path.join(
          courseDir(slug),
          `.generation-events.${stamp}.${seq}.ndjson`,
        );
        try {
          atomicRenameSync(eventsFile, rotatedPath);
        } catch {
          /* best-effort — rotation is forensics-only, not load-bearing */
        }
      }
    } catch {
      /* best-effort — events log is a recovery aid, never blocks the run */
    }
    events.push(event);
    eventSeqs.push(seq);
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
        listener(event, seq);
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
        // Start child in its own process group/session so killChildTree
        // can signal -pid and reach every descendant (claude → Bash → …).
        // Without detached, SIGTERM only hits the top-level claude.
        detached: true,
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
      // US-141: attach the raw-stdout-chunk listener BEFORE pumpStream so the
      // coherence-pass stage can buffer the full markdown report alongside the
      // existing line-buffered SSE log pipeline. Multiple `data` listeners on
      // a Node Readable all receive each chunk — fan-out is safe.
      if (opts.onStdoutChunk) {
        const cb = opts.onStdoutChunk;
        child.stdout?.on('data', (chunk: Buffer | string) => {
          cb(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        });
      }
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
          killChildTree(child, 'SIGTERM');
          if (!killTimer) {
            killTimer = setTimeout(() => {
              killChildTree(child, 'SIGKILL');
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
    coherenceReportPath?: string,
  ) {
    if (run.finished) return;
    run.finished = true;
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }
    if (kind === 'done') {
      const ev: GenerationEvent = { type: 'done', courseSlug: slug, failedLessons };
      // US-141: attach the coherence-report path only when the stage actually
      // produced one. AC: when coherence-pass fails the field is absent and
      // the failure is visible only in the SSE event log.
      if (coherenceReportPath) ev.coherenceReportPath = coherenceReportPath;
      emit(ev);
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
    // US-136: only the clean-success path removes the .generation-state.json
    // file. A done-with-failed-lessons run or an error run leaves it on disk
    // as the resume target (US-137 / US-140).
    if (kind === 'done' && failedLessons.length === 0) {
      void deleteGenerationState(slug);
    }
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

  // US-136: in-memory mirror of the per-course .generation-state.json file.
  // Mutated in lockstep with stage transitions and persisted via
  // persistGenState() so a server restart can recover exact lesson status.
  let genState: GenerationState | null = null;

  async function persistGenState() {
    if (!genState) return;
    try {
      await writeGenerationState(slug, genState);
    } catch {
      /* best-effort — state file is a recovery aid, not load-bearing */
    }
  }

  function findLessonState(lessonSlug: string) {
    return genState?.lessons.find((l) => l.slug === lessonSlug);
  }

  // Persist a terminal failure for one of the two init stages. The other
  // stage stays 'pending' (a failed research means design never even ran).
  // Resume from the persisted state restarts from whichever stage is not
  // 'done' — see the Stage 1 / Stage 2 blocks below.
  async function markInitStageFailed(
    stage: 'research' | 'design',
    reason: string,
  ) {
    if (genState) {
      genState[stage] = { status: 'failed', reason };
    } else {
      genState = {
        schemaVersion: 1,
        slug,
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        research:
          stage === 'research'
            ? { status: 'failed', reason }
            : { status: 'pending' },
        design:
          stage === 'design'
            ? { status: 'failed', reason }
            : { status: 'pending' },
        lessons: [],
        config: { lessonMaxRetries, lessonTimeoutMs },
      };
    }
    await persistGenState();
  }

  /**
   * US-157: run the TTS post-processing pass over a sentinel-validated lesson.
   * For each AudioPlayer / transcriptCloze section whose `audioPath` is the
   * AUTO_TTS sentinel, derive the source text (transcript for transcriptCloze;
   * audioSourceText for AudioPlayer), check the per-section content-hash
   * sidecar at `<lessonSlug>-<sectionId>.wav.meta.json` to short-circuit when
   * the same source already produced a cached .wav, otherwise call the TTS
   * callable, copy the resulting audio into the course's assets/audio dir,
   * and refresh the sidecar. Returns the post-processed lesson with all
   * sentinels replaced and `audioSourceText` stripped — ready to be written
   * to disk and re-validated against the public LessonSchema.
   */
  async function runTtsPostProcessing(
    courseSlug: string,
    lessonSlug: string,
    lesson: LessonWithSentinel,
  ): Promise<
    | { ok: true; lesson: Lesson }
    | { ok: false; error: string; sectionId: string }
  > {
    const ttsCallable = deps.runTts ?? defaultRunTts;
    const audioDir = path.join(courseDir(courseSlug), 'assets', 'audio');

    // Deep clone so per-section mutations don't alias the parsed input — keeps
    // the function pure-ish from the caller's perspective.
    const out = JSON.parse(JSON.stringify(lesson)) as LessonWithSentinel;

    for (const section of out.sections) {
      if (section.type !== 'audioPlayer' && section.type !== 'transcriptCloze') {
        continue;
      }
      const data = section.data as {
        audioPath: string;
        transcript?: string;
        audioSourceText?: string;
      };
      if (data.audioPath !== AUTO_TTS_SENTINEL) {
        // Section already has a real path — nothing to do. Strip any leaked
        // audioSourceText from AudioPlayer sections so it doesn't survive to
        // the public-schema validation step.
        if ('audioSourceText' in data) {
          delete (data as { audioSourceText?: string }).audioSourceText;
        }
        continue;
      }

      // Derive the source text per AC: transcript for transcriptCloze,
      // audioSourceText for AudioPlayer.
      const sourceText =
        section.type === 'transcriptCloze'
          ? data.transcript
          : data.audioSourceText;
      if (typeof sourceText !== 'string' || sourceText.trim().length === 0) {
        const which =
          section.type === 'transcriptCloze' ? 'transcript' : 'audioSourceText';
        return {
          ok: false,
          error: `Section ${section.id} has audioPath: 'AUTO_TTS' but no usable ${which} field to feed the TTS engine`,
          sectionId: section.id,
        };
      }

      emit({
        type: 'tts',
        lessonSlug,
        sectionId: section.id,
        status: 'started',
      });

      const fileName = `${lessonSlug}-${section.id}.wav`;
      const absoluteWavPath = path.join(audioDir, fileName);
      const metaPath = `${absoluteWavPath}.meta.json`;
      const relativePath = `assets/audio/${fileName}`;
      const newHash = sha256Hex(sourceText);

      // Cache check: if the wav AND its sidecar exist AND the recorded hash
      // matches the current source text, reuse the file untouched.
      let cacheHit = false;
      try {
        await fs.access(absoluteWavPath);
        const metaRaw = await fs.readFile(metaPath, 'utf8');
        const meta = JSON.parse(metaRaw) as { contentHash?: unknown };
        if (typeof meta.contentHash === 'string' && meta.contentHash === newHash) {
          cacheHit = true;
        }
      } catch {
        cacheHit = false;
      }

      if (!cacheHit) {
        let result: RunTtsResult;
        try {
          result = await ttsCallable({
            text: sourceText,
            voice: DEFAULT_TTS_VOICE,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emit({
            type: 'tts',
            lessonSlug,
            sectionId: section.id,
            status: 'failed',
            errorMessage: msg,
          });
          return { ok: false, error: msg, sectionId: section.id };
        }
        try {
          await fs.mkdir(audioDir, { recursive: true });
          await fs.copyFile(result.absolutePath, absoluteWavPath);
          await fs.writeFile(
            metaPath,
            JSON.stringify({ contentHash: newHash }),
            'utf8',
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emit({
            type: 'tts',
            lessonSlug,
            sectionId: section.id,
            status: 'failed',
            errorMessage: msg,
          });
          return { ok: false, error: msg, sectionId: section.id };
        }
      }

      // Replace sentinel with real relative path; strip audioSourceText.
      data.audioPath = relativePath;
      if ('audioSourceText' in data) {
        delete (data as { audioSourceText?: string }).audioSourceText;
      }

      emit({
        type: 'tts',
        lessonSlug,
        sectionId: section.id,
        status: 'done',
      });
    }

    // The shape now matches the public Lesson — discriminator + non-sentinel
    // audioPaths + no extra fields. The caller re-validates with LessonSchema
    // before write so any drift becomes a hard fail rather than a silent
    // strip.
    return { ok: true, lesson: out as unknown as Lesson };
  }

  async function runLesson(
    lessonSlug: string,
    opts: { maxAttemptsOverride?: number; seedRetryReason?: string } = {},
  ): Promise<{ success: boolean; attempts: number; lastError: string }> {
    const stageName = `lesson:${lessonSlug}`;
    emit({ type: 'stage', name: stageName, status: 'started' });

    const lessonLogPath = path.join(genLogs, `${lessonSlug}.log`);
    const maxAttempts = opts.maxAttemptsOverride ?? lessonMaxRetries + 1;
    let lastError = opts.seedRetryReason ?? '';
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
      // US-137: also drop any `<lessonSlug>.tmp` left behind by an
      // atomic-write crash (best-effort, ignore ENOENT). The companion
      // `<lessonSlug>.json` is handled by the unlink above; this only
      // targets the `.tmp` variant. Sibling lesson files (other slugs) are
      // never touched.
      try {
        await fs.unlink(
          path.join(courseDir(slug), 'lessons', `${lessonSlug}.tmp`),
        );
      } catch {
        /* no stale tmp — ignore */
      }

      // US-136: mark the lesson inflight + bump attempts BEFORE the spawn so
      // a kill-9 between this point and the post-spawn validation block still
      // leaves the state file consistent with the work that was attempted.
      const ls = findLessonState(lessonSlug);
      if (ls) {
        ls.status = 'inflight';
        ls.attempts = ls.attempts + 1;
        await persistGenState();
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
      //
      // US-157: the agent may emit AudioPlayer / transcriptCloze sections with
      // `audioPath: 'AUTO_TTS'` to defer audio synthesis to a server-side TTS
      // pass. We first validate against the sentinel-friendly schema, run the
      // TTS post-processor (which replaces the sentinel with a real relative
      // path, copies the .wav into the course's assets dir, and writes a
      // content-hash sidecar for cache reuse), then re-validate against the
      // strict public LessonSchema before considering the attempt successful.
      // If TTS fails, the partial lesson file is removed so no AUTO_TTS
      // placeholder lands on disk; the attempt is marked failed and (per AC)
      // the failure surfaces to the user via the normal failedLessons flow.
      try {
        const raw = await fs.readFile(lessonFile(slug, lessonSlug), 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        const sentinelResult = LessonSchemaWithSentinel.safeParse(parsed);
        if (!sentinelResult.success) {
          lastError = sentinelResult.error.message;
          continue;
        }
        const ttsOutcome = await runTtsPostProcessing(
          slug,
          lessonSlug,
          sentinelResult.data,
        );
        if (!ttsOutcome.ok) {
          // Remove the partial lesson file — it still carries AUTO_TTS
          // placeholders and would corrupt subsequent reads.
          try {
            await fs.unlink(lessonFile(slug, lessonSlug));
          } catch {
            /* file may already be gone — ignore */
          }
          try {
            await fs.unlink(
              path.join(courseDir(slug), 'lessons', `${lessonSlug}.tmp`),
            );
          } catch {
            /* no stale tmp — ignore */
          }
          lastError = `TTS post-processing failed: ${ttsOutcome.error}`;
          continue;
        }
        // Final write — re-validate with the strict public schema so we
        // never persist a lesson with the sentinel.
        LessonSchema.parse(ttsOutcome.lesson);
        // Asset-presence gate: two failure modes block 'done' here.
        // 1. A local `/api/courses/<slug>/assets/...` path that doesn't exist
        //    on disk would 404 from the assets route and render as a broken
        //    `<img>`.
        // 2. An external `http(s)://` URL in an image position must be cached
        //    locally so the course stays offline-viewable and resilient to
        //    link rot — agents are not allowed to leave Wikipedia / CDN URLs
        //    in inline theory images, plotImage.src, demo.imageSrc, code
        //    inputs/outputMedia, or mp4 video.src.
        // Either failure feeds the issue list back into the retry brief so
        // the agent knows what to materialize or download before declaring
        // done.
        const assetIssues = await findLessonAssetIssues(
          ttsOutcome.lesson,
          slug,
        );
        if (assetIssues.length > 0) {
          lastError = formatAssetIssuesError(assetIssues);
          continue;
        }
        await atomicWriteJson(lessonFile(slug, lessonSlug), ttsOutcome.lesson);
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
    // US-136: persist the lesson's terminal status (done | failed) before
    // returning so the in-memory FailedReport bookkeeping and the on-disk
    // state file agree.
    const ls = findLessonState(lessonSlug);
    if (ls) {
      if (success) {
        ls.status = 'done';
        ls.finishedAt = new Date().toISOString();
        delete ls.lastError;
      } else {
        ls.status = 'failed';
        ls.lastError = lastError;
      }
      await persistGenState();
    }
    if (success) {
      emit({ type: 'stage', name: stageName, status: 'done' });
    } else {
      emit({ type: 'stage', name: stageName, status: 'error' });
    }
    return { success, attempts: attemptsRun, lastError };
  }

  /**
   * US-141: run the final coherence-pass stage. Returns the relative path
   * (`'coherence-report.md'`) on success, `undefined` on failure / timeout
   * (with the placeholder text on disk only in the RALPH-orchestrated
   * timeout case). Always emits stage:started + a terminal stage:done /
   * stage:error so the live log surfaces the pass.
   */
  async function runCoherencePass(): Promise<string | undefined> {
    const stageName = 'coherence-pass';
    emit({ type: 'stage', name: stageName, status: 'started' });

    const factory = deps.coherencePassCommand ?? defaultCoherencePassCommand;
    const spec = factory(slug);

    const ralphMode = isRalphOrchestrated();
    const reportPath = path.join(courseDir(slug), 'coherence-report.md');
    const coherenceLogPath = path.join(genLogs, 'coherence-pass.log');
    const coherenceLogStream = createWriteStream(coherenceLogPath, { flags: 'w' });
    coherenceLogStream.on('error', () => {
      /* swallow late writes */
    });

    let stdoutBuf = '';
    const ralphTimeoutMs = deps.coherencePassTimeoutMs ?? 30_000;
    const result = await spawnChild(spec, {
      // 30s cap when running headless inside a ralph orchestrator iteration
      // so we never blow the iteration budget on a stuck claude. No cap in
      // user-driven mode — the report can take whatever it takes. Tests can
      // override the cap via deps.coherencePassTimeoutMs to exercise the
      // placeholder path without waiting wall-clock seconds.
      timeoutMs: ralphMode ? ralphTimeoutMs : undefined,
      extraLogStream: coherenceLogStream,
      onStdoutChunk: (chunk) => {
        stdoutBuf += chunk;
      },
    });
    coherenceLogStream.end();

    if (cancelled) {
      // Run was cancelled while the coherence stage was in flight; emit a
      // terminal error and skip the file write — the SSE error event will
      // surface the cancellation.
      emit({ type: 'stage', name: stageName, status: 'error' });
      return undefined;
    }

    if (result.timedOut) {
      // RALPH mode only — no other code path sets a timeout. Write the
      // placeholder text per AC so the failure is visible without forcing a
      // re-run; emit stage:error so the live log shows it.
      const placeholder = 'Coherence pass timed out — re-run generation to retry.\n';
      try {
        await fs.writeFile(reportPath, placeholder, 'utf8');
      } catch {
        /* best-effort */
      }
      emit({ type: 'stage', name: stageName, status: 'error' });
      return undefined;
    }

    if (result.exit !== 0 || stdoutBuf.trim().length === 0) {
      // Non-zero exit OR an empty stdout (claude printed nothing). Either
      // way the report would be useless; emit stage:error and skip the
      // file write. No `coherenceReportPath` is returned so the `done`
      // event omits the field per AC.
      emit({ type: 'stage', name: stageName, status: 'error' });
      return undefined;
    }

    try {
      await fs.writeFile(reportPath, stdoutBuf, 'utf8');
    } catch {
      emit({ type: 'stage', name: stageName, status: 'error' });
      return undefined;
    }
    emit({ type: 'stage', name: stageName, status: 'done' });
    return 'coherence-report.md';
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
    // ── US-137: Resume hydration ────────────────────────────────────────────
    // The 'resumed' event MUST be the first event the SSE consumer sees so
    // the wizard can hydrate its lesson-status panel in one round-trip
    // before any per-lesson stage:started events start arriving.
    if (resumeFromState) {
      const completed = resumeFromState.lessons
        .filter((l) => l.status === 'done')
        .map((l) => l.slug);
      const remaining = resumeFromState.lessons
        .filter((l) => l.status !== 'done')
        .map((l) => l.slug);
      // The wizard's "currently attempting" slot is meaningful only once the
      // init pipeline is past design_course (so course.json exists and the
      // lesson loop is the natural next step). If either init stage is still
      // pending/failed we surface no inflight lesson.
      const initDone =
        resumeFromState.research.status === 'done' &&
        resumeFromState.design.status === 'done';
      const inflightSlug = initDone ? remaining[0] ?? null : null;
      emit({ type: 'resumed', completed, remaining, inflightSlug });
    }

    // ── Stage 1: research_course ────────────────────────────────────────────
    // Writes /courses/<slug>/research.md and /courses/<slug>/sources.md.
    // Skipped on resume when already done; runs every other time.
    if (!(resumeFromState && resumeFromState.research.status === 'done')) {
      emit({ type: 'stage', name: 'research_course', status: 'started' });
      const researchLogPath = path.join(genLogs, 'research_course.log');
      const researchLogStream = createWriteStream(researchLogPath, { flags: 'w' });
      researchLogStream.on('error', () => {
        /* swallow late writes */
      });
      const researchResult = await spawnChild(researchSpec, {
        extraLogStream: researchLogStream,
      });
      researchLogStream.end();
      if (cancelled) {
        emit({ type: 'stage', name: 'research_course', status: 'error' });
        await markInitStageFailed('research', 'Cancelled by user');
        finalize('error', 'Cancelled by user');
        return;
      }
      if (researchResult.exit !== 0) {
        emit({ type: 'stage', name: 'research_course', status: 'error' });
        const reason = `research_course failed (exit ${researchResult.exit})`;
        await markInitStageFailed('research', reason);
        finalize('error', reason);
        return;
      }
      // Post-research guard: claude in -p mode silently no-ops on prompts it
      // doesn't understand (printing "Unknown command:" and exiting 0). If
      // research.md is missing, design_course has nothing to read — bail out
      // before its spawn. We do not validate sources.md schema-wise (it has
      // no schema), but we do require it to exist as a basic sanity check.
      try {
        await fs.access(path.join(courseDir(slug), 'research.md'));
      } catch {
        emit({ type: 'stage', name: 'research_course', status: 'error' });
        const reason =
          'research_course did not produce research.md — check .generation.log';
        await markInitStageFailed('research', reason);
        finalize('error', reason);
        return;
      }
      try {
        await fs.access(path.join(courseDir(slug), 'sources.md'));
      } catch {
        emit({ type: 'stage', name: 'research_course', status: 'error' });
        const reason =
          'research_course did not produce sources.md — check .generation.log';
        await markInitStageFailed('research', reason);
        finalize('error', reason);
        return;
      }
      // Seed genState with research done; design's status carries over
      // from the resume snapshot (pending on a fresh run, possibly
      // failed/pending from a prior crashed run). Reaching this point
      // means none of the early-return guards above fired, so genState
      // is guaranteed to still be its initial `null` — no need to merge
      // with an in-memory predecessor.
      genState = {
        schemaVersion: 1,
        slug,
        startedAt: resumeFromState?.startedAt ?? new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        research: { status: 'done' },
        design: resumeFromState?.design ?? { status: 'pending' },
        lessons: resumeFromState?.lessons ?? [],
        config: { lessonMaxRetries, lessonTimeoutMs },
      };
      await persistGenState();
      emit({ type: 'stage', name: 'research_course', status: 'done' });
    }

    // ── Stage 2: design_course ──────────────────────────────────────────────
    // Reads research.md + sources.md + course-spec.json + uploads, writes
    // course.json. On resume-with-design-already-done we skip the spawn and
    // hydrate the lesson list directly from the persisted state.
    let lessons: { slug: string; moduleId: string }[];
    if (resumeFromState && resumeFromState.design.status === 'done') {
      // Hydrate genState from the persisted snapshot (deep clone so per-loop
      // mutations don't alias the caller's state object).
      genState = JSON.parse(JSON.stringify(resumeFromState)) as GenerationState;
      // Make sure research stays marked done in the hydrated state — if we
      // ran the research stage above (because it was failed/pending) and the
      // hydrated snapshot still claims otherwise, prefer the in-flight truth.
      genState.research = { status: 'done' };
      // Use the persisted lesson order — it was derived from course.json on
      // run #1 and is the authoritative resume order per the AC.
      lessons = resumeFromState.lessons.map((l) => ({ slug: l.slug, moduleId: '' }));
    } else {
      emit({ type: 'stage', name: 'design_course', status: 'started' });
      const designLogPath = path.join(genLogs, 'design_course.log');
      const designLogStream = createWriteStream(designLogPath, { flags: 'w' });
      designLogStream.on('error', () => {
        /* swallow late writes */
      });
      const designResult = await spawnChild(designSpec, {
        extraLogStream: designLogStream,
      });
      designLogStream.end();
      if (cancelled) {
        emit({ type: 'stage', name: 'design_course', status: 'error' });
        await markInitStageFailed('design', 'Cancelled by user');
        finalize('error', 'Cancelled by user');
        return;
      }
      if (designResult.exit !== 0) {
        emit({ type: 'stage', name: 'design_course', status: 'error' });
        const reason = `design_course failed (exit ${designResult.exit})`;
        await markInitStageFailed('design', reason);
        finalize('error', reason);
        return;
      }
      // Post-design guard: same silent-no-op risk as research; bail out if
      // course.json is missing or invalid so the per-lesson loop never tries
      // to read a file that's not there.
      let courseRaw: string;
      try {
        courseRaw = await fs.readFile(courseFile(slug), 'utf8');
      } catch {
        emit({ type: 'stage', name: 'design_course', status: 'error' });
        const reason =
          'design_course did not produce course.json — check .generation.log';
        await markInitStageFailed('design', reason);
        finalize('error', reason);
        return;
      }
      let course;
      try {
        course = CourseSchema.parse(JSON.parse(courseRaw));
      } catch (err) {
        emit({ type: 'stage', name: 'design_course', status: 'error' });
        const detail = err instanceof Error ? err.message : String(err);
        const reason = `design_course produced invalid course.json: ${detail}`;
        await markInitStageFailed('design', reason);
        finalize('error', reason);
        return;
      }
      // US-136 / US-137: write/refresh the .generation-state.json now that we
      // have a validated course.json. On resume-with-design-not-done, MERGE
      // the existing per-lesson status by slug so attempt counts from before
      // the crash carry over; lessons that no longer appear in course.json
      // are dropped, and lessons newly introduced by design come in as fresh
      // pending entries.
      const mergedLessons = course.modules.flatMap((m) =>
        m.lessons.map((l) => {
          const prior = resumeFromState?.lessons.find((s) => s.slug === l.slug);
          if (prior) {
            return { ...prior };
          }
          return { slug: l.slug, status: 'pending' as const, attempts: 0 };
        }),
      );
      genState = {
        schemaVersion: 1,
        slug,
        startedAt: resumeFromState?.startedAt ?? new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        research: { status: 'done' },
        design: { status: 'done' },
        lessons: mergedLessons,
        config: { lessonMaxRetries, lessonTimeoutMs },
      };
      await persistGenState();
      emit({ type: 'stage', name: 'design_course', status: 'done' });

      lessons = course.modules.flatMap((m) =>
        m.lessons.map((l) => ({ slug: l.slug, moduleId: m.id })),
      );
    }

    // ── Stage 3..N+2: one (retried) claude call per lesson, sequentially ───
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
      const existingState = findLessonState(lesson.slug);

      // US-139: stale-tmp cleanup runs on every iteration regardless of
      // validity outcome. Covers the case where both `<lessonSlug>.json`
      // (valid) AND `<lessonSlug>.tmp` exist — the .tmp is dropped no matter
      // what the validity check returns.
      try {
        await fs.unlink(
          path.join(courseDir(slug), 'lessons', `${lesson.slug}.tmp`),
        );
      } catch {
        /* no stale tmp — ignore */
      }

      // US-139: defensive idempotency guard. If the lesson file already
      // parses + validates against LessonSchema, mark it done and skip the
      // claude -p spawn entirely. Protects against wasted token spend on
      // resumes (US-137), manual file copies, partial-success replays, or
      // any other case where the file already represents valid work.
      const validity = await isLessonAlreadyValid(slug, lesson.slug);
      if (validity.valid) {
        const stageName = `lesson:${lesson.slug}`;
        emit({ type: 'stage', name: stageName, status: 'started' });
        if (existingState) {
          existingState.status = 'done';
          existingState.attempts = 0;
          existingState.finishedAt = new Date().toISOString();
          delete existingState.lastError;
          await persistGenState();
        }
        emit({ type: 'stage', name: stageName, status: 'done' });
        emit({ type: 'progress', current: i + 1, total });
        continue;
      }

      // US-137: legacy fallback for state that claims `done` while the lesson
      // file is missing/corrupt — preserve the pre-US-139 silent-skip behaviour
      // rather than silently re-spawning. In practice US-139's validity check
      // above will already have returned `{valid:true}` when the file is
      // healthy, so this branch only fires for a state-vs-disk mismatch.
      if (existingState?.status === 'done') {
        emit({ type: 'progress', current: i + 1, total });
        continue;
      }

      // US-137: compute the remaining attempt budget. When 0, mark the
      // lesson failed in state without spawning so the wizard's failed
      // panel surfaces it like any other exhausted lesson.
      const remaining = existingState
        ? Math.max(0, lessonMaxRetries + 1 - existingState.attempts)
        : lessonMaxRetries + 1;

      if (remaining === 0) {
        const reason = existingState?.lastError ?? 'Retry budget exhausted';
        const stageName = `lesson:${lesson.slug}`;
        emit({ type: 'stage', name: stageName, status: 'started' });
        if (existingState) {
          existingState.status = 'failed';
          if (!existingState.lastError) existingState.lastError = reason;
          await persistGenState();
        }
        emit({ type: 'stage', name: stageName, status: 'error' });
        failedLessons.push({ slug: lesson.slug, reason });
        failedReport.push({
          lessonSlug: lesson.slug,
          attempts: existingState?.attempts ?? 0,
          lastError: reason,
          logPath: `logs/${lesson.slug}.log`,
        });
        emit({ type: 'progress', current: i + 1, total });
        continue;
      }

      const result = await runLesson(lesson.slug, {
        maxAttemptsOverride: remaining,
        seedRetryReason: existingState?.lastError,
      });

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

    // ── US-141: Final stage — coherence pass ───────────────────────────────
    // Best-effort cross-lesson audit AFTER every per-lesson generate_lesson
    // succeeded AND each lesson is on disk + valid (the existing US-139
    // logic is the gate that brought us here without entries in
    // failedLessons). Failure of this stage does NOT mark the course
    // generation as failed — the report is best-effort. Skipped entirely
    // when:
    //   - the run was cancelled mid-loop (cancelled flag),
    //   - any per-lesson stage failed (failedLessons non-empty — partial
    //     coverage would produce a misleading audit),
    //   - the course has zero lessons,
    //   - the caller explicitly disabled it via SpawnDeps.disableCoherencePass
    //     (used by tests that don't want to script another child).
    let coherenceReportPath: string | undefined;
    const disableCoherence =
      deps.disableCoherencePass ?? coherencePassDisabledByDefault;
    if (
      !cancelled &&
      !disableCoherence &&
      failedLessons.length === 0 &&
      total > 0
    ) {
      coherenceReportPath = await runCoherencePass();
    }
    finalize('done', undefined, failedLessons, coherenceReportPath);
  })();

  pipeline.catch((err) => {
    finalize('error', err instanceof Error ? err.message : String(err));
  });

  return run;
}

export function sseEncode(event: GenerationEvent): Uint8Array {
  return new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}
