import { NextResponse } from 'next/server';
import { abortInflight } from '@/lib/lessonChat/inflight';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  if (!requestId) {
    return NextResponse.json({ error: 'requestId required' }, { status: 400 });
  }
  const aborted = abortInflight(requestId);
  if (!aborted) {
    return NextResponse.json({ error: 'Unknown requestId' }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
