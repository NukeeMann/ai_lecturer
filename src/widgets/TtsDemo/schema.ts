import { z } from 'zod';

// US-158: data shape for the TtsDemo widget. Both fields are optional —
// authors can pre-seed the textarea via `defaultText` and override the
// placeholder via `placeholderText`. Runtime synthesis is driven by the
// /api/tts route at click time, NOT by anything stored in this schema.
export const TtsDemoDataSchema = z.object({
  defaultText: z.string().max(2000).optional(),
  placeholderText: z.string().optional(),
});

export type TtsDemoData = z.infer<typeof TtsDemoDataSchema>;
