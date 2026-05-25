import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

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
  listDraftSourceFilesSync,
  resolveSourcePathForPrompt,
  type ResolvedSourcePath,
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
  // uploads. We hand the agent paths only — it Reads each file itself via
  // the Read tool. Inlining the extracted text used to blow past 150 KB for
  // multi-PDF uploads and break spawn with E2BIG.
  let sources: ResolvedSourcePath[] = [];
  if (typeof parsed.data.draftId === 'string' && parsed.data.draftId.length > 0) {
    try {
      sources = listDraftSourceFilesSync(parsed.data.draftId).map(
        resolveSourcePathForPrompt,
      );
    } catch (err) {
      console.warn(
        `[wizard/clarify] ignoring draftId=${JSON.stringify(parsed.data.draftId)}: ${(err as Error).message}`,
      );
    }
  }

  const userMessage =
    buildClarifyUserMessage(parsed.data, sources) + CLARIFY_MODEL_HINT;

  // US-128: opt-in dump of the assembled prompt for smoke-testing the
  // grounding pass on a real PDF.
  if (process.env.GENERATION_DEBUG === '1') {
    const dumpPath = path.join(tmpdir(), 'wizard-clarify-prompt.txt');
    fs.writeFile(dumpPath, userMessage, 'utf8').catch((err) =>
      console.warn(
        `[wizard/clarify] GENERATION_DEBUG dump failed: ${(err as Error).message}`,
      ),
    );
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await connector.chat({
        systemPrompt: CLARIFY_SYSTEM_PROMPT,
        userMessage,
        // When uploads are present, allow the agent to invoke Read on the
        // listed paths. With Read disabled the model would have no way to
        // see the file content and would fall back to inventing questions.
        allowTools: sources.length > 0,
        // Reading several PDF extracts in series easily pushes past the
        // 60s connector default for lesson chat. 4 min mirrors the
        // structure route's existing bump.
        timeoutMs: 240_000,
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
