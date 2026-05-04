import { afterEach, describe, expect, it, vi } from 'vitest';

import * as connectorModule from './connector';
import { POST } from '@/app/api/lesson-chat/route';

afterEach(() => {
  connectorModule._resetConnectorCacheForTesting();
  vi.restoreAllMocks();
});

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
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue({
      name: 'subprocess',
      chat: async () => 'Hello from tutor.',
    });
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

  it('502 when the connector throws', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue({
      name: 'subprocess',
      chat: async () => {
        throw new Error('boom');
      },
    });
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
