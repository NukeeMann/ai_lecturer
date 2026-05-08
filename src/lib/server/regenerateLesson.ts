// Server-only helper that spawns the `regenerate_lesson` agent and parses
// its stdout. Used by POST /api/courses/<slug>/lessons/<lessonSlug>/
// regenerate (US-148). The agent receives the full course schema, the
// current full Lesson JSON, and a free-text instruction; it emits a single
// JSON object on stdout matching `RegenerateLessonResponseSchema`. This
// helper is read-only — snapshotting + persistence live in the route.

import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import {
  RegenerateLessonResponseSchema,
  type RegenerateLessonResponse,
} from '@/lib/schemas/regenerateLesson';
import type { Course } from '@/lib/schemas/course';
import type { Lesson } from '@/lib/schemas/lesson';

export class RegenerateLessonAgentParseError extends Error {
  /** Raw stdout from the agent, truncated to ~2KB for surfacing to the client. */
  readonly rawOutput: string;
  /** Underlying parse / Zod failure surfaced for telemetry. */
  readonly cause: unknown;
  constructor(rawOutput: string, cause: unknown) {
    super('Failed to parse regenerate_lesson agent output');
    this.name = 'RegenerateLessonAgentParseError';
    this.rawOutput = rawOutput;
    this.cause = cause;
  }
}

export class RegenerateLessonAgentSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegenerateLessonAgentSpawnError';
  }
}

const STDOUT_TRUNCATE_BYTES = 2048;

export function truncateForError(raw: string): string {
  if (raw.length <= STDOUT_TRUNCATE_BYTES) return raw;
  return `${raw.slice(0, STDOUT_TRUNCATE_BYTES)}…[truncated ${raw.length - STDOUT_TRUNCATE_BYTES}B]`;
}

export interface RegenerateLessonSpawnDeps {
  spawn?: typeof defaultSpawn;
}

let depsOverride: RegenerateLessonSpawnDeps | null = null;

/** Test-only: replace the spawn dep used by `runRegenerateLessonAgent`. */
export function __setRegenerateLessonSpawnForTesting(
  deps: RegenerateLessonSpawnDeps | null,
): void {
  depsOverride = deps;
}

export interface RegenerateLessonAgentInput {
  courseSchema: Course;
  currentLesson: Lesson;
  instruction: string;
}

export function defaultRegenerateLessonCommand(): { command: string; args: string[] } {
  // Mirrors the natural-language brief pattern used by extend_course /
  // generate_lesson / regenerate_section: claude's `-p` print mode treats
  // slash commands as literal prompt text, so we ask the agent to load the
  // SKILL.md and run it. The structured input arrives on stdin so we never
  // have to splice JSON into argv.
  const prompt =
    `Run the regenerate_lesson skill defined in scripts/ralph/skills/regenerate_lesson/regenerate_lesson.md. ` +
    `Read the JSON input from stdin (it has fields courseSchema, currentLesson, and instruction). ` +
    `Follow the skill's rules to PRESERVE the lesson's slug, courseSlug, moduleId, and title while rewriting the lesson body end-to-end. ` +
    `Emit a single JSON object on stdout matching the skill's output schema (a top-level newLesson object). ` +
    `Do NOT write any files. Do NOT touch other lessons or course.json. Do NOT touch scripts/ralph/.`;
  return {
    command: 'claude',
    args: ['-p', prompt, '--dangerously-skip-permissions'],
  };
}

/**
 * Spawn the regenerate_lesson agent, pipe `input` as JSON to stdin, capture
 * stdout, and parse it against `RegenerateLessonResponseSchema`. Throws
 * `RegenerateLessonAgentSpawnError` on a non-zero exit and
 * `RegenerateLessonAgentParseError` when stdout is not parseable JSON or
 * fails Zod validation.
 */
export async function runRegenerateLessonAgent(
  input: RegenerateLessonAgentInput,
): Promise<RegenerateLessonResponse> {
  const spawnFn = depsOverride?.spawn ?? defaultSpawn;
  const { command, args } = defaultRegenerateLessonCommand();

  let child: ChildProcess;
  try {
    child = spawnFn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    throw new RegenerateLessonAgentSpawnError(
      `Failed to spawn ${command}: ${(err as Error).message}`,
    );
  }

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new RegenerateLessonAgentSpawnError(
      `Spawned ${command} but stdio is not piped — cannot drive agent`,
    );
  }

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer | string) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  child.stderr.on('data', (chunk: Buffer | string) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  // Pipe the JSON input into stdin and close it so the agent sees EOF.
  const inputJson = JSON.stringify(input);
  await new Promise<void>((resolve, reject) => {
    child.stdin!.on('error', reject);
    child.stdin!.end(inputJson, 'utf8', () => resolve());
  });

  const exitCode: number = await new Promise((resolve, reject) => {
    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve(code ?? 0));
  });

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');

  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString('utf8');
    throw new RegenerateLessonAgentSpawnError(
      `regenerate_lesson agent exited with code ${exitCode}: ${stderr.slice(0, 512)}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stdout.trim());
  } catch (err) {
    throw new RegenerateLessonAgentParseError(stdout, err);
  }

  const validated = RegenerateLessonResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new RegenerateLessonAgentParseError(stdout, validated.error);
  }
  return validated.data;
}
