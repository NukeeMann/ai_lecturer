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
import {
  LIVE_STATE_HEADING,
  LIVE_STATE_MAX_CHARS,
  LIVE_STATE_REQUEST_MAX_CHARS,
} from './liveState';

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
let originalMediaRoot: string | undefined;
let mediaRoot: string;

// 1×1 transparent PNG.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const IMG_A = `${'a'.repeat(32)}.png`;
const IMG_B = `${'b'.repeat(32)}.png`;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'lesson-chat-route-'));
  originalRoot = process.env.COURSES_ROOT_OVERRIDE;
  process.env.COURSES_ROOT_OVERRIDE = tmpRoot;
  originalMediaRoot = process.env.CHAT_MEDIA_ROOT_OVERRIDE;
  mediaRoot = path.join(tmpRoot, 'chat-media');
  process.env.CHAT_MEDIA_ROOT_OVERRIDE = mediaRoot;
  mkdirSync(mediaRoot, { recursive: true });
  writeFileSync(path.join(mediaRoot, IMG_A), PNG_1PX);
  writeFileSync(path.join(mediaRoot, IMG_B), PNG_1PX);

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
  if (originalMediaRoot === undefined) {
    delete process.env.CHAT_MEDIA_ROOT_OVERRIDE;
  } else {
    process.env.CHAT_MEDIA_ROOT_OVERRIDE = originalMediaRoot;
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
  connectorModule._resetConnectorCacheForTesting();
  _resetInflightForTesting();
  vi.restoreAllMocks();
  delete process.env.LESSON_CHAT_WEB;
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

  it('gives the tutor web tools, the image MCP server and the source-rigor rules', async () => {
    let captured: ConnectorRequest | undefined;
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async (req) => {
        captured = req;
        return 'ok';
      }),
    );
    await POST(makeRequest({ courseSlug: 'c', lessonSlug: 'l', message: 'Find an example.' }));
    expect(captured?.tools).toEqual(['WebSearch', 'WebFetch']);
    expect(captured?.allowedTools).toEqual(['WebSearch', 'WebFetch', 'mcp__tutor__fetch_web_image']);
    const server = captured?.mcpServers?.tutor;
    expect(server?.args?.[0]).toMatch(/scripts[\\/]tutor[\\/]media-mcp-server\.mjs$/);
    expect(server?.env).toEqual({ CHAT_MEDIA_ROOT: mediaRoot });
    expect(captured?.cwd).toBe(mediaRoot);
    expect(captured?.systemPrompt).toMatch(/Source hierarchy/);
    expect(captured?.systemPrompt).toMatch(/only way to show a web image is mcp__tutor__fetch_web_image/);
    // No images → no image-reading rules.
    expect(captured?.systemPrompt).not.toMatch(/The learner attached image/);
  });

  it('LESSON_CHAT_WEB=off removes web access and the research rules', async () => {
    process.env.LESSON_CHAT_WEB = 'off';
    let captured: ConnectorRequest | undefined;
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async (req) => {
        captured = req;
        return 'ok';
      }),
    );
    await POST(makeRequest({ courseSlug: 'c', lessonSlug: 'l', message: 'hi' }));
    expect(captured?.tools).toEqual([]);
    expect(captured?.mcpServers).toBeUndefined();
    expect(captured?.systemPrompt).not.toMatch(/Source hierarchy/);
  });

  it('attaches the current and earlier learner images as labelled image blocks', async () => {
    let captured: ConnectorRequest | undefined;
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async (req) => {
        captured = req;
        return 'ok';
      }),
    );
    const res = await POST(
      makeRequest({
        courseSlug: 'c',
        lessonSlug: 'l',
        message: 'And this one?',
        images: [IMG_B],
        history: [
          { role: 'user', content: 'What is this?', images: [IMG_A] },
          { role: 'assistant', content: 'A vertex wave.' },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(captured?.images).toEqual([
      {
        mediaType: 'image/png',
        data: PNG_1PX.toString('base64'),
        label: 'Image 1 attached by the learner to the current question:',
      },
      {
        mediaType: 'image/png',
        data: PNG_1PX.toString('base64'),
        label: 'Earlier image E1 (attached by the learner to an earlier message):',
      },
    ]);
    expect(captured?.history?.[0].content).toBe('What is this?\n[Attached images: E1 — shown below]');
    expect(captured?.systemPrompt).toMatch(/The learner attached image/);
  });

  it('accepts an image-only message and asks the tutor to describe it', async () => {
    let captured: ConnectorRequest | undefined;
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async (req) => {
        captured = req;
        return 'ok';
      }),
    );
    const res = await POST(makeRequest({ courseSlug: 'c', lessonSlug: 'l', message: '', images: [IMG_A] }));
    expect(res.status).toBe(200);
    expect(captured?.userMessage).toMatch(/User question: \(The learner sent only the attached image/);
  });

  it('400 when neither text nor images are sent', async () => {
    const res = await POST(makeRequest({ courseSlug: 'c', lessonSlug: 'l', message: '   ' }));
    expect(res.status).toBe(400);
  });

  it('400 when an attached image is not in the media store', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(fakeConnector(async () => 'unused'));
    const res = await POST(
      makeRequest({ courseSlug: 'c', lessonSlug: 'l', message: 'x', images: [`${'c'.repeat(32)}.png`] }),
    );
    expect(res.status).toBe(400);
  });

  it('400 when an image name is not a media-store file name', async () => {
    const res = await POST(
      makeRequest({ courseSlug: 'c', lessonSlug: 'l', message: 'x', images: ['../../etc/passwd'] }),
    );
    expect(res.status).toBe(400);
  });

  it('forwards activity and interim events over SSE', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(
        async () => 'unused',
        async function* () {
          yield { type: 'token', text: 'Let me check.' };
          yield { type: 'interim' };
          yield { type: 'activity', activity: { id: 't1', kind: 'search', label: 'POSTS EEG', status: 'running' } };
          yield { type: 'token', text: 'Answer' };
          yield { type: 'done' };
        },
      ),
    );
    const res = await POST(makeStreamRequest({ courseSlug: 'c', lessonSlug: 'l', message: 'hi' }));
    const events = await readSseEvents(res);
    expect(events.map((e) => e.event)).toEqual(['meta', 'token', 'interim', 'activity', 'token', 'done']);
    expect(JSON.parse(events[3].data)).toEqual({ id: 't1', kind: 'search', label: 'POSTS EEG', status: 'running' });
  });
});

