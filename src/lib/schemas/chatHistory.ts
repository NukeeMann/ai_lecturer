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

/** Chat media file name (`<sha256-prefix>.<ext>`, see lessonChat/media). */
const ChatImageFileSchema = z.string().regex(/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/);

/**
 * One step of the tutor's research log (a search, a page read, an image
 * check, or a preamble note it wrote before calling a tool).
 */
export const ChatActivityEntrySchema = z.object({
  kind: z.enum(['search', 'fetch', 'image', 'tool', 'note']),
  label: z.string(),
  // Not `.url()`: one odd entry must never make the whole transcript fail
  // validation and silently stop saving. The UI only links http(s) values.
  url: z.string().max(2048).optional(),
  status: z.enum(['running', 'ok', 'error']).optional(),
  detail: z.string().optional(),
});

export type ChatActivityEntry = z.infer<typeof ChatActivityEntrySchema>;

/** Research-log entries kept per message on disk. */
export const CHAT_ACTIVITY_MAX_ENTRIES = 40;

export const ChatMessageSchema = z.object({
  role: ChatMessageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
  /** Images the learner attached (user messages). */
  images: z.array(ChatImageFileSchema).optional(),
  /** Research log of the answer (assistant messages). */
  activity: z.array(ChatActivityEntrySchema).optional(),
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
  images: z.array(ChatImageFileSchema).optional(),
  activity: z.array(ChatActivityEntrySchema).optional(),
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
