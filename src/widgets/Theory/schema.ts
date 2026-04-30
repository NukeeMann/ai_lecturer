import { z } from 'zod';

export const TheoryDataSchema = z.object({
  markdown: z.string(),
});

export type TheoryData = z.infer<typeof TheoryDataSchema>;
