import { NextResponse } from 'next/server';

import { readMediaFile, readMediaMeta } from '@/lib/lessonChat/media';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ file: string }> };

/**
 * `<id>.<ext>` → the stored image; `<id>.json` → its provenance record (the
 * chat renders the source caption under every web image from this).
 */
export async function GET(_req: Request, { params }: RouteCtx) {
  const { file } = await params;

  const metaMatch = /^([a-f0-9]{32})\.json$/.exec(file);
  if (metaMatch) {
    const meta = await readMediaMeta(metaMatch[1]);
    if (!meta) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(meta, { headers: { 'Cache-Control': 'no-cache' } });
  }

  const media = await readMediaFile(file);
  if (!media) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new Response(new Uint8Array(media.bytes), {
    status: 200,
    headers: {
      'Content-Type': media.mediaType,
      'Content-Length': String(media.bytes.length),
      // Content-addressed: the bytes behind a file name never change.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
