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
});

export type Course = z.infer<typeof CourseSchema>;
