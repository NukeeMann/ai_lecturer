import { z } from 'zod';

export const CodeTestSchema = z.object({
  name: z.string(),
  body: z.string(),
  hidden: z.boolean().default(true),
});

export const CodeDataSchema = z.object({
  taskMarkdown: z.string(),
  starterCode: z.string(),
  tests: z.array(CodeTestSchema),
});

export type CodeTest = z.infer<typeof CodeTestSchema>;
export type CodeData = z.infer<typeof CodeDataSchema>;
