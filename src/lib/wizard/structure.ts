/**
 * Wizard Structure helpers (US-092).
 *
 * Prompt assembly + JSON-response parsing for the Claude-driven curriculum
 * generator that runs at the start of Stage 3 (Structure). The output is a
 * `CourseStructure` (modules → lessons with title, description,
 * estimatedMinutes) that the user can then edit in the cascade.
 */
import { z } from 'zod';

import { extractJsonPayload } from './clarify';

export const RefineDraftSchema = z.object({
  level: z.enum(['beginner', 'intermediate', 'advanced']).nullable(),
  durationTarget: z
    .enum(['short', 'standard', 'extensive', 'comprehensive'])
    .nullable(),
  theoryPracticeRatio: z.number().min(0).max(100),
});

export const StructureRequestSchema = z.object({
  topic: z.string().min(1),
  refine: RefineDraftSchema,
  /** Free-form clarification answers, keyed by `<id>: <question text>`. */
  clarification: z.record(z.string(), z.string()).optional(),
});

export type StructureRequest = z.infer<typeof StructureRequestSchema>;
export type RefineDraft = z.infer<typeof RefineDraftSchema>;

export const LessonStructureSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  estimatedMinutes: z.number().int().positive(),
});

export const ModuleStructureSchema = z.object({
  title: z.string().min(1),
  lessons: z.array(LessonStructureSchema).min(1),
});

export const CourseStructureSchema = z.object({
  courseTitle: z.string().min(1),
  courseDescription: z.string().min(1),
  modules: z.array(ModuleStructureSchema).min(1),
});

export type CourseStructure = z.infer<typeof CourseStructureSchema>;
export type ModuleStructure = z.infer<typeof ModuleStructureSchema>;
export type LessonStructure = z.infer<typeof LessonStructureSchema>;

export const STRUCTURE_SYSTEM_PROMPT = [
  'You are an expert curriculum designer building an outline for an interactive, self-paced course.',
  'Given a draft topic, learner level, length target, theory/practice mix, and (optionally) the learner\'s answers to clarifying questions, propose a complete course outline.',
  'Each module groups related lessons. Each lesson must have a concise title, a one-sentence description (under 200 characters) of what the learner will do or learn, and an estimatedMinutes integer (typically 8–20).',
  'Match the learner\'s requested length: short ≈ 3–5 lessons total, standard ≈ 8–12, extensive ≈ 20–30, comprehensive ≈ 40+. Spread lessons across modules sensibly (3–8 lessons per module).',
  'Respond with STRICT JSON only — no prose, no markdown fences. Schema: {"courseTitle":"…","courseDescription":"…","modules":[{"title":"…","lessons":[{"title":"…","description":"…","estimatedMinutes":12}, ...]}, ...]}.',
  'Every field is required and must be non-empty. Do not include ids, prerequisites, or any extra fields.',
].join('\n');

function ratioLabel(n: number): string {
  if (n < 34) return 'mostly theory';
  if (n > 66) return 'mostly practice';
  return 'balanced theory/practice';
}

function durationLabel(d: RefineDraft['durationTarget']): string {
  switch (d) {
    case 'short':
      return 'short course (3–5 lessons)';
    case 'standard':
      return 'standard course (8–12 lessons)';
    case 'extensive':
      return 'extensive course (20–30 lessons)';
    case 'comprehensive':
      return 'comprehensive course (40+ lessons)';
    default:
      return 'unspecified length';
  }
}

export function buildStructureUserMessage(req: StructureRequest): string {
  const { topic, refine, clarification } = req;
  const lines = [
    'Draft course spec:',
    `- Topic: ${topic.trim()}`,
    `- Learner level: ${refine.level ?? 'unspecified'}`,
    `- Length: ${durationLabel(refine.durationTarget)}`,
    `- Mix: ${ratioLabel(refine.theoryPracticeRatio)} (${refine.theoryPracticeRatio}/100)`,
  ];

  const answerEntries = clarification
    ? Object.entries(clarification).filter(([, v]) => v.trim().length > 0)
    : [];
  if (answerEntries.length > 0) {
    lines.push('', "Learner's clarification answers:");
    for (const [key, value] of answerEntries) {
      lines.push(`- ${key.trim()} → ${value.trim()}`);
    }
  }

  lines.push(
    '',
    'Generate the full module → lesson outline as STRICT JSON only. No markdown fences, no prose.',
  );
  return lines.join('\n');
}

/**
 * Parse and validate a connector reply into a `CourseStructure`. Throws on
 * any problem so the route can decide whether to retry or surface the error.
 *
 * - Trims whitespace on every string field.
 * - Filters out empty modules / empty lessons before zod validation so a
 *   sloppy model output (e.g. extra blank trailing entry) doesn't fail the
 *   `min(1)` constraints unnecessarily.
 */
export function parseStructureResponse(raw: string): CourseStructure {
  const payload = extractJsonPayload(raw);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Response is not a JSON object');
  }
  const obj = payload as {
    courseTitle?: unknown;
    courseDescription?: unknown;
    modules?: unknown;
  };
  if (typeof obj.courseTitle !== 'string') {
    throw new Error('Response missing `courseTitle`');
  }
  if (typeof obj.courseDescription !== 'string') {
    throw new Error('Response missing `courseDescription`');
  }
  if (!Array.isArray(obj.modules)) {
    throw new Error('Response missing `modules` array');
  }

  const cleanedModules = [];
  for (const m of obj.modules) {
    if (!m || typeof m !== 'object') continue;
    const mod = m as { title?: unknown; lessons?: unknown };
    const title = typeof mod.title === 'string' ? mod.title.trim() : '';
    if (!title) continue;
    if (!Array.isArray(mod.lessons)) continue;
    const cleanedLessons = [];
    for (const l of mod.lessons) {
      if (!l || typeof l !== 'object') continue;
      const lesson = l as {
        title?: unknown;
        description?: unknown;
        estimatedMinutes?: unknown;
      };
      const lt = typeof lesson.title === 'string' ? lesson.title.trim() : '';
      const ld =
        typeof lesson.description === 'string'
          ? lesson.description.trim()
          : '';
      const lm =
        typeof lesson.estimatedMinutes === 'number'
          ? Math.round(lesson.estimatedMinutes)
          : NaN;
      if (!lt || !ld || !Number.isFinite(lm) || lm <= 0) continue;
      cleanedLessons.push({
        title: lt,
        description: ld,
        estimatedMinutes: lm,
      });
    }
    if (cleanedLessons.length === 0) continue;
    cleanedModules.push({ title, lessons: cleanedLessons });
  }

  if (cleanedModules.length === 0) {
    throw new Error('Response contained no valid modules');
  }

  return CourseStructureSchema.parse({
    courseTitle: obj.courseTitle.trim(),
    courseDescription: obj.courseDescription.trim(),
    modules: cleanedModules,
  });
}
