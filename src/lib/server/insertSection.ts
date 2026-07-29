// Server-only helper that spawns the `insert_section` agent and parses its
// stdout. Used by POST /api/courses/<slug>/lessons/<lessonSlug>/sections/
// <sectionId>/insert (US-208). The agent receives the full Lesson JSON, the
// anchor section's id, and a free-text instruction; it emits a single JSON
// object on stdout matching `InsertSectionResponseSchema` (a top-level
// newSection object). This helper is read-only — snapshotting + persistence
// live in the route. Mirrors src/lib/server/regenerateSection.ts.

import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import {
  InsertSectionResponseSchema,
  type InsertSectionResponse,
} from '@/lib/schemas/insertSection';
import type { Lesson } from '@/lib/schemas/lesson';
import {
  agentModel,
  readCourseAgentContext,
  workingMemoryBrief,
  type CourseAgentContext,
} from '@/lib/server/agentCourseContext';

export class InsertSectionAgentParseError extends Error {
  /** Raw stdout from the agent, truncated to ~2KB for surfacing to the client. */
  readonly rawOutput: string;
  /** Underlying parse / Zod failure surfaced for telemetry. */
  readonly cause: unknown;
  constructor(rawOutput: string, cause: unknown) {
    super('Failed to parse insert_section agent output');
    this.name = 'InsertSectionAgentParseError';
    this.rawOutput = rawOutput;
    this.cause = cause;
  }
}

export class InsertSectionAgentSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsertSectionAgentSpawnError';
  }
}

const STDOUT_TRUNCATE_BYTES = 2048;

export function truncateForError(raw: string): string {
  if (raw.length <= STDOUT_TRUNCATE_BYTES) return raw;
  return `${raw.slice(0, STDOUT_TRUNCATE_BYTES)}…[truncated ${raw.length - STDOUT_TRUNCATE_BYTES}B]`;
}

/**
 * Derive a section id that does not collide with any existing id. Uses the
 * agent's proposed id as the base (or `'section'` when it's empty / blank),
 * then appends `-2`, `-3`, … until the id is free. Pure — the route calls it
 * with the on-disk lesson's existing ids so the inserted section never
 * clobbers progress/navigation state keyed on the originals.
 */
export function makeUniqueSectionId(
  existingIds: Iterable<string>,
  candidate: string,
): string {
  const taken = new Set(existingIds);
  const base = candidate.trim() || 'section';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export interface InsertSectionSpawnDeps {
  spawn?: typeof defaultSpawn;
}

let depsOverride: InsertSectionSpawnDeps | null = null;

/** Test-only: replace the spawn dep used by `runInsertSectionAgent`. */
export function __setInsertSectionSpawnForTesting(
  deps: InsertSectionSpawnDeps | null,
): void {
  depsOverride = deps;
}

export interface InsertSectionAgentInput {
  lessonContext: Lesson;
  anchorSectionId: string;
  instruction: string;
}

export function defaultInsertSectionCommand(
  ctx: CourseAgentContext,
): { command: string; args: string[] } {
  // Mirrors the natural-language brief pattern used by regenerate_section /
  // regenerate_lesson: claude's `-p` print mode treats slash commands as
  // literal prompt text, so we ask the agent to load the SKILL.md and run it.
  // The structured input arrives on stdin so we never have to splice JSON into
  // argv. `ctx` pins the model to the one that authored the course (Opus, or
  // Sonnet for quiz-only — US-192) and points the agent at research.md /
  // sources.md when they exist so the new section stays grounded in the
  // course's working memory.
  const prompt =
    `Run the insert_section skill defined in scripts/ralph/skills/insert_section/insert_section.md. ` +
    `Read the JSON input from stdin (it has fields lessonContext, anchorSectionId, and instruction). ` +
    `Follow the skill's rules to generate EXACTLY ONE new section (default type theory) that fits directly AFTER the anchor section. ` +
    workingMemoryBrief(ctx) +
    `Emit a single JSON object on stdout matching the skill's output schema (a top-level newSection object). ` +
    `Do NOT write any files. Do NOT touch any existing section. Do NOT touch scripts/ralph/.`;
  return {
    command: 'claude',
    args: [
      '-p',
      prompt,
      '--model',
      agentModel(ctx),
      '--dangerously-skip-permissions',
    ],
  };
}

/**
 * Spawn the insert_section agent, pipe `input` as JSON to stdin, capture
 * stdout, and parse it against `InsertSectionResponseSchema`. Throws
 * `InsertSectionAgentSpawnError` on a non-zero exit and
 * `InsertSectionAgentParseError` when stdout is not parseable JSON or fails
 * Zod validation.
 */
export async function runInsertSectionAgent(
  input: InsertSectionAgentInput,
): Promise<InsertSectionResponse> {
  const spawnFn = depsOverride?.spawn ?? defaultSpawn;
  // The agent input carries no course schema, so quiz-only detection reads
  // course.json from disk (best-effort — a missing file degrades to the Opus
  // default and no working-memory pointers).
  const ctx = readCourseAgentContext(input.lessonContext.courseSlug);
  const { command, args } = defaultInsertSectionCommand(ctx);

  let child: ChildProcess;
  try {
    child = spawnFn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    throw new InsertSectionAgentSpawnError(
      `Failed to spawn ${command}: ${(err as Error).message}`,
    );
  }

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new InsertSectionAgentSpawnError(
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
    throw new InsertSectionAgentSpawnError(
      `insert_section agent exited with code ${exitCode}: ${stderr.slice(0, 512)}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stdout.trim());
  } catch (err) {
    throw new InsertSectionAgentParseError(stdout, err);
  }

  const validated = InsertSectionResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new InsertSectionAgentParseError(stdout, validated.error);
  }
  return validated.data;
}
