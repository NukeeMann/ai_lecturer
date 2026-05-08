import { z } from 'zod';
import { CourseSchema } from '@/lib/schemas/course';

// US-143: server-side extend agent.
// The /api/courses/<slug>/extend endpoint spawns `claude -p extend_course`,
// which reads the existing course schema (modules + lessons + descriptions)
// plus a free-text instruction and proposes an extended schema marked with
// which modules/lessons are new. The endpoint is read-only; persistence is
// handled by a separate Apply route added in US-144.

export const ExtendNewLessonSchema = z.object({
  moduleId: z.string().min(1),
  lessonSlug: z.string().min(1),
  lessonTitle: z.string().min(1),
  lessonDescription: z.string(),
});

export type ExtendNewLesson = z.infer<typeof ExtendNewLessonSchema>;

export const ExtendAdditionsSchema = z.object({
  newModuleIds: z.array(z.string().min(1)),
  newLessonIds: z.array(ExtendNewLessonSchema),
  rationale: z.string(),
});

export type ExtendAdditions = z.infer<typeof ExtendAdditionsSchema>;

export const ExtendResponseSchema = z.object({
  proposedSchema: CourseSchema,
  additions: ExtendAdditionsSchema,
});

export type ExtendResponse = z.infer<typeof ExtendResponseSchema>;

export const ExtendRefinementMessageSchema = z.object({
  role: z.literal('user'),
  content: z.string().min(1).max(2000),
});

export type ExtendRefinementMessage = z.infer<typeof ExtendRefinementMessageSchema>;

export const ExtendRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
  refinements: z.array(ExtendRefinementMessageSchema).max(10).optional(),
});

export type ExtendRequest = z.infer<typeof ExtendRequestSchema>;
