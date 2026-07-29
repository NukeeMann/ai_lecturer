import { z } from 'zod';
import { SectionSchema } from '@/lib/schemas/lesson';

// US-208: server-side insert-section agent.
// POST /api/courses/<slug>/lessons/<lessonSlug>/sections/<sectionId>/insert
// spawns `claude -p insert_section`, which reads the full lesson JSON plus the
// anchor sectionId and a free-text instruction and returns ONE brand-new
// section (default `theory`) to be inserted directly AFTER the anchor. Unlike
// regenerate_section, this route persists the result itself (snapshot + atomic
// write); there is no separate Apply step.

export const InsertSectionRequestSchema = z.object({
  instruction: z.string().min(1).max(1000),
});

export type InsertSectionRequest = z.infer<typeof InsertSectionRequestSchema>;

export const InsertSectionResponseSchema = z.object({
  newSection: SectionSchema,
});

export type InsertSectionResponse = z.infer<typeof InsertSectionResponseSchema>;
