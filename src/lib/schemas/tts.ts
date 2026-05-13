import { z } from 'zod';

// US-154: shared schemas for /api/tts and /api/stt.

// US-166: three Coqui XTTS v2 voices selectable from Settings. See the
// speaker mapping doc-block in src/lib/server/tts.ts for the underlying
// XTTS speaker IDs and per-voice env-var overrides.
export const TtsVoiceEnum = z.enum([
  'en-female-warm',
  'en-male-neutral',
  'en-female-bright',
]);
export type TtsVoice = z.infer<typeof TtsVoiceEnum>;

export const TTS_VOICE_VALUES: readonly TtsVoice[] = [
  'en-female-warm',
  'en-male-neutral',
  'en-female-bright',
] as const;

export const DEFAULT_TTS_VOICE: TtsVoice = 'en-female-warm';

export const TtsRequestSchema = z.object({
  text: z.string().min(1).max(2000),
  voice: TtsVoiceEnum.default(DEFAULT_TTS_VOICE),
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
