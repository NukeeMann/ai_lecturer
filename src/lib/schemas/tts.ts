import { z } from 'zod';

// US-154: shared schemas for /api/tts and /api/stt.

export const TtsVoiceEnum = z.enum(['en-female', 'en-male']);
export type TtsVoice = z.infer<typeof TtsVoiceEnum>;

export const TtsRequestSchema = z.object({
  text: z.string().min(1).max(2000),
  voice: TtsVoiceEnum.default('en-female'),
  outputBaseName: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

export type TtsRequest = z.infer<typeof TtsRequestSchema>;

export const TtsResponseSchema = z.object({
  audioPath: z.string(),
  durationMs: z.number().int().nonnegative(),
  cached: z.boolean(),
});

export type TtsResponse = z.infer<typeof TtsResponseSchema>;

export const SttRequestSchema = z.object({
  audioPath: z.string().min(1).max(1024),
  language: z.literal('en').default('en'),
});

export type SttRequest = z.infer<typeof SttRequestSchema>;

export const SttSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
});

export type SttSegment = z.infer<typeof SttSegmentSchema>;

export const SttResponseSchema = z.object({
  transcript: z.string(),
  durationMs: z.number().int().nonnegative(),
  segments: z.array(SttSegmentSchema).optional(),
});

export type SttResponse = z.infer<typeof SttResponseSchema>;