describe('POST /api/lesson-chat — live widget state', () => {
  const captureUserMessage = () => {
    const captured: { userMessage?: string } = {};
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue(
      fakeConnector(async (req) => {
        captured.userMessage = req.userMessage;
        return 'ok';
      }),
    );
    return captured;
  };

  it('adds the published state of the active section to the prompt, as data', async () => {
    const captured = captureUserMessage();
    const res = await POST(
      makeRequest({
        courseSlug: 'c',
        lessonSlug: 'l',
        sectionId: 's1',
        message: 'Is this a phase reversal?',
        widgetState: 'Montage: LB. Marks: 12.4 s on F8-T8. Submitted: no.',
      }),
    );
    expect(res.status).toBe(200);
    expect(captured.userMessage).toContain(LIVE_STATE_HEADING);
    expect(captured.userMessage).toContain(
      '<live_widget_state>\nMontage: LB. Marks: 12.4 s on F8-T8. Submitted: no.\n</live_widget_state>',
    );
    // Context first, then the question.
    expect(captured.userMessage!.indexOf(LIVE_STATE_HEADING)).toBeLessThan(
      captured.userMessage!.indexOf('User question: Is this a phase reversal?'),
    );
  });

  it(`truncates a long state to ${LIVE_STATE_MAX_CHARS} chars`, async () => {
    const captured = captureUserMessage();
    await POST(
      makeRequest({
        courseSlug: 'c',
        lessonSlug: 'l',
        sectionId: 's1',
        message: 'q',
        widgetState: 'w'.repeat(LIVE_STATE_REQUEST_MAX_CHARS),
      }),
    );
    const inner = captured
      .userMessage!.split('<live_widget_state>\n')[1]
      .split('\n</live_widget_state>')[0];
    expect(inner.length).toBe(LIVE_STATE_MAX_CHARS);
  });

  it('ignores the state without a sectionId', async () => {
    const captured = captureUserMessage();
    await POST(makeRequest({ courseSlug: 'c', lessonSlug: 'l', message: 'q', widgetState: 'x' }));
    expect(captured.userMessage).not.toContain(LIVE_STATE_HEADING);
  });

  it('400 when widgetState exceeds the request cap', async () => {
    const res = await POST(
      makeRequest({
        courseSlug: 'c',
        lessonSlug: 'l',
        sectionId: 's1',
        message: 'q',
        widgetState: 'w'.repeat(LIVE_STATE_REQUEST_MAX_CHARS + 1),
      }),
    );
    expect(res.status).toBe(400);
  });
});
