import { z } from 'zod';

export const LessonStatusSchema = z.enum(['not_started', 'started', 'finished']);

export type LessonStatus = z.infer<typeof LessonStatusSchema>;

export const SectionStateSchema = z.object({
  userCode: z.string().optional(),
  quizSubmission: z.array(z.number().int().nonnegative()).optional(),
  done: z.boolean().optional(),
  score: z
    .object({
      correct: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .optional(),
  /**
   * Widget-owned JSON that lets a widget restore what the learner did
   * (marks, answers, viewer settings…) after a reload. The shape belongs to
   * the widget, which should version it itself (e.g. `{ v: 1, … }`) and
   * validate it on restore. Keep it small: it lives in progress.json, which is
   * rewritten on every PATCH (the PATCH route caps it, see
   * MAX_WIDGET_STATE_CHARS in src/lib/server/progress.ts).
   *
   * A plain `sectionState` PATCH REPLACES the section's whole object, so a
   * widget must always send its full state together (`{ done, widgetState,
   * score }`), never `{ widgetState }` alone.
   */
  widgetState: z.record(z.unknown()).optional(),
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
