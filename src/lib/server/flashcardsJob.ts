// On-demand flashcards for a course that already exists (generated before
// the flashcards stage, or whose stage failed). Runs the same per-module
// generate_flashcards agent as the pipeline, in the background, one module
// at a time; the UI polls GET /api/courses/<slug>/flashcards for progress.
//
// Jobs live in memory (on globalThis so dev-server HMR doesn't orphan a
// running job); the module files on disk are the durable result, so a
// server restart mid-job just means the user clicks "Generate" again and the
// already-written modules are skipped.

import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';

import type { FlashcardsJobStatus } from '@/lib/schemas/flashcards';
import { readCourse } from './courses';
import {
  defaultFlashcardsCommand,
  modulesWithLessons,
  readModuleFlashcards,
  writeCourseApkg,
} from './flashcards';
import { formatStreamJsonLine, getActiveRunSummary } from './generation';
import { courseSpecFile, genLogsDir } from './paths';
import { loadSecretsEnv } from './secrets';

interface Job {
  status: FlashcardsJobStatus;
  child: ChildProcess | null;
}

const globalKey = '__aiLecturerFlashcardsJobs';
function jobs(): Map<string, Job> {
  const g = globalThis as unknown as Record<string, Map<string, Job> | undefined>;
  g[globalKey] ??= new Map();
  return g[globalKey];
}

export class FlashcardsJobConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlashcardsJobConflictError';
  }
}

export interface FlashcardsJobDeps {
  spawn?: typeof defaultSpawn;
  command?: typeof defaultFlashcardsCommand;
  timeoutMs?: number;
  maxAttempts?: number;
}

export function getFlashcardsJob(slug: string): FlashcardsJobStatus | null {
  return jobs().get(slug)?.status ?? null;
}

export function __resetFlashcardsJobsForTesting(): void {
  jobs().clear();
}

async function isQuizOnlyCourse(slug: string, tags: string[] | undefined): Promise<boolean> {
  if (tags?.includes('quiz')) return true;
  try {
    const spec = JSON.parse(await fs.readFile(courseSpecFile(slug), 'utf8')) as { tags?: unknown };
    return Array.isArray(spec.tags) && spec.tags.includes('quiz');
  } catch {
    return false;
  }
}

/**
 * Start generating flashcards for every module that has lessons but no valid
 * flashcards file (`regenerate: true` → every module; the agent keeps card
 * ids of the existing file so Anki updates instead of duplicating).
 * Resolves once the job is registered; the work continues in the background.
 */
export async function startFlashcardsJob(
  slug: string,
  opts: { regenerate?: boolean } = {},
  deps: FlashcardsJobDeps = {},
): Promise<FlashcardsJobStatus> {
  if (jobs().get(slug)?.status.state === 'running') {
    throw new FlashcardsJobConflictError('Flashcards are already being generated for this course');
  }
  const active = await getActiveRunSummary();
  if (active.active && active.slug === slug) {
    throw new FlashcardsJobConflictError('Cannot generate flashcards while the course is being generated');
  }
  const course = await readCourse(slug);
  if (!course) throw new Error('Course not found');

  const candidates = await modulesWithLessons(slug, course);
  const todo = [];
  for (const mod of candidates) {
    if (opts.regenerate || !(await readModuleFlashcards(slug, mod.id)).ok) todo.push(mod);
  }

  const job: Job = {
    status: { state: 'running', current: 0, total: todo.length, failedModules: [] },
    child: null,
  };
  jobs().set(slug, job);

  const isQuizOnly = await isQuizOnlyCourse(slug, course.tags);
  void runJob(slug, todo, job, isQuizOnly, deps);
  return job.status;
}

async function runJob(
  slug: string,
  modules: { id: string; title: string }[],
  job: Job,
  isQuizOnly: boolean,
  deps: FlashcardsJobDeps,
): Promise<void> {
  const spawnFn = deps.spawn ?? defaultSpawn;
  const command = deps.command ?? defaultFlashcardsCommand;
  const timeoutMs = deps.timeoutMs ?? 1800 * 1000;
  const maxAttempts = deps.maxAttempts ?? 2;
  const extraEnv = loadSecretsEnv();

  await fs.mkdir(genLogsDir(slug), { recursive: true });
  const log = createWriteStream(path.join(genLogsDir(slug), 'flashcards.log'), { flags: 'w' });
  log.on('error', () => {
    /* best-effort log */
  });
  const writeLog = (line: string) => log.write(`${line}\n`);

  let lastFailure: string | undefined;
  try {
    for (const mod of modules) {
      let reason: string | undefined;
      let ok = false;
      for (let attempt = 1; attempt <= maxAttempts && !ok; attempt++) {
        writeLog(`── ${mod.id} (${mod.title}) — attempt ${attempt}/${maxAttempts}`);
        const spec = command(slug, mod.id, reason, isQuizOnly);
        const result = await runChild(spawnFn, spec, { ...process.env, ...extraEnv }, timeoutMs, job, writeLog);
        if (result.timedOut) {
          reason = `Timed out after ${Math.round(timeoutMs / 1000)}s`;
          continue;
        }
        const check = await readModuleFlashcards(slug, mod.id);
        if (check.ok) {
          ok = true;
        } else {
          reason =
            result.exit !== 0
              ? `claude exited with code ${result.exit}${result.lastLine ? ` — ${result.lastLine}` : ''}`
              : check.reason;
          writeLog(`!! ${reason}`);
        }
      }
      if (!ok) {
        job.status.failedModules.push(mod.id);
        lastFailure = reason;
      }
      job.status.current += 1;
    }
    await writeCourseApkg(slug);
    job.status.state = job.status.failedModules.length === 0 ? 'done' : 'error';
    if (job.status.failedModules.length > 0) {
      // Surface the agent's own last words (e.g. "Failed to authenticate…")
      // so the sidebar says why, not just that it failed.
      job.status.message = `Flashcards failed for ${job.status.failedModules.length} module(s): ${lastFailure ?? 'see logs/flashcards.log'}`;
    }
  } catch (err) {
    job.status.state = 'error';
    job.status.message = err instanceof Error ? err.message : String(err);
    writeLog(`!! ${job.status.message}`);
  } finally {
    job.child = null;
    log.end();
  }
}

function runChild(
  spawnFn: typeof defaultSpawn,
  spec: { command: string; args: string[] },
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  job: Job,
  writeLog: (line: string) => void,
): Promise<{ exit: number; timedOut: boolean; lastLine?: string }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(spec.command, spec.args, {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    } catch (err) {
      writeLog(`spawn failed: ${(err as Error).message}`);
      resolve({ exit: -1, timedOut: false });
      return;
    }
    job.child = child;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    let buf = '';
    // Last human-readable output line, skipping "[system …]" / "[result …]"
    // lifecycle markers — on failure it usually names the cause.
    let lastLine: string | undefined;
    const log = (out: string) => {
      writeLog(out);
      if (out.trim() && !/^\[[a-z_ ]/.test(out)) lastLine = out.trim().slice(0, 300);
    };
    const onData = (chunk: Buffer | string) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        for (const out of formatStreamJsonLine(line)) log(out);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', (err) => writeLog(`error: ${err.message}`));
    child.once('close', (code) => {
      clearTimeout(timer);
      if (buf.length > 0) for (const out of formatStreamJsonLine(buf)) log(out);
      resolve({ exit: code ?? -1, timedOut, lastLine });
    });
  });
}
