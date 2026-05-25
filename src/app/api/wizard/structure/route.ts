import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { NextResponse } from 'next/server';
import { selectConnector } from '@/lib/lessonChat/connector';
import {
  STRUCTURE_SYSTEM_PROMPT,
  StructureRequestSchema,
  buildStructureUserMessage,
  parseStructureResponse,
  type CourseStructure,
} from '@/lib/wizard/structure';
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

  // US-125: when a draft id is supplied, ground the prompt in the staged
  // uploads. Pass paths only — the agent Reads each file via the Read tool
  // rather than receiving inlined extracted text (which used to blow past
  // 150 KB on multi-PDF uploads and break spawn with E2BIG).
  let sources: ResolvedSourcePath[] = [];
  if (typeof parsed.data.draftId === 'string' && parsed.data.draftId.length > 0) {
    try {
      sources = listDraftSourceFilesSync(parsed.data.draftId).map(
        resolveSourcePathForPrompt,
      );
    } catch (err) {
      console.warn(
        `[wizard/structure] ignoring draftId=${JSON.stringify(parsed.data.draftId)}: ${(err as Error).message}`,
      );
    }
  }

  const userMessage =
    buildStructureUserMessage(parsed.data, sources) + STRUCTURE_MODEL_HINT;

  // US-128: opt-in dump of the assembled prompt for smoke-testing the
  // grounding pass on a real PDF. Best-effort — failures are logged and
  // ignored so a missing /tmp dir cannot 500 the route.
  if (process.env.GENERATION_DEBUG === '1') {
    const dumpPath = path.join(tmpdir(), 'wizard-structure-prompt.txt');
    fs.writeFile(dumpPath, userMessage, 'utf8').catch((err) =>
      console.warn(
        `[wizard/structure] GENERATION_DEBUG dump failed: ${(err as Error).message}`,
      ),
    );
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await connector.chat({
        systemPrompt: STRUCTURE_SYSTEM_PROMPT,
        userMessage,
        // When uploads are present, allow the agent to invoke Read on the
        // listed paths so the outline is actually grounded in their
        // content rather than the filenames alone.
        allowTools: sources.length > 0,
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
