import { z } from 'zod';

export const AudioPlayerDataSchema = z.object({
  audioPath: z.string().min(1),
  transcript: z.string().optional(),
  autoplay: z.boolean().default(false),
  title: z.string().optional(),
});

export type AudioPlayerData = z.infer<typeof AudioPlayerDataSchema>;

const AUDIO_EXT_RE = /\.(mp3|wav|ogg)$/i;

export function isSupportedAudioPath(p: string): boolean {
  return AUDIO_EXT_RE.test(p);
}

export function buildAudioUrl(courseSlug: string, audioPath: string): string {
  const trimmed = audioPath.replace(/^\/+/, '');
  const segments = trimmed
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s));
  const tail = segments.join('/');
  return `/api/courses/${encodeURIComponent(courseSlug)}/assets/audio/${tail}`;
}
