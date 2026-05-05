import { NextResponse } from 'next/server';
import { selectConnector } from '@/lib/lessonChat/connector';
import {
  STRUCTURE_SYSTEM_PROMPT,
  StructureRequestSchema,
  buildStructureUserMessage,
  parseStructureResponse,
  type CourseStructure,
} from '@/lib/wizard/structure';

export const dynamic = 'force-dynamic';

const UNAVAILABLE_BODY = {
  error:
    'AI Tutor unavailable: install Claude Code CLI or sign in to Claude Max.',
};

const STRUCTURE_MODEL_HINT =
  '\n\n(Use the claude-opus-4-7 model — return JSON ONLY, no prose.)';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = StructureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const connector = await selectConnector();
  if (!connector) {
    return NextResponse.json(UNAVAILABLE_BODY, { status: 503 });
  }

  const userMessage =
    buildStructureUserMessage(parsed.data) + STRUCTURE_MODEL_HINT;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await connector.chat({
        systemPrompt: STRUCTURE_SYSTEM_PROMPT,
        userMessage,
        // Structure generation drafts a full course outline with Opus and
        // routinely takes >60s; the connector default is meant for
        // interactive lesson chat.
        timeoutMs: 240_000,
      });
      const result: CourseStructure = parseStructureResponse(reply);
      return NextResponse.json(result);
    } catch (err) {
      lastError = err as Error;
      console.warn(
        `[wizard/structure] attempt ${attempt + 1} failed: ${lastError.message}`,
      );
    }
  }

  return NextResponse.json(
    {
      error: `Structure generator failed: ${lastError?.message ?? 'unknown error'}`,
    },
    { status: 502 },
  );
}
