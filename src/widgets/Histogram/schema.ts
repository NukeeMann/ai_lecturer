import { z } from 'zod';

export const HistogramDataSchema = z
  .object({
    binEdges: z.array(z.number()).min(2),
    counts: z.array(z.number().nonnegative()).min(1),
  })
  .refine((d) => d.binEdges.length === d.counts.length + 1, {
    message: 'binEdges.length must equal counts.length + 1',
    path: ['binEdges'],
  });

export type HistogramData = z.infer<typeof HistogramDataSchema>;
