import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import * as connectorModule from '@/lib/lessonChat/connector';
import type { ChatStreamEvent, Connector, ConnectorRequest } from '@/lib/lessonChat/connector';
import { POST } from '@/app/api/wizard/clarify/route';
import { draftSourcesDir, makeDraftId } from '@/lib/server/sources';
import type { ResolvedSourcePath } from '@/lib/server/sources';
import {
  buildClarifyUserMessage,
  CLARIFY_SYSTEM_PROMPT,
  ClarifyRequestSchema,
  ClarifyResponseSchema,
  extractJsonPayload,
  parseClarifyResponse,
} from './clarify';

function fakeConnector(
  chatImpl: (req: ConnectorRequest) => Promise<string>,
  streamImpl?: (req: ConnectorRequest, signal: AbortSignal) => AsyncIterable<ChatStreamEvent>,
): Connector {
  return {
    name: 'subprocess',
    chat: chatImpl,
    chatStream:
      streamImpl ??
      (async function* () {
        const text = await chatImpl({} as ConnectorRequest);
        yield { type: 'token', text };
        yield { type: 'done' };
      }),
  };
}

afterEach(() => {
  connectorModule._resetConnectorCacheForTesting();
  vi.restoreAllMocks();
});

describe('ClarifyRequestSchema', () => {
  it('accepts a fully populated draft', () => {
    const ok = ClarifyRequestSchema.safeParse({
      topic: 'How transformers work',
      refine: {
        level: 'intermediate',
        durationTarget: 'standard',
        theoryPracticeRatio: 50,
      },
    });
    expect(ok.success).toBe(true);
  });

  it('accepts a draft with null level/duration (Stage 2 partial state)', () => {
    const ok = ClarifyRequestSchema.safeParse({
      topic: 'Bayesian inference',
      refine: {
        level: null,
        durationTarget: null,
        theoryPracticeRatio: 75,
      },
    });
    expect(ok.success).toBe(true);
  });

  it('rejects an empty topic', () => {
    const bad = ClarifyRequestSchema.safeParse({
      topic: '',
      refine: { level: null, durationTarget: null, theoryPracticeRatio: 50 },
    });
    expect(bad.success).toBe(false);
  });
});

