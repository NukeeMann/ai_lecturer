import { z } from 'zod';
import { SectionSchema } from '@/lib/schemas/lesson';

// US-146: server-side regenerate-section agent.
// The /api/courses/<slug>/lessons/<lessonSlug>/sections/<sectionId>/regenerate
// endpoint spawns `claude -p regenerate_section`, which reads the full lesson
// JSON plus a target sectionId and a free-text instruction and returns a
// regenerated version of just that one section. The endpoint is read-only;
// persistence is handled by a separate Apply route in the same story.

export const RegenerateSectionRequestSchema = z.object({
  instruction: z.string().min(1).max(1000),
});

export type RegenerateSectionRequest = z.infer<typeof RegenerateSectionRequestSchema>;

export const RegenerateSectionResponseSchema = z.object({
  newSection: SectionSchema,
});

export type RegenerateSectionResponse = z.infer<typeof RegenerateSectionResponseSchema>;

// Body of POST /api/courses/<slug>/lessons/<lessonSlug>/sections/<sectionId>/apply.
// The client sends back the regenerated section (typically the one the
// regenerate route just produced) for persistence. The route re-validates +
// re-asserts id/kind preservation against the on-disk lesson before writing.
export const ApplySectionRequestSchema = z.object({
  newSection: SectionSchema,
});

export type ApplySectionRequest = z.infer<typeof ApplySectionRequestSchema>;
