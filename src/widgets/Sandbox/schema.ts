import { z } from 'zod';

import { CodeInputSchema, CodeOutputMediaSchema } from '../Code/schema';

export const SandboxDataSchema = z.object({
  starterCode: z.string(),
  encouragement: z.string(),
  inputs: z.array(CodeInputSchema).optional(),
  outputMedia: CodeOutputMediaSchema.optional(),
  // 'cv2' resolves to a shim, not real OpenCV — see src/lib/pyodide/CLAUDE.md
  requiresPackages: z.array(z.string()).optional(),
});

export type SandboxData = z.infer<typeof SandboxDataSchema>;
