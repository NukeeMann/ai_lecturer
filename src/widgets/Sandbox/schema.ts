import { z } from 'zod';

export const SandboxDataSchema = z.object({
  starterCode: z.string(),
  encouragement: z.string(),
});

export type SandboxData = z.infer<typeof SandboxDataSchema>;
