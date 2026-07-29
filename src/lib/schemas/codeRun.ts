import { z } from 'zod';

/** A lesson-provided file to mount into the kernel session before user code
 *  runs (US-201). `src` is a (possibly relative) URL the server fetches. */
export const CodeRunInputSchema = z.object({
  filename: z.string().min(1),
  src: z.string().min(1),
});

/** Session identity shared by every `/api/code/*` route. */
export const CodeSessionSchema = z.object({
  courseSlug: z.string().min(1),
  lessonSlug: z.string().min(1),
  sectionId: z.string().min(1),
});

export type CodeSession = z.infer<typeof CodeSessionSchema>;

/** Body for `POST /api/code/run`. */
export const CodeRunSchema = CodeSessionSchema.extend({
  code: z.string(),
  requiresPackages: z.array(z.string()).optional(),
  inputs: z.array(CodeRunInputSchema).optional(),
});

export type CodeRunRequest = z.infer<typeof CodeRunSchema>;
