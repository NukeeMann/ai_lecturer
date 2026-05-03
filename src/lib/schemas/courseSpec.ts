import { z } from 'zod';

export const LevelSchema = z.enum(['beginner', 'intermediate', 'advanced']);

/**
 * `durationTarget` controls how big the planned course should be. The architect
 * step in `init_course` uses this to bound module/lesson counts.
 *
 * - `short`         — 3–5 lessons / 30–60 min
 * - `standard`      — 8–12 lessons / 1–3h
 * - `extensive`     — 20–30 lessons / 5–10h
 * - `comprehensive` — 40+ lessons / 15h+
 *
 * Legacy values from earlier course-spec.json files are accepted via
 * preprocessing and remapped to the new enum:
 *   '30min'   → 'short'
 *   '1h'      → 'standard'
 *   'weekend' → 'extensive'
 */
const LEGACY_DURATION_MAP: Record<string, 'short' | 'standard' | 'extensive'> = {
  '30min': 'short',
  '1h': 'standard',
  weekend: 'extensive',
};

export const DurationTargetSchema = z.preprocess(
  (val) =>
    typeof val === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_DURATION_MAP, val)
      ? LEGACY_DURATION_MAP[val]
      : val,
  z.enum(['short', 'standard', 'extensive', 'comprehensive']),
);

export const DraftLessonSchema = z.object({
  title: z.string(),
  summary: z.string(),
  estimatedMinutes: z.number().int().positive(),
});

export const DraftModuleSchema = z.object({
  title: z.string(),
  lessons: z.array(DraftLessonSchema),
});

export const DraftStructureSchema = z.object({
  courseTitle: z.string(),
  courseDescription: z.string(),
  modules: z.array(DraftModuleSchema),
});

export const CourseSpecSchema = z.object({
  topic: z.string(),
  level: LevelSchema,
  durationTarget: DurationTargetSchema,
  theoryPracticeRatio: z.number().min(0).max(1),
  draftStructure: DraftStructureSchema,
  createdAt: z.string(),
});

export type CourseSpec = z.infer<typeof CourseSpecSchema>;
