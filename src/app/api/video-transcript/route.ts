import { NextResponse } from 'next/server';

import { extractYouTubeId } from '@/widgets/Video/schema';
import { fetchYouTubeTranscript } from '@/lib/video/transcript';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get('videoId') ?? url.searchParams.get('src') ?? '';
  const videoId = extractYouTubeId(raw);
  if (!videoId) {
    return NextResponse.json(
      { error: 'Missing or invalid videoId' },
      { status: 400 },
    );
  }
  const result = await fetchYouTubeTranscript(videoId);
  return NextResponse.json(result);
}
