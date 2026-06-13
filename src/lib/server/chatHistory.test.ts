import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  DELETE as deleteChat,
  GET as getChat,
  PUT as putChat,
} from '@/app/api/chats/[courseSlug]/[moduleId]/route';
import { CHAT_HISTORY_MAX_MESSAGES } from '@/lib/schemas/chatHistory';
import { chatHistoryFile } from '@/lib/server/chatHistory';

let tmpRoot: string;

const COURSE = 'algo-101';
const MODULE = 'module-1';

const ctx = (courseSlug = COURSE, moduleId = MODULE) => ({
  params: Promise.resolve({ courseSlug, moduleId }),
});

const putRequest = (body: unknown) =>
  new Request('http://x/api/chats/algo-101/module-1', {
    method: 'PUT',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

const msg = (
  role: 'user' | 'assistant' | 'error',
  content: string,
  createdAt = '2026-06-13T10:00:00.000Z',
) => ({ role, content, createdAt });

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-chats-'));
  process.env.CHATS_ROOT_OVERRIDE = tmpRoot;
});

afterEach(async () => {
  delete process.env.CHATS_ROOT_OVERRIDE;
  await fs.rm(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('GET /api/chats/[courseSlug]/[moduleId]', () => {
  it('returns an empty history when the file does not exist (no 500)', async () => {
    const res = await getChat(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schemaVersion: 1, messages: [] });
  });

  it('returns an empty history + warns when the file is corrupt', async () => {
    const file = chatHistoryFile(COURSE, MODULE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not valid json', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await getChat(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schemaVersion: 1, messages: [] });
    expect(warn).toHaveBeenCalled();
  });

  it('returns an empty history + warns when the content fails validation', async () => {
    const file = chatHistoryFile(COURSE, MODULE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({ schemaVersion: 1, messages: [{ role: 'bogus' }] }),
      'utf8',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await getChat(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schemaVersion: 1, messages: [] });
    expect(warn).toHaveBeenCalled();
  });

  it('rejects an unsafe slug with 400', async () => {
    const res = await getChat(new Request('http://x'), ctx('..', MODULE));
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/chats/[courseSlug]/[moduleId]', () => {
  it('round-trips: PUT then GET returns the persisted messages', async () => {
    const payload = {
      schemaVersion: 1,
      messages: [msg('user', 'hi'), msg('assistant', 'hello')],
    };
    const putRes = await putChat(putRequest(payload), ctx());
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual(payload);

    const getRes = await getChat(new Request('http://x'), ctx());
    expect(await getRes.json()).toEqual(payload);
  });

  it('writes the file atomically under the lazily-created directory', async () => {
    const file = chatHistoryFile(COURSE, MODULE);
    await expect(fs.access(path.dirname(file))).rejects.toThrow();

    await putChat(
      putRequest({ schemaVersion: 1, messages: [msg('user', 'hi')] }),
      ctx(),
    );

    const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(onDisk.messages).toHaveLength(1);
  });

  it('does not persist error messages', async () => {
    const payload = {
      schemaVersion: 1,
      messages: [
        msg('user', 'hi'),
        msg('error', 'AI tutor unavailable'),
        msg('assistant', 'hello'),
      ],
    };
    const putRes = await putChat(putRequest(payload), ctx());
    const saved = await putRes.json();
    expect(saved.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
    ]);

    const getRes = await getChat(new Request('http://x'), ctx());
    const got = await getRes.json();
    expect(
      got.messages.some((m: { role: string }) => m.role === 'error'),
    ).toBe(false);
  });

  it('trims to the most recent CHAT_HISTORY_MAX_MESSAGES on write', async () => {
    const total = CHAT_HISTORY_MAX_MESSAGES + 25;
    const messages = Array.from({ length: total }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`),
    );
    const putRes = await putChat(
      putRequest({ schemaVersion: 1, messages }),
      ctx(),
    );
    const saved = await putRes.json();
    expect(saved.messages).toHaveLength(CHAT_HISTORY_MAX_MESSAGES);
    // The oldest 25 were dropped; first kept message is m25.
    expect(saved.messages[0].content).toBe('m25');
    expect(saved.messages[saved.messages.length - 1].content).toBe(
      `m${total - 1}`,
    );
  });

  it('rejects an invalid payload with 422', async () => {
    const res = await putChat(
      putRequest({ schemaVersion: 1, messages: [{ role: 'user' }] }),
      ctx(),
    );
    expect(res.status).toBe(422);
  });

  it('rejects a wrong schemaVersion with 422', async () => {
    const res = await putChat(
      putRequest({ schemaVersion: 99, messages: [] }),
      ctx(),
    );
    expect(res.status).toBe(422);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await putChat(putRequest('{ not json'), ctx());
    expect(res.status).toBe(400);
  });

  it('rejects an unsafe slug with 400', async () => {
    const res = await putChat(
      putRequest({ schemaVersion: 1, messages: [] }),
      ctx(COURSE, '../escape'),
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/chats/[courseSlug]/[moduleId]', () => {
  it('clears the file so a subsequent GET returns empty history', async () => {
    await putChat(
      putRequest({
        schemaVersion: 1,
        messages: [msg('user', 'hi'), msg('assistant', 'hello')],
      }),
      ctx(),
    );

    const delRes = await deleteChat(new Request('http://x'), ctx());
    expect(delRes.status).toBe(204);
    await expect(fs.access(chatHistoryFile(COURSE, MODULE))).rejects.toThrow();

    const getRes = await getChat(new Request('http://x'), ctx());
    expect(await getRes.json()).toEqual({ schemaVersion: 1, messages: [] });
  });

  it('is a no-op (204) when no history file exists', async () => {
    const res = await deleteChat(new Request('http://x'), ctx());
    expect(res.status).toBe(204);
  });

  it('rejects an unsafe slug with 400', async () => {
    const res = await deleteChat(new Request('http://x'), ctx('..', MODULE));
    expect(res.status).toBe(400);
  });
});
