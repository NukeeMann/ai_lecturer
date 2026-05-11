import { z } from 'zod';

// US-159: SttDemo widget — records a short mic clip, sends it to the STT
// pipeline, and renders the transcript. `maxDurationSeconds` caps the
// recording length (1..60) so demo lessons can't accidentally record a long
// clip; the component auto-stops the MediaRecorder when the cap is reached.
export const SttDemoDataSchema = z.object({
  maxDurationSeconds: z.number().int().min(1).max(60).default(10),
  prompt: z.string().max(500).optional(),
});

export type SttDemoData = z.infer<typeof SttDemoDataSchema>;
