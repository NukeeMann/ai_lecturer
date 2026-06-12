// Server-only helper that spawns the `extend_course` agent and parses its
// stdout. Used by POST /api/courses/<slug>/extend (US-143). Read-only:
// never writes course.json, never generates lesson content. Persistence
// lives in the separate Apply route (US-144).

import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { LessonSchema } from '@/lib/schemas/lesson';
import {
  ExtendResponseSchema,
  type ExtendRefinementMessage,
  type ExtendResponse,
} from '@/lib/schemas/extend';
import type { Course } from '@/lib/schemas/course';
import { agentModel } from '@/lib/server/agentCourseContext';
import { lessonFile } from '@/lib/server/paths';

export class ExtendAgentParseError extends Error {
  /** Raw stdout from the agent, truncated to ~2KB for surfacing to the client. */
  readonly rawOutput: string;
  /** Underlying parse / Zod failure surfaced for telemetry. */
  readonly cause: unknown;
  constructor(rawOutput: string, cause: unknown) {
    super('Failed to parse extend_course agent output');
    this.name = 'ExtendAgentParseError';
    this.rawOutput = rawOutput;
    this.cause = cause;
  }
}

export class ExtendAgentSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtendAgentSpawnError';
  }
}

const STDOUT_TRUNCATE_BYTES = 2048;

export function truncateForError(raw: string): string {
  if (raw.length <= STDOUT_TRUNCATE_BYTES) return raw;
  return `${raw.slice(0, STDOUT_TRUNCATE_BYTES)}…[truncated ${raw.length - STDOUT_TRUNCATE_BYTES}B]`;
}

export interface ExtendSpawnDeps {
  spawn?: typeof defaultSpawn;
}

let depsOverride: ExtendSpawnDeps | null = null;

/** Test-only: replace the spawn dep used by `runExtendAgent`. */
export function __setExtendSpawnForTesting(deps: ExtendSpawnDeps | null): void {
  depsOverride = deps;
}

export interface ExtendAgentInput {
  currentSchema: Course & {
    modules: Array<
      Course['modules'][number] & {
        lessons: Array<
          Course['modules'][number]['lessons'][number] & { description?: string }
        >;
      }
    >;
  };
  instruction: string;
  refinements?: ExtendRefinementMessage[];
}

/**
 * Build the per-lesson description map that augments course.json (which
 * does not store descriptions on disk). For each lesson present in
 * course.json, read its lesson JSON and pull the `description` field. If a
 * lesson file is missing or invalid, the description falls back to an empty
 * string so the agent still receives the rest of the schema. (Missing
 * lesson files are normal for partially-generated courses.)
 */
export async function readLessonDescriptions(
  courseSlug: string,
  course: Course,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      const file = lessonFile(courseSlug, lesson.slug);
      let raw: string;
      try {
        raw = await fs.readFile(file, 'utf8');
      } catch {
        map.set(lesson.slug, '');
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        map.set(lesson.slug, '');
        continue;
      }
      const result = LessonSchema.safeParse(parsed);
      if (!result.success) {
        map.set(lesson.slug, '');
        continue;
      }
      map.set(lesson.slug, result.data.description);
    }
  }
  return map;
}

/**
 * Splice per-lesson `description` fields into the course schema so the
 * agent has the lesson context it needs. The lesson-ref entries on the
 * disk-side `CourseSchema` only carry `slug`, `title`, and
 * `estimatedMinutes`; the agent expects each lesson to also carry a
 * `description`. The agent is instructed to preserve these descriptions
 * verbatim in `proposedSchema` for existing lessons.
 */
export function buildAgentInputCourse(
  course: Course,
  descriptions: Map<string, string>,
): ExtendAgentInput['currentSchema'] {
  return {
    ...course,
    modules: course.modules.map((mod) => ({
      ...mod,
      lessons: mod.lessons.map((lesson) => ({
        ...lesson,
        description: descriptions.get(lesson.slug) ?? '',
      })),
    })),
  };
}

export function defaultExtendCommand(
  ctx: { isQuizOnly: boolean } = { isQuizOnly: false },
): { command: string; args: string[] } {
  // Mirrors the natural-language brief pattern used by research_course /
  // design_course / generate_lesson: claude's `-p` print mode treats slash commands as
  // literal prompt text, so we ask the agent to load the SKILL.md and
  // run it. The structured input arrives on stdin (via the `--` brief
  // below pointing the agent at stdin) so we never have to splice JSON
  // into argv. The model is pinned to the one that authored the course
  // (Opus, or Sonnet for quiz-only — US-192) instead of the CLI default.
  const prompt =
    `Run the extend_course skill defined in scripts/ralph/skills/extend_course/extend_course.md. ` +
    `Read the JSON input from stdin (it has fields currentSchema, instruction, and optional refinements). ` +
    `Follow the skill's rules to PRESERVE every existing module/lesson byte-for-byte and append only new content. ` +
    `Emit a single JSON object on stdout matching the skill's output schema. ` +
    `Do NOT write any files. Do NOT generate lesson content. Do NOT touch scripts/ralph/.`;
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
 * Spawn the extend_course agent, pipe `input` as JSON to stdin, capture
 * stdout, and parse it against `ExtendResponseSchema`. Throws
 * `ExtendAgentSpawnError` on a non-zero exit and `ExtendAgentParseError`
 * when stdout is not parseable JSON or fails Zod validation.
 */
export async function runExtendAgent(input: ExtendAgentInput): Promise<ExtendResponse> {
  const spawnFn = depsOverride?.spawn ?? defaultSpawn;
  const { command, args } = defaultExtendCommand({
    isQuizOnly: input.currentSchema.tags?.includes('quiz') ?? false,
  });

  let child: ChildProcess;
  try {
    child = spawnFn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    throw new ExtendAgentSpawnError(
      `Failed to spawn ${command}: ${(err as Error).message}`,
    );
  }

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new ExtendAgentSpawnError(
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
    throw new ExtendAgentSpawnError(
      `extend_course agent exited with code ${exitCode}: ${stderr.slice(0, 512)}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stdout.trim());
  } catch (err) {
    throw new ExtendAgentParseError(stdout, err);
  }

  const validated = ExtendResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new ExtendAgentParseError(stdout, validated.error);
  }
  return validated.data;
}
