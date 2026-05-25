import { z } from 'zod';

export const AccentColorSchema = z.enum([
  'default',
  'indigo',
  'emerald',
  'terracotta',
  'black',
]);

export type AccentColor = z.infer<typeof AccentColorSchema>;

export const LessonRefSchema = z.object({
  slug: z.string(),
  title: z.string(),
  estimatedMinutes: z.number().int().positive(),
  summary: z.string().optional(),
});

export type LessonRef = z.infer<typeof LessonRefSchema>;

export const ModuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  lessons: z.array(LessonRefSchema),
});

export type Module = z.infer<typeof ModuleSchema>;

export const CourseSchema = z.object({
  schemaVersion: z.number().int().default(1),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  accentColor: AccentColorSchema,
  icon: z.string(),
  modules: z.array(ModuleSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  // US-191 — downstream tag carried over from CourseSpec so the lesson UI can
  // distinguish quiz-only courses. Only `'quiz'` is currently recognised.
  tags: z.array(z.enum(['quiz'])).optional(),
});

export type Course = z.infer<typeof CourseSchema>;
