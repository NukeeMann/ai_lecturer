import { z } from 'zod';

export const DemoDataSchema = z.object({
  demoType: z.literal('gauss'),
  imageSrc: z.string(),
  params: z.object({
    sigmaMin: z.number(),
    sigmaMax: z.number(),
    sigmaDefault: z.number(),
  }),
});

export type DemoData = z.infer<typeof DemoDataSchema>;
