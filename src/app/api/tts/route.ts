import { NextResponse } from 'next/server';
import { TtsRequestSchema } from '@/lib/schemas/tts';
import {
  TtsNotInstalledError,
  TtsSpawnError,
  runTts,
  ttsResponseFromResult,
} from '@/lib/server/tts';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = TtsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await runTts(parsed.data);
    return NextResponse.json(ttsResponseFromResult(result));
  } catch (err) {
    if (err instanceof TtsNotInstalledError) {
      return NextResponse.json(
        {
          error: 'tts-not-installed',
          message: 'Run scripts/setup-tts.sh first.',
        },
        { status: 503 },
      );
    }
    if (err instanceof TtsSpawnError) {
      return NextResponse.json(
        { error: 'tts-spawn-failed', message: err.message },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: 'Unexpected error', detail: String(err) },
      { status: 500 },
    );
  }
}
