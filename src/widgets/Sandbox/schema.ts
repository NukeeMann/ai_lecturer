import { z } from 'zod';

import { CodeInputSchema, CodeOutputMediaSchema } from '../Code/schema';

export const SandboxDataSchema = z.object({
  starterCode: z.string(),
  encouragement: z.string(),
  inputs: z.array(CodeInputSchema).optional(),
  outputMedia: CodeOutputMediaSchema.optional(),
  // Real pip packages that must be importable in the kernel runtime (US-196),
  // e.g. ['cv2', 'matplotlib'] for real OpenCV/Matplotlib. Declared names are
  // checked as a precondition before a run (US-203) — they are NOT installed at
  // run time. Accepts import names (e.g. 'cv2') or PyPI dist names (e.g. 'Pillow').
  requiresPackages: z.array(z.string()).optional(),
});

export type SandboxData = z.infer<typeof SandboxDataSchema>;
