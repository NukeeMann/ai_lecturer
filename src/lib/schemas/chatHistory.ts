import { z } from 'zod';

export const CHAT_HISTORY_SCHEMA_VERSION = 1;

/**
 * The maximum number of messages we keep on disk per (course, module).
 * Enforced at write time so the file never grows without bound.
 */
export const CHAT_HISTORY_MAX_MESSAGES = 200;

/**
 * Roles that are persisted. Transient `error` bubbles produced by the tutor
 * UI are intentionally excluded — see {@link ChatHistoryWriteSchema}.
 */
export const ChatMessageRoleSchema = z.enum(['user', 'assistant']);

export type ChatMessageRole = z.infer<typeof ChatMessageRoleSchema>;

export const ChatMessageSchema = z.object({
  role: ChatMessageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatHistorySchema = z.object({
  schemaVersion: z.literal(CHAT_HISTORY_SCHEMA_VERSION),
  messages: z.array(ChatMessageSchema),
});

export type ChatHistory = z.infer<typeof ChatHistorySchema>;

/**
 * Payload accepted by PUT. It is intentionally more permissive than
 * {@link ChatHistorySchema} on `role`: the tutor UI may include `error`
 * messages in its in-memory transcript, and we want to accept (not reject)
 * such a payload — the server strips error messages before persisting so
 * they never land on disk.
 */
export const ChatHistoryWriteMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'error']),
  content: z.string(),
  createdAt: z.string(),
});

export type ChatHistoryWriteMessage = z.infer<
  typeof ChatHistoryWriteMessageSchema
>;

export const ChatHistoryWriteSchema = z.object({
  schemaVersion: z.literal(CHAT_HISTORY_SCHEMA_VERSION),
  messages: z.array(ChatHistoryWriteMessageSchema),
});

export type ChatHistoryWrite = z.infer<typeof ChatHistoryWriteSchema>;

export function emptyChatHistory(): ChatHistory {
  return { schemaVersion: CHAT_HISTORY_SCHEMA_VERSION, messages: [] };
}
