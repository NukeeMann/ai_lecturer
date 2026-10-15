import { NextResponse } from 'next/server';

import {
  ChatMediaError,
  MAX_CHAT_IMAGE_BYTES,
  mediaUrl,
  saveUploadedImage,
} from '@/lib/lessonChat/media';

export const dynamic = 'force-dynamic';

/**
 * Upload an image the learner pasted / dropped / picked in the AI Tutor
 * composer. Body is the raw image bytes; the type is sniffed from the bytes.
 * The client downsizes large images before uploading (lib/client/chatImage).
 */
export async function POST(req: Request) {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_CHAT_IMAGE_BYTES) {
    return NextResponse.json({ error: 'Image too large' }, { status: 413 });
  }
  const bytes = Buffer.from(await req.arrayBuffer());
  try {
    const meta = await saveUploadedImage(bytes);
    return NextResponse.json({
      id: meta.id,
      file: meta.file,
      url: mediaUrl(meta.file),
      mediaType: meta.mediaType,
    });
  } catch (err) {
    if (err instanceof ChatMediaError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
