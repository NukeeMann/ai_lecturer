// Spawn-based helper that produces polished one-sentence summaries for new
// modules / lessons added through the Extend wizard. The wizard's textarea
// is labelled "Share more details:" — the user's input is a free-form HINT,
// not the final visible summary. This module batches all new additions into
// a single `claude -p` call that rewrites the hint into a clean course-card
// summary before /apply writes course.json.
//
// Mirrors the spawn / parse / test-override pattern used by `runExtendAgent`
// in extend.ts so the behaviour is consistent with the rest of the extend
// surface (same `--dangerously-skip-permissions`, same JSON-on-stdin
// convention, same Zod-validated stdout).
//
// On any failure (spawn, non-zero exit, unparseable stdout) we fall back to
// the raw user text — never block /apply on this enrichment step.

import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import { z } from 'zod';
import type { Course } from '@/lib/schemas/course';

export type ExtensionAdditionKind = 'module' | 'lesson';

export interface ExtensionAdditionSummaryRequest {
  kind: ExtensionAdditionKind;
  /** Stable identifier — moduleId for kind='module', lessonSlug for kind='lesson'. */
  key: string;
  title: string;
  /** User's raw input from the "Share more details:" textarea. Empty when blank. */
  details: string;
  /** For lessons: the parent module title for framing context. */
  parentModuleTitle?: string;
}

export interface GenerateExtensionSummariesInput {
  course: Pick<Course, 'title' | 'description'>;
  additions: ExtensionAdditionSummaryRequest[];
}

const SummaryItemSchema = z.object({
  key: z.string().min(1),
  summary: z.string(),
});

const SummariesResponseSchema = z.object({
  summaries: z.array(SummaryItemSchema),
});

export interface ExtendSummariesSpawnDeps {
  spawn?: typeof defaultSpawn;
}

let depsOverride: ExtendSummariesSpawnDeps | null = null;

/** Test-only: replace the spawn dep used by `generateExtensionSummaries`. */
export function __setExtendSummariesSpawnForTesting(
  deps: ExtendSummariesSpawnDeps | null,
): void {
  depsOverride = deps;
}

export function defaultExtendSummariesCommand(): {
  command: string;
  args: string[];
} {
  const prompt =
    `You will receive a single JSON object on stdin describing a course (title, description) ` +
    `and a list of new modules/lessons being added to it. Each new addition has a kind ("module" or "lesson"), ` +
    `a key (moduleId or lessonSlug), a title, free-form details typed by the user as a hint, and — for lessons — ` +
    `the parent module title. Your job: produce a polished, single-sentence summary for each addition that fits ` +
    `naturally into a course schema's module.summary / lessonRef.summary field. The summary should describe what ` +
    `the module/lesson covers in plain prose, NOT echo the user's raw hint verbatim. Use the hint as guidance ` +
    `(topics, examples, angles, widget/structure preferences) and translate it into a clear summary at ~20-30 words. ` +
    `Preserve any specific technical terms the user mentioned. If the details field is empty, derive a reasonable ` +
    `summary from the title alone. ` +
    `Emit ONE JSON object on stdout matching: {"summaries": [{"key": "<key>", "summary": "<one sentence>"}]}. ` +
    `Include exactly one entry per input addition, in the same order. No prose, no markdown fences, no other keys. ` +
    `Do NOT write any files. Do NOT use any tools. Only stdout.`;
  return {
    command: 'claude',
    args: ['-p', prompt, '--dangerously-skip-permissions'],
  };
}

/**
 * Spawn `claude -p`, pipe the additions as JSON, capture stdout, and parse
 * the AI's summaries. Returns a Map keyed by the addition's `key` field
 * (moduleId or lessonSlug). On any spawn / parse / validation error the
 * caller falls back to the user's raw details — this helper never throws.
 */
export async function generateExtensionSummaries(
  input: GenerateExtensionSummariesInput,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (input.additions.length === 0) return result;

  const spawnFn = depsOverride?.spawn ?? defaultSpawn;
  const { command, args } = defaultExtendSummariesCommand();

  let child: ChildProcess;
  try {
    child = spawnFn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return result;
  }
  if (!child.stdin || !child.stdout || !child.stderr) return result;

  const stdoutChunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer | string) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  // Drain stderr so the child doesn't block on a full pipe.
  child.stderr.on('data', () => {});

  const inputJson = JSON.stringify(input);
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdin!.on('error', reject);
      child.stdin!.end(inputJson, 'utf8', () => resolve());
    });
  } catch {
    return result;
  }

  let exitCode: number;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      child.on('error', (err) => reject(err));
      child.on('close', (code) => resolve(code ?? 0));
    });
  } catch {
    return result;
  }
  if (exitCode !== 0) return result;

  const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
  if (stdout.length === 0) return result;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return result;
  }
  const validated = SummariesResponseSchema.safeParse(parsed);
  if (!validated.success) return result;

  for (const item of validated.data.summaries) {
    const summary = item.summary.trim();
    if (summary.length === 0) continue;
    result.set(item.key, summary);
  }
  return result;
}
