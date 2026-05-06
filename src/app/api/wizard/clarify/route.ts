import { NextResponse } from 'next/server';
import { selectConnector } from '@/lib/lessonChat/connector';
import {
  CLARIFY_SYSTEM_PROMPT,
  ClarifyRequestSchema,
  buildClarifyUserMessage,
  parseClarifyResponse,
  type ClarifyResponse,
} from '@/lib/wizard/clarify';
import {
  loadStagedSourcesForPrompt,
  type StagedSourceForPrompt,
} from '@/lib/server/sources';

export const dynamic = 'force-dynamic';

const UNAVAILABLE_BODY = {
  error:
    'AI Tutor unavailable: install Claude Code CLI or sign in to Claude Max.',
};

const CLARIFY_MODEL_HINT =
  '\n\n(Use the claude-opus-4-7 model — return JSON ONLY, no prose.)';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ClarifyRequestSchema.safeParse(body);
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

  // US-125: when a draft id is supplied, ground the prompt in the staged
  // uploads. An invalid id (path traversal etc.) is logged once and the
  // route falls back to the source-less prompt rather than 400'ing.
  let sources: StagedSourceForPrompt[] = [];
  if (typeof parsed.data.draftId === 'string' && parsed.data.draftId.length > 0) {
    try {
      sources = loadStagedSourcesForPrompt(parsed.data.draftId);
    } catch (err) {
      console.warn(
        `[wizard/clarify] ignoring draftId=${JSON.stringify(parsed.data.draftId)}: ${(err as Error).message}`,
      );
    }
  }

  const userMessage =
    buildClarifyUserMessage(parsed.data, sources) + CLARIFY_MODEL_HINT;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await connector.chat({
        systemPrompt: CLARIFY_SYSTEM_PROMPT,
        userMessage,
      });
      const result: ClarifyResponse = parseClarifyResponse(reply);
      return NextResponse.json(result);
    } catch (err) {
      lastError = err as Error;
      console.warn(
        `[wizard/clarify] attempt ${attempt + 1} failed: ${lastError.message}`,
      );
    }
  }

  return NextResponse.json(
    {
      error: `Clarification generator failed: ${lastError?.message ?? 'unknown error'}`,
    },
    { status: 502 },
  );
}
