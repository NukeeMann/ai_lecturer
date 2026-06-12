// Shared context derivation for the one-shot `claude -p` agents that operate
// on an EXISTING course (regenerate_section / regenerate_lesson /
// extend_course). Two concerns live here:
//
//  1. Model pin. The generation pipeline authors normal courses on Opus and
//     quiz-only courses on Sonnet (US-192). Before this module the
//     regenerate/extend spawns passed no `--model` at all and ran on the
//     CLI's default — so a section regenerated inside an Opus-authored
//     course could come back from a weaker model. `agentModel()` restores
//     the generation-time split.
//
//  2. Working-memory pointers. `research.md` / `sources.md` are the
//     grounding every generate_lesson call reads, but the regenerate agents
//     only ever received the lesson JSON + instruction, so rewrites drifted
//     away from the course's terminology and bibliography.
//     `workingMemoryBrief()` builds the prompt sentence that points the
//     agent back at those files (only the ones that actually exist —
//     quiz-only and legacy courses have neither).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { courseDir, courseFile } from './paths';

export interface CourseAgentContext {
  courseSlug: string;
  /** True when course.json carries `tags: ['quiz']` (US-191/US-192). */
  isQuizOnly: boolean;
  researchExists: boolean;
  sourcesExists: boolean;
}

/** The `--model` value matching how this course was originally generated. */
export function agentModel(
  ctx: Pick<CourseAgentContext, 'isQuizOnly'>,
): 'opus' | 'sonnet' {
  return ctx.isQuizOnly ? 'sonnet' : 'opus';
}

/**
 * Best-effort, synchronous. A missing/corrupt course.json (or an unsafe
 * slug) degrades to non-quiz defaults with no working-memory files — the
 * spawn still happens, just without the extra context. Callers that already
 * hold the parsed course schema pass `knownIsQuizOnly` to skip the file read.
 */
export function readCourseAgentContext(
  courseSlug: string,
  opts: { knownIsQuizOnly?: boolean } = {},
): CourseAgentContext {
  let isQuizOnly = opts.knownIsQuizOnly ?? false;
  if (opts.knownIsQuizOnly === undefined) {
    try {
      const parsed = JSON.parse(
        readFileSync(courseFile(courseSlug), 'utf8'),
      ) as { tags?: unknown };
      isQuizOnly =
        Array.isArray(parsed.tags) && (parsed.tags as unknown[]).includes('quiz');
    } catch {
      isQuizOnly = false;
    }
  }
  let researchExists = false;
  let sourcesExists = false;
  try {
    const dir = courseDir(courseSlug);
    researchExists = existsSync(path.join(dir, 'research.md'));
    sourcesExists = existsSync(path.join(dir, 'sources.md'));
  } catch {
    /* unsafe slug or unreadable dir — leave both false */
  }
  return { courseSlug, isQuizOnly, researchExists, sourcesExists };
}

/**
 * Prompt fragment pointing the agent at the course's working-memory files.
 * Empty string when neither file exists. The `/courses/<slug>/...` notation
 * is the same repo-root-relative convention every generation-pipeline brief
 * uses (see defaultLessonCommand in generation.ts).
 */
export function workingMemoryBrief(ctx: CourseAgentContext): string {
  const files: string[] = [];
  if (ctx.researchExists) files.push(`/courses/${ctx.courseSlug}/research.md`);
  if (ctx.sourcesExists) files.push(`/courses/${ctx.courseSlug}/sources.md`);
  if (files.length === 0) return '';
  return (
    `Course working memory: Read ${files.join(' and ')} BEFORE rewriting, so terminology, ` +
    `notation, and cited sources stay consistent with the rest of the course. ` +
    `These files are read-only context — do NOT modify them. `
  );
}
