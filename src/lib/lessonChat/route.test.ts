import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as connectorModule from './connector';
import { POST } from '@/app/api/lesson-chat/route';

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

  it('passes systemPrompt + contextBlock-derived userMessage to connector', async () => {
    let captured: { systemPrompt?: string; userMessage?: string } = {};
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue({
      name: 'subprocess',
      chat: async (req) => {
        captured = { systemPrompt: req.systemPrompt, userMessage: req.userMessage };
        return 'ok';
      },
    });
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

  it('404 when lesson file does not exist', async () => {
    vi.spyOn(connectorModule, 'selectConnector').mockResolvedValue({
      name: 'subprocess',
      chat: async () => 'unused',
    });
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
