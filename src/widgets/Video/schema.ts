import { z } from 'zod';

export const VideoKindSchema = z.enum(['youtube', 'mp4']);

export const VideoTranscriptSegmentSchema = z.object({
  tStart: z.number().min(0),
  tEnd: z.number().min(0).optional(),
  text: z.string().min(1),
  speaker: z.string().optional(),
});

export const VideoDataSchema = z.object({
  kind: VideoKindSchema,
  src: z.string().min(1),
  title: z.string().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  transcript: z.array(VideoTranscriptSegmentSchema).optional(),
  autoplay: z.boolean().default(false),
  startAt: z.number().nonnegative().optional(),
});

export type VideoKind = z.infer<typeof VideoKindSchema>;
export type VideoTranscriptSegment = z.infer<typeof VideoTranscriptSegmentSchema>;
export type VideoData = z.infer<typeof VideoDataSchema>;

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractYouTubeId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (YT_ID_RE.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0] ?? '';
    return YT_ID_RE.test(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const v = url.searchParams.get('v');
    if (v && YT_ID_RE.test(v)) return v;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'v')) {
      const id = parts[1];
      if (YT_ID_RE.test(id)) return id;
    }
  }

  return null;
}
