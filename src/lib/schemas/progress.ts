import { z } from 'zod';

export const LessonStatusSchema = z.enum(['not_started', 'started', 'finished']);

export type LessonStatus = z.infer<typeof LessonStatusSchema>;

export const SectionStateSchema = z.object({
  userCode: z.string().optional(),
  quizSubmission: z.array(z.number().int().nonnegative()).optional(),
  done: z.boolean().optional(),
});

export type SectionState = z.infer<typeof SectionStateSchema>;

export const LessonProgressSchema = z.object({
  status: LessonStatusSchema,
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  sectionState: z.record(SectionStateSchema).optional(),
  manuallyCompletedSections: z.record(z.boolean()).optional(),
});

export type LessonProgress = z.infer<typeof LessonProgressSchema>;

export const CourseProgressSchema = z.object({
  lastVisitedLessonSlug: z.string().optional(),
  lastVisitedAt: z.string().optional(),
  lessons: z.record(LessonProgressSchema),
});

export type CourseProgress = z.infer<typeof CourseProgressSchema>;

export const ProgressSchema = z.object({
  courses: z.record(CourseProgressSchema),
});

export type Progress = z.infer<typeof ProgressSchema>;
