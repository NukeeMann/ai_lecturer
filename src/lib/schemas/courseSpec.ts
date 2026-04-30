import { z } from 'zod';

export const LevelSchema = z.enum(['beginner', 'intermediate', 'advanced']);

export const DurationTargetSchema = z.enum(['30min', '1h', 'weekend']);

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