describe('buildClarifyUserMessage', () => {
  it('embeds topic, level, duration label, and ratio', () => {
    const msg = buildClarifyUserMessage({
      topic: 'How transformers work',
      refine: {
        level: 'intermediate',
        durationTarget: 'extensive',
        theoryPracticeRatio: 80,
      },
    });
    expect(msg).toContain('How transformers work');
    expect(msg).toContain('intermediate');
    expect(msg).toContain('extensive course (20–30 lessons)');
    expect(msg).toContain('mostly practice');
    expect(msg).toContain('80/100');
  });

  it('handles null level + duration with sensible labels', () => {
    const msg = buildClarifyUserMessage({
      topic: 'Linear algebra',
      refine: { level: null, durationTarget: null, theoryPracticeRatio: 50 },
    });
    expect(msg).toContain('unspecified');
    expect(msg).toContain('balanced');
  });

  it('embeds description when provided (US-123)', () => {
    const msg = buildClarifyUserMessage({
      topic: 'Linear algebra',
      description: 'I want to learn enough linear algebra to read ML papers.',
      refine: { level: 'beginner', durationTarget: 'short', theoryPracticeRatio: 50 },
    });
    expect(msg).toContain('Description: I want to learn enough linear algebra to read ML papers.');
  });

  it('omits description block when description is missing or whitespace-only (US-123)', () => {
    const without = buildClarifyUserMessage({
      topic: 'Linear algebra',
      refine: { level: 'beginner', durationTarget: 'short', theoryPracticeRatio: 50 },
    });
    expect(without).not.toMatch(/Description:/);
    const blank = buildClarifyUserMessage({
      topic: 'Linear algebra',
      description: '   ',
      refine: { level: 'beginner', durationTarget: 'short', theoryPracticeRatio: 50 },
    });
    expect(blank).not.toMatch(/Description:/);
  });

  it('regression: produces identical output when sources is undefined or [] (US-125)', () => {
    const reqArgs = {
      topic: 'Linear algebra',
      description: 'Goal',
      refine: { level: 'beginner' as const, durationTarget: 'short' as const, theoryPracticeRatio: 50 },
    };
    const baseline = buildClarifyUserMessage(reqArgs);
    const withUndefined = buildClarifyUserMessage(reqArgs, undefined);
    const withEmpty = buildClarifyUserMessage(reqArgs, []);
    expect(withUndefined).toBe(baseline);
    expect(withEmpty).toBe(baseline);
    expect(baseline).not.toContain('Learner-uploaded source materials:');
  });

  it('appends a Learner-uploaded source materials block listing absolute paths', () => {
    const sources: ResolvedSourcePath[] = [
      { readPath: '/abs/a.txt', originalName: 'a.txt' },
      {
        readPath: '/abs/.extracted/m.docx.md',
        originalName: 'm.docx',
        extractedFrom: 'm.docx',
      },
      {
        readPath: '/abs/.extracted/lecture.pdf.md',
        originalName: 'lecture.pdf',
        extractedFrom: 'lecture.pdf',
      },
    ];
    const msg = buildClarifyUserMessage(
      {
        topic: 'Linear algebra',
        refine: { level: 'beginner', durationTarget: 'short', theoryPracticeRatio: 50 },
      },
      sources,
    );

    expect(msg).toContain('Learner-uploaded source materials');
    expect(msg).toContain('Read each path with the Read tool');
    expect(msg).toContain('- /abs/a.txt');
    expect(msg).toContain('- /abs/.extracted/m.docx.md (extracted text from m.docx)');
    expect(msg).toContain('- /abs/.extracted/lecture.pdf.md (extracted text from lecture.pdf)');

    // Block order: header → each path line → final 'Generate …' instruction.
    const headerIdx = msg.indexOf('Learner-uploaded source materials');
    const aIdx = msg.indexOf('- /abs/a.txt');
    const mIdx = msg.indexOf('- /abs/.extracted/m.docx.md');
    const pdfIdx = msg.indexOf('- /abs/.extracted/lecture.pdf.md');
    const generateIdx = msg.indexOf('Generate up to 10 clarification questions');
    expect(headerIdx).toBeGreaterThan(0);
    expect(aIdx).toBeGreaterThan(headerIdx);
    expect(mIdx).toBeGreaterThan(aIdx);
    expect(pdfIdx).toBeGreaterThan(mIdx);
    expect(generateIdx).toBeGreaterThan(pdfIdx);
  });
});

