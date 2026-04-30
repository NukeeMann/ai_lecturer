import { z } from 'zod';

export const QuizDataSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).min(2),
  correct: z.array(z.number().int().nonnegative()).min(1),
  explanation: z.string(),
  multiSelect: z.boolean(),
});

export type QuizData = z.infer<typeof QuizDataSchema>;
