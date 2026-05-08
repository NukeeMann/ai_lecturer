import { NextResponse } from 'next/server';
import { SttRequestSchema } from '@/lib/schemas/tts';
import {
  SttNotInstalledError,
  SttPathError,
  SttSpawnError,
  processSttRequest,
} from '@/lib/server/stt';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = SttRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const response = await processSttRequest(parsed.data);
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof SttPathError) {
      return NextResponse.json(
        { error: 'invalid-audio-path', message: err.message },
        { status: 400 },
      );
    }
    if (err instanceof SttNotInstalledError) {
      return NextResponse.json(
        {
          error: 'stt-not-installed',
          message: 'Run scripts/setup-stt.sh first.',
        },
        { status: 503 },
      );
    }
    if (err instanceof SttSpawnError) {
      return NextResponse.json(
        { error: 'stt-spawn-failed', message: err.message },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: 'Unexpected error', detail: String(err) },
      { status: 500 },
    );
  }
}