describe('extractJsonPayload', () => {
  it('parses raw JSON', () => {
    expect(extractJsonPayload('{"questions":[]}')).toEqual({ questions: [] });
  });

  it('parses ```json fenced JSON', () => {
    expect(
      extractJsonPayload('```json\n{"questions":[{"id":"q1","text":"hi"}]}\n```'),
    ).toEqual({ questions: [{ id: 'q1', text: 'hi' }] });
  });

  it('parses ``` fenced JSON without language tag', () => {
    expect(extractJsonPayload('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('falls back to brace-scan when prose surrounds JSON', () => {
    const raw = 'Here you go: {"questions": [{"id":"q1","text":"x"}]} cheers!';
    expect(extractJsonPayload(raw)).toEqual({
      questions: [{ id: 'q1', text: 'x' }],
    });
  });

  it('throws when no JSON object is present', () => {
    expect(() => extractJsonPayload('totally not json')).toThrow();
  });
});

describe('parseClarifyResponse', () => {
  it('parses a valid 3-question response', () => {
    const r = parseClarifyResponse(
      JSON.stringify({
        questions: [
          { id: 'q1', text: 'What is your goal?' },
          { id: 'q2', text: 'What examples resonate with you?' },
          { id: 'q3', text: 'How will you apply this?' },
        ],
      }),
    );
    expect(r.questions).toHaveLength(3);
    expect(r.questions[0]).toEqual({ id: 'q1', text: 'What is your goal?' });
  });

  it('caps the array at 10 entries', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `q${i + 1}`,
      text: `Question ${i + 1}?`,
    }));
    const r = parseClarifyResponse(JSON.stringify({ questions: many }));
    expect(r.questions).toHaveLength(10);
  });

  it('auto-fills missing ids with q<n>', () => {
    const r = parseClarifyResponse(
      JSON.stringify({ questions: [{ text: 'A?' }, { text: 'B?' }] }),
    );
    expect(r.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
  });

  it('dedupes colliding ids', () => {
    const r = parseClarifyResponse(
      JSON.stringify({
        questions: [
          { id: 'dup', text: 'first' },
          { id: 'dup', text: 'second' },
        ],
      }),
    );
    expect(r.questions[0].id).toBe('dup');
    expect(r.questions[1].id).not.toBe('dup');
  });

  it('skips entries with empty text', () => {
    const r = parseClarifyResponse(
      JSON.stringify({
        questions: [
          { id: 'q1', text: '   ' },
          { id: 'q2', text: 'real one' },
        ],
      }),
    );
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].text).toBe('real one');
  });

  it('throws on missing questions array', () => {
    expect(() => parseClarifyResponse('{}')).toThrow();
  });

  it('throws when all entries are empty', () => {
    expect(() =>
      parseClarifyResponse(JSON.stringify({ questions: [{ text: '' }] })),
    ).toThrow();
  });

  it('round-trips through ClarifyResponseSchema', () => {
    const r = parseClarifyResponse(
      JSON.stringify({ questions: [{ id: 'q1', text: 'why?' }] }),
    );
    expect(ClarifyResponseSchema.safeParse(r).success).toBe(true);
  });
});

describe('CLARIFY_SYSTEM_PROMPT', () => {
  it('mentions strict JSON', () => {
    expect(CLARIFY_SYSTEM_PROMPT).toMatch(/STRICT JSON/);
  });
});

