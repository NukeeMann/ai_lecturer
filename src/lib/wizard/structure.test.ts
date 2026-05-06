import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import * as connectorModule from '@/lib/lessonChat/connector';
import type {
  ChatStreamEvent,
  Connector,
  ConnectorRequest,
} from '@/lib/lessonChat/connector';
import { POST } from '@/app/api/wizard/structure/route';
import { draftSourcesDir, makeDraftId } from '@/lib/server/sources';
import type { StagedSourceForPrompt } from '@/lib/server/sources';
import {
  STRUCTURE_SYSTEM_PROMPT,
  StructureRequestSchema,
  buildStructureUserMessage,
  CourseStructureSchema,
  parseStructureResponse,
} from './structure';

function fakeConnector(
  chatImpl: (req: ConnectorRequest) => Promise<string>,
  streamImpl?: (
    req: ConnectorRequest,
    signal: AbortSignal,
  ) => AsyncIterable<ChatStreamEvent>,
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

describe('StructureRequestSchema', () => {
  it('accepts a fully populated draft with clarification answers', () => {
    const ok = StructureRequestSchema.safeParse({
      topic: 'How transformers work',
      refine: {
        level: 'intermediate',
        durationTarget: 'standard',
        theoryPracticeRatio: 50,
      },
      clarification: { 'q1: What is your goal?': 'apply to NLP' },
    });
    expect(ok.success).toBe(true);
  });

  it('accepts a draft without clarification answers', () => {
    const ok = StructureRequestSchema.safeParse({
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
    const bad = StructureRequestSchema.safeParse({
      topic: '',
      refine: { level: null, durationTarget: null, theoryPracticeRatio: 50 },
    });
    expect(bad.success).toBe(false);
  });
});

describe('buildStructureUserMessage', () => {
  it('embeds topic, level, duration label, and ratio', () => {
    const msg = buildStructureUserMessage({
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

  it('includes clarification Q&A when provided and skips empty answers', () => {
    const msg = buildStructureUserMessage({
      topic: 'Linear algebra',
      refine: {
        level: 'beginner',
        durationTarget: 'short',
        theoryPracticeRatio: 50,
      },
      clarification: {
        'q1: What is your goal?': 'use it for ML',
        'q2: How much time do you have?': '   ', // blank — should be skipped
      },
    });
    expect(msg).toContain('q1: What is your goal? → use it for ML');
    expect(msg).not.toContain('q2: How much time do you have?');
  });

  it('omits the clarification block entirely when no answers provided', () => {
    const msg = buildStructureUserMessage({
      topic: 'Linear algebra',
      refine: { level: null, durationTarget: null, theoryPracticeRatio: 50 },
    });
    expect(msg).not.toContain("Learner's clarification answers");
  });

  it('embeds description when provided and forwards alongside clarification answers (US-123)', () => {
    const msg = buildStructureUserMessage({
      topic: 'Linear algebra',
      description: 'I want to read ML papers without losing the thread on matrix calc.',
      refine: { level: 'beginner', durationTarget: 'short', theoryPracticeRatio: 50 },
      clarification: { 'q1: What is your goal?': 'apply to ML' },
    });
    expect(msg).toContain('Description: I want to read ML papers without losing the thread on matrix calc.');
    expect(msg).toContain('q1: What is your goal? → apply to ML');
  });

  it('omits description block when description is missing or whitespace-only (US-123)', () => {
    const without = buildStructureUserMessage({
      topic: 'Linear algebra',
      refine: { level: null, durationTarget: null, theoryPracticeRatio: 50 },
    });
    expect(without).not.toMatch(/Description:/);
    const blank = buildStructureUserMessage({
      topic: 'Linear algebra',
      description: '   ',
      refine: { level: null, durationTarget: null, theoryPracticeRatio: 50 },
    });
    expect(blank).not.toMatch(/Description:/);
  });

  it('regression: produces identical output when sources is undefined or [] (US-125)', () => {
    const reqArgs = {
      topic: 'Linear algebra',
      description: 'Goal',
      refine: { level: 'beginner' as const, durationTarget: 'short' as const, theoryPracticeRatio: 50 },
      clarification: { 'q1: goal': 'apply to ML' },
    };
    const baseline = buildStructureUserMessage(reqArgs);
    const withUndefined = buildStructureUserMessage(reqArgs, undefined);
    const withEmpty = buildStructureUserMessage(reqArgs, []);
    expect(withUndefined).toBe(baseline);
    expect(withEmpty).toBe(baseline);
    expect(baseline).not.toContain('Learner-uploaded source materials:');
  });

  it('appends a Learner-uploaded source materials block BEFORE the final Generate line (US-125)', () => {
    const sources: StagedSourceForPrompt[] = [
      { kind: 'text', originalName: 'a.txt', content: 'TXT-BODY-XYZ' },
      {
        kind: 'text',
        originalName: 'm.docx',
        extractedFrom: 'm.docx',
        content: 'DOCX-EXTRACTED-BODY',
      },
      { kind: 'binary-unsupported', originalName: 'z.pdf' },
    ];
    const msg = buildStructureUserMessage(
      {
        topic: 'Linear algebra',
        refine: { level: 'beginner', durationTarget: 'short', theoryPracticeRatio: 50 },
      },
      sources,
    );

    expect(msg).toContain('Learner-uploaded source materials:');
    expect(msg).toContain('=== a.txt ===');
    expect(msg).toContain('TXT-BODY-XYZ');
    expect(msg).toContain('=== m.docx (extracted from docx) ===');
    expect(msg).toContain('DOCX-EXTRACTED-BODY');
    expect(msg).toContain('=== z.pdf ===');

    // Block order: header → each filename heading → final 'Generate …' instruction.
    const headerIdx = msg.indexOf('Learner-uploaded source materials:');
    const aIdx = msg.indexOf('=== a.txt ===');
    const mIdx = msg.indexOf('=== m.docx (extracted from docx) ===');
    const zIdx = msg.indexOf('=== z.pdf ===');
    const generateIdx = msg.indexOf('Generate the full module → lesson outline');
    expect(headerIdx).toBeGreaterThan(0);
    expect(aIdx).toBeGreaterThan(headerIdx);
    expect(mIdx).toBeGreaterThan(aIdx);
    expect(zIdx).toBeGreaterThan(mIdx);
    expect(generateIdx).toBeGreaterThan(zIdx);
  });
});

describe('parseStructureResponse', () => {
  it('parses a valid 1-module / 2-lesson response', () => {
    const raw = JSON.stringify({
      courseTitle: 'Introduction to X',
      courseDescription: 'A short intro to X.',
      modules: [
        {
          title: 'Module 1: Basics',
          lessons: [
            { title: 'Lesson A', description: 'Learn A.', estimatedMinutes: 10 },
            { title: 'Lesson B', description: 'Learn B.', estimatedMinutes: 12 },
          ],
        },
      ],
    });
    const r = parseStructureResponse(raw);
    expect(r.courseTitle).toBe('Introduction to X');
    expect(r.modules).toHaveLength(1);
    expect(r.modules[0].lessons).toHaveLength(2);
    expect(r.modules[0].lessons[0]).toEqual({
      title: 'Lesson A',
      description: 'Learn A.',
      estimatedMinutes: 10,
    });
  });

  it('parses response wrapped in ```json``` fences', () => {
    const raw = `\`\`\`json
${JSON.stringify({
      courseTitle: 'T',
      courseDescription: 'D',
      modules: [
        {
          title: 'M1',
          lessons: [
            { title: 'L1', description: 'd', estimatedMinutes: 8 },
          ],
        },
      ],
    })}
\`\`\``;
    const r = parseStructureResponse(raw);
    expect(r.modules).toHaveLength(1);
  });

  it('drops modules with empty lesson lists', () => {
    const r = parseStructureResponse(
      JSON.stringify({
        courseTitle: 'T',
        courseDescription: 'D',
        modules: [
          {
            title: 'M1',
            lessons: [
              { title: 'L1', description: 'd', estimatedMinutes: 8 },
            ],
          },
          { title: 'M2 (orphan)', lessons: [] },
        ],
      }),
    );
    expect(r.modules).toHaveLength(1);
    expect(r.modules[0].title).toBe('M1');
  });

  it('drops lessons missing required fields', () => {
    const r = parseStructureResponse(
      JSON.stringify({
        courseTitle: 'T',
        courseDescription: 'D',
        modules: [
          {
            title: 'M1',
            lessons: [
              { title: 'OK', description: 'd', estimatedMinutes: 5 },
              { title: '', description: 'd', estimatedMinutes: 5 }, // empty title
              { title: 'No mins', description: 'd' }, // missing minutes
              { title: 'Zero mins', description: 'd', estimatedMinutes: 0 }, // bad minutes
            ],
          },
        ],
      }),
    );
    expect(r.modules[0].lessons).toHaveLength(1);
    expect(r.modules[0].lessons[0].title).toBe('OK');
  });

  it('rounds non-integer estimatedMinutes', () => {
    const r = parseStructureResponse(
      JSON.stringify({
        courseTitle: 'T',
        courseDescription: 'D',
        modules: [
          {
            title: 'M1',
            lessons: [
              { title: 'L1', description: 'd', estimatedMinutes: 12.7 },
            ],
          },
        ],
      }),
    );
    expect(r.modules[0].lessons[0].estimatedMinutes).toBe(13);
  });

  it('throws on missing courseTitle', () => {
    expect(() =>
      parseStructureResponse(
        JSON.stringify({ courseDescription: 'D', modules: [] }),
      ),
    ).toThrow();
  });

  it('throws when all modules are invalid', () => {
    expect(() =>
      parseStructureResponse(
        JSON.stringify({
          courseTitle: 'T',
          courseDescription: 'D',
          modules: [{ title: '', lessons: [] }],
        }),
      ),
    ).toThrow();
  });

  it('throws on non-JSON garbage', () => {
    expect(() => parseStructureResponse('totally not json')).toThrow();
  });

  it('round-trips through CourseStructureSchema', () => {
    const r = parseStructureResponse(
      JSON.stringify({
        courseTitle: 'T',
        courseDescription: 'D',
        modules: [
          {
            title: 'M1',
            lessons: [
              { title: 'L1', description: 'd', estimatedMinutes: 8 },
            ],
          },
        ],
      }),
    );
    expect(CourseStructureSchema.safeParse(r).success).toBe(true);
  });
});

describe('STRUCTURE_SYSTEM_PROMPT', () => {
  it('mentions strict JSON', () => {
    expect(STRUCTURE_SYSTEM_PROMPT).toMatch(/STRICT JSON/);
  });
});

// ---------------------------------------------------------------------------
// Route integration
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request('http://x/api/wizard/structure', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID_REPLY = JSON.stringify({
  courseTitle: 'Bayesian inference for engineers',
  courseDescription: 'A practical guide to Bayes for working engineers.',
  modules: [
    {
      title: 'Module 1: Foundations',
      lessons: [
        {
          title: 'Lesson 1: Probability refresher',
          description: 'Recall key probability axioms.',
          estimatedMinutes: 10,
        },
        {
          title: 'Lesson 2: Bayes rule',
          description: 'Derive and apply Bayes rule.',
          estimatedMinutes: 12,
        },
      ],
    },
  ],
});

describe('POST /api/wizard/structure', () => {
  it('400 on invalid JSON body', async () => {
    const req = new Request('http://x/api/wizard/structure', {
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

  it('200 returns parsed CourseStructure on success', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async () => VALID_REPLY),
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
    const body = (await res.json()) as {
      courseTitle: string;
      modules: { title: string; lessons: unknown[] }[];
    };
    expect(body.courseTitle).toBe('Bayesian inference for engineers');
    expect(body.modules).toHaveLength(1);
    expect(body.modules[0].lessons).toHaveLength(2);
  });

  it('retries once on parse failure, then succeeds', async () => {
    let calls = 0;
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async () => {
        calls += 1;
        if (calls === 1) return 'I am sorry but I cannot.';
        return VALID_REPLY;
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
    expect(body.error).toMatch(/Structure generator failed/);
  });

  it('forwards clarification answers into the prompt', async () => {
    let captured: ConnectorRequest | null = null;
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async (req) => {
        captured = req;
        return VALID_REPLY;
      }),
    );
    const res = await POST(
      makeRequest({
        topic: 'How transformers work',
        refine: {
          level: 'intermediate',
          durationTarget: 'standard',
          theoryPracticeRatio: 50,
        },
        clarification: {
          'q1: What is your goal?': 'apply to NLP at work',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(captured).not.toBeNull();
    const userMessage = (captured as unknown as ConnectorRequest).userMessage;
    expect(userMessage).toContain('apply to NLP at work');
  });

  it('forwards staged-uploads content into the user message when draftId is present (US-125)', async () => {
    const coursesRoot = await fs.mkdtemp(
      path.join(tmpdir(), 'ai-lecturer-structure-route-'),
    );
    process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
    try {
      const draftId = makeDraftId();
      const dir = draftSourcesDir(draftId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'a.txt'), 'STAGED-TXT-CONTENT');

      let captured: ConnectorRequest | null = null;
      vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
        fakeConnector(async (req) => {
          captured = req;
          return VALID_REPLY;
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
      expect(captured0.userMessage).toContain('Learner-uploaded source materials:');
      expect(captured0.userMessage).toContain('=== a.txt ===');
      expect(captured0.userMessage).toContain('STAGED-TXT-CONTENT');
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
        return VALID_REPLY;
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
    expect(captured0.userMessage).not.toContain('Learner-uploaded source materials:');
  });
});
