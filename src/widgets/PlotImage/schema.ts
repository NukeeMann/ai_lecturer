import { z } from 'zod';

export const PlotImageDataSchema = z.object({
  src: z.string().min(1),
  alt: z.string().min(1),
  caption: z.string().optional(),
  sourceCode: z.string().optional(),
  sourceLanguage: z.enum(['python', 'r']).optional(),
});

export type PlotImageData = z.infer<typeof PlotImageDataSchema>;
