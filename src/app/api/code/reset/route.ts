// US-201: clear a session kernel's user namespace in place (no restart). The
// kernel process and its loaded libraries stay warm; only user-defined names
// are dropped. No-op if no kernel is alive.

import { NextResponse } from 'next/server';

import { CodeSessionSchema } from '@/lib/schemas/codeRun';
import { kernelManager } from '@/lib/server/kernelManager';
import { mapKernelError } from '@/lib/server/codeRunHttp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = CodeSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid session', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    await kernelManager.reset(parsed.data.courseSlug, parsed.data.lessonSlug);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body: errBody } = mapKernelError(err);
    return NextResponse.json(errBody, { status });
  }
}
