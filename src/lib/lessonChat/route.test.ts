import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as connectorModule from './connector';
import type { ChatStreamEvent, Connector, ConnectorRequest } from './connector';
import { POST } from '@/app/api/lesson-chat/route';
import { DELETE } from '@/app/api/lesson-chat/[requestId]/route';
import {
  _inflightSizeForTesting,
  _resetInflightForTesting,
} from './inflight';

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

let tmpRoot: string;
let originalRoot: string | undefined;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'lesson-chat-route-'));
  originalRoot = process.env.COURSES_ROOT_OVERRIDE;
  process.env.COURSES_ROOT_OVERRIDE = tmpRoot;

  const lessonsDir = path.join(tmpRoot, 'c', 'lessons');
  mkdirSync(lessonsDir, { recursive: true });
  writeFileSync(
    path.join(lessonsDir, 'l.json'),
    JSON.stringify({
      schemaVersion: 1,
      slug: 'l',
      courseSlug: 'c',
      moduleId: 'm1',
      title: 'Test Lesson',
      eyebrow: 'Module 1',
      description: 'Test description',
      estimatedMinutes: 10,
      sections: [
        {
          id: 's1',
          title: 'Intro',
          type: 'theory',
          data: { markdown: 'Hello world.' },
        },
      ],
    }),
  );
});

afterAll(() => {
  if (originalRoot === undefined) {
    delete process.env.COURSES_ROOT_OVERRIDE;
  } else {
    process.env.COURSES_ROOT_OVERRIDE = originalRoot;
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
  connectorModule._resetConnectorCacheForTesting();
  _resetInflightForTesting();
  vi.restoreAllMocks();
});

function makeStreamRequest(body: unknown): Request {
  return new Request('http://x/api/lesson-chat', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
  });
}

async function readSseEvents(res: Response): Promise<Array<{ event: string; data: string }>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  buf += decoder.decode();
  const events: Array<{ event: string; data: string }> = [];
  for (const block of buf.split('\n\n')) {
    if (!block.trim()) continue;
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:'))
        data += (data.length > 0 ? '\n' : '') + line.slice(5).trim();
    }
    events.push({ event, data });
  }
  return events;
}