// ---------------------------------------------------------------------------
// Route integration
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request('http://x/api/wizard/clarify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/wizard/clarify', () => {
  it('400 on invalid JSON body', async () => {
    const req = new Request('http://x/api/wizard/clarify', {
      method: 'POST',
      body: '{not json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('400 when topic is missing', async () => {
    const res = await POST(
      makeRequest({
        refine: { level: null, durationTarget: null, theoryPracticeRatio: 50 },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('503 when no connector is available', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(null);
    const res = await POST(
      makeRequest({
        topic: 'How transformers work',
        refine: {
          level: 'intermediate',
          durationTarget: 'standard',
          theoryPracticeRatio: 50,
        },
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      'AI Tutor unavailable: install Claude Code CLI or sign in to Claude Max.',
    );
  });

  it('200 returns parsed questions on success', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async () =>
        JSON.stringify({
          questions: [
            { id: 'q1', text: 'What is your goal?' },
            { id: 'q2', text: 'What is your background?' },
          ],
        }),
      ),
    );
    const res = await POST(
      makeRequest({
        topic: 'Bayesian inference',
        refine: {
          level: 'beginner',
          durationTarget: 'short',
          theoryPracticeRatio: 50,
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { questions: { id: string; text: string }[] };
    expect(body.questions).toHaveLength(2);
    expect(body.questions[0].text).toBe('What is your goal?');
  });

  it('retries once on parse failure, then succeeds', async () => {
    let calls = 0;
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async () => {
        calls += 1;
        if (calls === 1) return 'I am sorry but I cannot.';
        return JSON.stringify({
          questions: [{ id: 'q1', text: 'What do you know already?' }],
        });
      }),
    );
    const res = await POST(
      makeRequest({
        topic: 'How transformers work',
        refine: {
          level: null,
          durationTarget: null,
          theoryPracticeRatio: 50,
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    const body = (await res.json()) as { questions: { id: string; text: string }[] };
    expect(body.questions).toHaveLength(1);
  });

  it('502 with error message after two parse failures', async () => {
    let calls = 0;
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async () => {
        calls += 1;
        return 'absolutely no JSON here, no braces either';
      }),
    );
    const res = await POST(
      makeRequest({
        topic: 'How transformers work',
        refine: {
          level: 'intermediate',
          durationTarget: 'standard',
          theoryPracticeRatio: 60,
        },
      }),
    );
    expect(res.status).toBe(502);
    expect(calls).toBe(2);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Clarification generator failed/);
  });

  it('forwards staged-uploads paths into the user message when draftId is present', async () => {
    // Stand up an isolated coursesRoot containing one staged .txt source.
    const coursesRoot = await fs.mkdtemp(
      path.join(tmpdir(), 'ai-lecturer-clarify-route-'),
    );
    process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
    try {
      const draftId = makeDraftId();
      const dir = draftSourcesDir(draftId);
      await fs.mkdir(dir, { recursive: true });
      const absPath = path.join(dir, 'a.txt');
      await fs.writeFile(absPath, 'STAGED-TXT-CONTENT');

      let captured: ConnectorRequest | null = null;
      vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
        fakeConnector(async (req) => {
          captured = req;
          return JSON.stringify({
            questions: [{ id: 'q1', text: 'What is your goal?' }],
          });
        }),
      );

      const res = await POST(
        makeRequest({
          topic: 'Linear algebra',
          refine: { level: 'beginner', durationTarget: 'short', theoryPracticeRatio: 50 },
          draftId,
        }),
      );
      expect(res.status).toBe(200);
      expect(captured).not.toBeNull();
      const captured0 = captured as unknown as ConnectorRequest;
      // Path is listed for the Read tool — content is NOT inlined.
      expect(captured0.userMessage).toContain('Learner-uploaded source materials');
      expect(captured0.userMessage).toContain(`- ${absPath}`);
      expect(captured0.userMessage).not.toContain('STAGED-TXT-CONTENT');
      // Tool use is opted in so Claude can actually Read the path.
      expect(captured0.allowTools).toBe(true);
    } finally {
      delete process.env.COURSES_ROOT_OVERRIDE;
      await fs.rm(coursesRoot, { recursive: true, force: true });
    }
  });

  it('omits the Learner-uploaded source materials block when no draftId is sent (US-125)', async () => {
    let captured: ConnectorRequest | null = null;
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async (req) => {
        captured = req;
        return JSON.stringify({
          questions: [{ id: 'q1', text: 'What is your goal?' }],
        });
      }),
    );
    const res = await POST(
      makeRequest({
        topic: 'How transformers work',
        refine: { level: 'beginner', durationTarget: 'short', theoryPracticeRatio: 50 },
      }),
    );
    expect(res.status).toBe(200);
    expect(captured).not.toBeNull();
    const captured0 = captured as unknown as ConnectorRequest;
    expect(captured0.userMessage).not.toContain('Learner-uploaded source materials');
    expect(captured0.allowTools).toBe(false);
  });

  it('caps response array at 10 even if model returns more', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async () =>
        JSON.stringify({
          questions: Array.from({ length: 15 }, (_, i) => ({
            id: `q${i + 1}`,
            text: `Question ${i + 1}?`,
          })),
        }),
      ),
    );
    const res = await POST(
      makeRequest({
        topic: 'How transformers work',
        refine: {
          level: 'beginner',
          durationTarget: 'standard',
          theoryPracticeRatio: 50,
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { questions: unknown[] };
    expect(body.questions).toHaveLength(10);
  });
});
