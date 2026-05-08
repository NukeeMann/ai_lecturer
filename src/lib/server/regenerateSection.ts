// Server-only helper that spawns the `regenerate_section` agent and parses
// its stdout. Used by POST /api/courses/<slug>/lessons/<lessonSlug>/sections/
// <sectionId>/regenerate (US-146). Read-only: never writes lesson.json,
// never touches other sections. Persistence lives in the separate Apply
// route in the same story.

import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import {
  RegenerateSectionResponseSchema,
  type RegenerateSectionResponse,
} from '@/lib/schemas/regenerateSection';
import type { Lesson } from '@/lib/schemas/lesson';

export class RegenerateSectionAgentParseError extends Error {
  /** Raw stdout from the agent, truncated to ~2KB for surfacing to the client. */
  readonly rawOutput: string;
  /** Underlying parse / Zod failure surfaced for telemetry. */
  readonly cause: unknown;
  constructor(rawOutput: string, cause: unknown) {
    super('Failed to parse regenerate_section agent output');
    this.name = 'RegenerateSectionAgentParseError';
    this.rawOutput = rawOutput;
    this.cause = cause;
  }
}

export class RegenerateSectionAgentSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegenerateSectionAgentSpawnError';
  }
}

const STDOUT_TRUNCATE_BYTES = 2048;

export function truncateForError(raw: string): string {
  if (raw.length <= STDOUT_TRUNCATE_BYTES) return raw;
  return `${raw.slice(0, STDOUT_TRUNCATE_BYTES)}…[truncated ${raw.length - STDOUT_TRUNCATE_BYTES}B]`;
}

export interface RegenerateSectionSpawnDeps {
  spawn?: typeof defaultSpawn;
}

let depsOverride: RegenerateSectionSpawnDeps | null = null;

/** Test-only: replace the spawn dep used by `runRegenerateSectionAgent`. */
export function __setRegenerateSectionSpawnForTesting(
  deps: RegenerateSectionSpawnDeps | null,
): void {
  depsOverride = deps;
}

export interface RegenerateSectionAgentInput {
  lessonContext: Lesson;
  sectionId: string;
  instruction: string;
}

export function defaultRegenerateSectionCommand(): { command: string; args: string[] } {
  // Mirrors the natural-language brief pattern used by extend_course /
  // generate_lesson: claude's `-p` print mode treats slash commands as
  // literal prompt text, so we ask the agent to load the SKILL.md and
  // run it. The structured input arrives on stdin so we never have to
  // splice JSON into argv.
  const prompt =
    `Run the regenerate_section skill defined in scripts/ralph/skills/regenerate_section/regenerate_section.md. ` +
    `Read the JSON input from stdin (it has fields lessonContext, sectionId, and instruction). ` +
    `Follow the skill's rules to PRESERVE the section's id and type while rewriting only its content. ` +
    `Emit a single JSON object on stdout matching the skill's output schema (a top-level newSection object). ` +
    `Do NOT write any files. Do NOT touch any other section. Do NOT touch scripts/ralph/.`;
  return {
    command: 'claude',
    args: ['-p', prompt, '--dangerously-skip-permissions'],
  };
}

/**
 * Spawn the regenerate_section agent, pipe `input` as JSON to stdin, capture
 * stdout, and parse it against `RegenerateSectionResponseSchema`. Throws
 * `RegenerateSectionAgentSpawnError` on a non-zero exit and
 * `RegenerateSectionAgentParseError` when stdout is not parseable JSON or
 * fails Zod validation.
 */
export async function runRegenerateSectionAgent(
  input: RegenerateSectionAgentInput,
): Promise<RegenerateSectionResponse> {
  const spawnFn = depsOverride?.spawn ?? defaultSpawn;
  const { command, args } = defaultRegenerateSectionCommand();

  let child: ChildProcess;
  try {
    child = spawnFn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    throw new RegenerateSectionAgentSpawnError(
      `Failed to spawn ${command}: ${(err as Error).message}`,
    );
  }

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new RegenerateSectionAgentSpawnError(
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
    throw new RegenerateSectionAgentSpawnError(
      `regenerate_section agent exited with code ${exitCode}: ${stderr.slice(0, 512)}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stdout.trim());
  } catch (err) {
    throw new RegenerateSectionAgentParseError(stdout, err);
  }

  const validated = RegenerateSectionResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new RegenerateSectionAgentParseError(stdout, validated.error);
  }
  return validated.data;
}
