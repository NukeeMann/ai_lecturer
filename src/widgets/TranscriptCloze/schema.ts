import { z } from 'zod';

import { tokenize } from '@/lib/widgets/transcriptTokenize';

export const TranscriptClozeBlankSchema = z.object({
  wordIndex: z.number().int().nonnegative(),
  answer: z.string().min(1),
  hint: z.string().optional(),
});

export const TranscriptClozeDataSchema = z
  .object({
    audioPath: z.string().min(1),
    transcript: z.string().min(1),
    blanks: z.array(TranscriptClozeBlankSchema),
    title: z.string().optional(),
    instructions: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const tokens = tokenize(data.transcript);
    const wordCount = tokens.length;
    const seen = new Set<number>();
    for (let i = 0; i < data.blanks.length; i++) {
      const b = data.blanks[i];
      if (b.wordIndex >= wordCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['blanks', i, 'wordIndex'],
          message: `wordIndex ${b.wordIndex} out of range (transcript has ${wordCount} words)`,
        });
      }
      if (seen.has(b.wordIndex)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['blanks', i, 'wordIndex'],
          message: `Duplicate wordIndex ${b.wordIndex}`,
        });
      }
      seen.add(b.wordIndex);
    }
  });

export type TranscriptClozeBlank = z.infer<typeof TranscriptClozeBlankSchema>;
export type TranscriptClozeData = z.infer<typeof TranscriptClozeDataSchema>;
