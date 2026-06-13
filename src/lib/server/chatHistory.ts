import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CHAT_HISTORY_MAX_MESSAGES,
  CHAT_HISTORY_SCHEMA_VERSION,
  ChatHistorySchema,
  emptyChatHistory,
  type ChatHistory,
  type ChatHistoryWrite,
} from '@/lib/schemas/chatHistory';
import { atomicWriteJson } from '@/lib/server/atomic';
import { assertSafeSlug } from '@/lib/server/paths';

/**
 * Root directory holding per-(course, module) tutor chat transcripts:
 * `~/.ai-lecturer/chats/<courseSlug>/<moduleId>.json`. Overridable via
 * `CHATS_ROOT_OVERRIDE` for tests.
 */
export function chatsRoot(): string {
  const override = process.env.CHATS_ROOT_OVERRIDE;
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), '.ai-lecturer', 'chats');
}

export function chatHistoryFile(courseSlug: string, moduleId: string): string {
  assertSafeSlug(courseSlug);
  assertSafeSlug(moduleId);
  return path.join(chatsRoot(), courseSlug, `${moduleId}.json`);
}

/**
 * Read the persisted history for a module. Returns an empty history when the
 * file does not exist OR when its contents fail validation (corrupt/legacy) —
 * in the latter case a warning is logged. Never throws on a missing or
 * malformed file, so the route can stay 500-free.
 */
export async function readChatHistory(
  courseSlug: string,
  moduleId: string,
): Promise<ChatHistory> {
  const file = chatHistoryFile(courseSlug, moduleId);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyChatHistory();
    }
    throw err;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.warn(
      `[chatHistory] corrupt JSON at ${file}; returning empty history`,
    );
    return emptyChatHistory();
  }

  const parsed = ChatHistorySchema.safeParse(json);
  if (!parsed.success) {
    console.warn(
      `[chatHistory] invalid history at ${file}; returning empty history`,
    );
    return emptyChatHistory();
  }
  return parsed.data;
}

/**
 * Normalise an incoming write payload into the persisted shape:
 * - drops `error` messages (transient UI bubbles are never persisted)
 * - trims to the most recent {@link CHAT_HISTORY_MAX_MESSAGES} messages
 */
export function normalizeChatHistory(payload: ChatHistoryWrite): ChatHistory {
  const messages = payload.messages
    .filter((m) => m.role !== 'error')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      createdAt: m.createdAt,
    }));

  const trimmed =
    messages.length > CHAT_HISTORY_MAX_MESSAGES
      ? messages.slice(messages.length - CHAT_HISTORY_MAX_MESSAGES)
      : messages;

  return { schemaVersion: CHAT_HISTORY_SCHEMA_VERSION, messages: trimmed };
}

/**
 * Overwrite the module's history atomically (single-user, last-write-wins).
 * Parent directories are created lazily by {@link atomicWriteJson}.
 */
export async function writeChatHistory(
  courseSlug: string,
  moduleId: string,
  payload: ChatHistoryWrite,
): Promise<ChatHistory> {
  const file = chatHistoryFile(courseSlug, moduleId);
  const normalized = normalizeChatHistory(payload);
  await atomicWriteJson(file, normalized);
  return normalized;
}