function makeRequest(body: unknown): Request {
  return new Request('http://x/api/lesson-chat', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/lesson-chat', () => {
  it('400 on invalid JSON body', async () => {
    const req = new Request('http://x/api/lesson-chat', {
      method: 'POST',
      body: '{not json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('400 when message is missing', async () => {
    const res = await POST(
      makeRequest({ courseSlug: 'c', lessonSlug: 'l' }),
    );
    expect(res.status).toBe(400);
  });

  it('200 returns assistant text from the connector', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async () => 'Hello from tutor.'),
    );
    const res = await POST(
      makeRequest({
        courseSlug: 'c',
        lessonSlug: 'l',
        message: 'What is this app?',
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assistant: string };
    expect(body.assistant).toBe('Hello from tutor.');
  });

  it('passes systemPrompt + contextBlock-derived userMessage to connector', async () => {
    let captured: { systemPrompt?: string; userMessage?: string } = {};
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async (req) => {
        captured = { systemPrompt: req.systemPrompt, userMessage: req.userMessage };
        return 'ok';
      }),
    );
    await POST(
      makeRequest({
        courseSlug: 'c',
        lessonSlug: 'l',
        sectionId: 's1',
        message: 'Explain.',
      }),
    );
    expect(captured.systemPrompt).toMatch(/AI tutor for an interactive online course/);
    expect(captured.userMessage).toContain('Lesson title: Test Lesson');
    expect(captured.userMessage).toContain('Hello world.');
    expect(captured.userMessage).toContain('User question: Explain.');
  });

  it('forwards conversation history from the request body to the connector', async () => {
    let captured:
      | { history?: Array<{ role: 'user' | 'assistant'; content: string }> }
      | undefined;
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async (req) => {
        captured = { history: req.history };
        return 'ok';
      }),
    );
    await POST(
      makeRequest({
        courseSlug: 'c',
        lessonSlug: 'l',
        message: 'follow-up',
        history: [
          { role: 'user', content: 'first q' },
          { role: 'assistant', content: 'first a' },
        ],
      }),
    );
    expect(captured?.history).toEqual([
      { role: 'user', content: 'first q' },
      { role: 'assistant', content: 'first a' },
    ]);
  });

  it('404 when lesson file does not exist', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async () => 'unused'),
    );
    const res = await POST(
      makeRequest({
        courseSlug: 'c',
        lessonSlug: 'missing',
        message: 'hi',
      }),
    );
    expect(res.status).toBe(404);
  });

  it('503 with the spec-mandated body when no connector is available', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(null);
    const res = await POST(
      makeRequest({
        courseSlug: 'c',
        lessonSlug: 'l',
        message: 'What is this app?',
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      'AI Tutor unavailable: install Claude Code CLI or sign in to Claude Max.',
    );
  });

  it('returns SSE stream when Accept: text/event-stream and emits meta+token+done', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(
        async () => 'should-not-be-called',
        async function* () {
          yield { type: 'token', text: 'Hello ' };
          yield { type: 'token', text: 'world' };
          yield { type: 'done' };
        },
      ),
    );
    const res = await POST(
      makeStreamRequest({
        courseSlug: 'c',
        lessonSlug: 'l',
        message: 'hi',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const events = await readSseEvents(res);
    expect(events[0].event).toBe('meta');
    const meta = JSON.parse(events[0].data) as { requestId: string };
    expect(typeof meta.requestId).toBe('string');
    expect(meta.requestId.length).toBeGreaterThan(0);
    const tokens = events
      .filter((e) => e.event === 'token')
      .map((e) => (JSON.parse(e.data) as { text: string }).text);
    expect(tokens.join('')).toBe('Hello world');
    expect(events.at(-1)?.event).toBe('done');
    expect(_inflightSizeForTesting()).toBe(0);
  });

  it('SSE stream registers the requestId so DELETE can abort it', async () => {
    let aborted = false;
    let receivedSignal: AbortSignal | undefined;
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(
        async () => 'unused',
        async function* (_req, signal) {
          receivedSignal = signal;
          yield { type: 'token', text: 'partial' };
          // Wait until aborted (simulate long-running streaming)
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              resolve();
            });
          });
          // After abort: no more events emitted
        },
      ),
    );

    const res = await POST(
      makeStreamRequest({
        courseSlug: 'c',
        lessonSlug: 'l',
        message: 'hi',
      }),
    );
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let requestId = '';
    while (!requestId) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const idx = buf.indexOf('\n\n');
      if (idx >= 0) {
        const block = buf.slice(0, idx);
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) {
            try {
              const parsed = JSON.parse(line.slice(5).trim()) as { requestId?: string };
              if (parsed.requestId) requestId = parsed.requestId;
            } catch {
              // not json
            }
          }
        }
      }
    }
    expect(requestId).toBeTruthy();
    expect(_inflightSizeForTesting()).toBe(1);

    const delRes = await DELETE(new Request(`http://x/api/lesson-chat/${requestId}`, {
      method: 'DELETE',
    }), { params: Promise.resolve({ requestId }) });
    expect(delRes.status).toBe(204);
    expect(aborted).toBe(true);
    expect(receivedSignal?.aborted).toBe(true);

    // Drain rest of the stream
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    expect(_inflightSizeForTesting()).toBe(0);
  });

  it('DELETE returns 404 for unknown requestId', async () => {
    const delRes = await DELETE(
      new Request('http://x/api/lesson-chat/nope', { method: 'DELETE' }),
      { params: Promise.resolve({ requestId: 'nope' }) },
    );
    expect(delRes.status).toBe(404);
  });

  it('SSE stream emits 503 fallback (JSON) when no connector is available even with stream Accept', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(null);
    const res = await POST(
      makeStreamRequest({
        courseSlug: 'c',
        lessonSlug: 'l',
        message: 'hi',
      }),
    );
    expect(res.status).toBe(503);
  });

  it('502 when the connector throws', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async () => {
        throw new Error('boom');
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(
      makeRequest({
        courseSlug: 'c',
        lessonSlug: 'l',
        message: 'hi',
      }),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/boom/);
  });
});
