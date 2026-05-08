// US-136: Per-course `.generation-state.json` file written atomically on every
// stage transition so a server restart or resume (US-137 / US-140) can recover
// exactly which lessons are done, in flight, or pending. The legacy
// `.generating.json` marker (see `GENERATING_MARKER` in generation.ts) only
// stores the in-flight stage label and PID; this file adds per-lesson status,
// attempt counts, and the resolved run config.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { atomicWriteJson } from './atomic';
import { courseDir } from './paths';

export const GenerationStateSchema = z.object({
  schemaVersion: z.literal(1),
  slug: z.string(),
  startedAt: z.string(),
  lastUpdatedAt: z.string(),
  initCourse: z.object({
    status: z.enum(['pending', 'done', 'failed']),
    reason: z.string().optional(),
  }),
  lessons: z.array(
    z.object({
      slug: z.string(),
      status: z.enum(['pending', 'inflight', 'done', 'failed']),
      attempts: z.number().int().nonnegative(),
      lastError: z.string().optional(),
      finishedAt: z.string().optional(),
    }),
  ),
  config: z.object({
    lessonMaxRetries: z.number().int().nonnegative(),
    lessonTimeoutMs: z.number().int().positive(),
  }),
});

export type GenerationState = z.infer<typeof GenerationStateSchema>;

export function generationStateFile(slug: string): string {
  return path.join(courseDir(slug), '.generation-state.json');
}

export async function readGenerationState(slug: string): Promise<GenerationState | null> {
  const file = generationStateFile(slug);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.warn(`[generationState] failed to read ${file}: ${(err as Error).message}`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[generationState] corrupt JSON in ${file}: ${(err as Error).message}`);
    return null;
  }
  const result = GenerationStateSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(`[generationState] schema mismatch in ${file}: ${result.error.message}`);
    return null;
  }
  return result.data;
}

export async function writeGenerationState(
  slug: string,
  state: GenerationState,
): Promise<void> {
  const stamped: GenerationState = { ...state, lastUpdatedAt: new Date().toISOString() };
  await atomicWriteJson(generationStateFile(slug), stamped);
}

export async function deleteGenerationState(slug: string): Promise<void> {
  try {
    await fs.unlink(generationStateFile(slug));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Best-effort delete: a stale file left behind is preferable to
      // surfacing an unhandled rejection out of the success path.
    }
  }
}
