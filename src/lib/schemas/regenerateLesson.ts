import { z } from 'zod';
import { LessonSchema } from '@/lib/schemas/lesson';

// US-148: server-side regenerate-lesson agent.
// The /api/courses/<slug>/lessons/<lessonSlug>/regenerate endpoint spawns
// `claude -p regenerate_lesson`, which reads the full course schema, the
// current full Lesson JSON, and a free-text instruction and returns a
// regenerated full Lesson. Before overwriting, the route snapshots the
// previous lesson.json to <lessonSlug>.lesson-prev.json so a one-step Undo
// (companion .../regenerate/undo route) can restore it.

export const RegenerateLessonRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
});

export type RegenerateLessonRequest = z.infer<typeof RegenerateLessonRequestSchema>;

export const RegenerateLessonResponseSchema = z.object({
  newLesson: LessonSchema,
});

export type RegenerateLessonResponse = z.infer<typeof RegenerateLessonResponseSchema>;
