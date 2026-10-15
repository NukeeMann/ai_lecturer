/**
 * Translates Claude Code's `stream-json` messages (CLI `--output-format
 * stream-json --include-partial-messages`, identical to what the Agent SDK
 * yields) into LessonChat stream events.
 *
 * - `stream_event` text deltas become `token` events (live streaming).
 * - Completed `assistant` messages carry tool calls → `activity` events, so
 *   the UI can show "searching…/reading…/verifying image…".
 * - Text the model wrote right before a tool call ("let me search…") is a
 *   preamble, not part of the answer: an `interim` event tells the client to
 *   move the text streamed since the last boundary into the research log.
 * - `user` messages carry tool results → the matching activity flips to
 *   ok/error.
 * - The final `result` message ends the stream with `done` or `error`.
 */
import type { ChatActivity, ChatStreamEvent } from './connector';

const DETAIL_MAX_CHARS = 240;

interface ContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

interface StreamJsonMessage {
  type?: string;
  subtype?: string;
  parent_tool_use_id?: string | null;
  message?: { id?: string; content?: ContentBlock[] | string };
  event?: {
    type?: string;
    message?: { id?: string };
    content_block?: { type?: string };
    delta?: { type?: string; text?: string };
  };
  result?: unknown;
  is_error?: boolean;
  errors?: unknown;
}

export class StreamJsonTranslator {
  private readonly streamedMessageIds = new Set<string>();
  private readonly activities = new Map<string, ChatActivity>();
  private segmentHasText = false;
  private finished = false;

  /** True once a `result` message (success or failure) was translated. */
  get sawResult(): boolean {
    return this.finished;
  }

  push(raw: unknown): ChatStreamEvent[] {
    if (!raw || typeof raw !== 'object' || this.finished) return [];
    const msg = raw as StreamJsonMessage;
    // Subagent traffic (not used by the tutor) would interleave with ours.
    if (msg.parent_tool_use_id) return [];
    switch (msg.type) {
      case 'stream_event':
        return this.onStreamEvent(msg);
      case 'assistant':
        return this.onAssistant(msg);
      case 'user':
        return this.onUser(msg);
      case 'result':
        return this.onResult(msg);
      default:
        return [];
    }
  }

  private onStreamEvent(msg: StreamJsonMessage): ChatStreamEvent[] {
    const ev = msg.event;
    if (!ev) return [];
    if (ev.type === 'message_start' && typeof ev.message?.id === 'string') {
      this.streamedMessageIds.add(ev.message.id);
      return [];
    }
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
      // Two text blocks in one segment (e.g. split by a thinking block)
      // would otherwise run together without whitespace.
      return this.segmentHasText ? [{ type: 'token', text: '\n\n' }] : [];
    }
    if (
      ev.type === 'content_block_delta' &&
      ev.delta?.type === 'text_delta' &&
      typeof ev.delta.text === 'string' &&
      ev.delta.text.length > 0
    ) {
      this.segmentHasText = true;
      return [{ type: 'token', text: ev.delta.text }];
    }
    return [];
  }

  private onAssistant(msg: StreamJsonMessage): ChatStreamEvent[] {
    const content = msg.message?.content;
    if (!Array.isArray(content)) return [];
    const alreadyStreamed =
      typeof msg.message?.id === 'string' && this.streamedMessageIds.has(msg.message.id);
    const out: ChatStreamEvent[] = [];
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
        if (alreadyStreamed) continue;
        if (this.segmentHasText) out.push({ type: 'token', text: '\n\n' });
        out.push({ type: 'token', text: block.text });
        this.segmentHasText = true;
      } else if (block?.type === 'tool_use' && typeof block.id === 'string') {
        if (this.segmentHasText) {
          out.push({ type: 'interim' });
          this.segmentHasText = false;
        }
        const activity = activityFromToolUse(block.id, block.name ?? 'tool', block.input ?? {});
        this.activities.set(block.id, activity);
        out.push({ type: 'activity', activity });
      }
    }
    return out;
  }

  private onUser(msg: StreamJsonMessage): ChatStreamEvent[] {
    const content = msg.message?.content;
    if (!Array.isArray(content)) return [];
    const out: ChatStreamEvent[] = [];
    for (const block of content) {
      if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
      const prev = this.activities.get(block.tool_use_id);
      if (!prev) continue;
      const failed = block.is_error === true;
      const next: ChatActivity = { ...prev, status: failed ? 'error' : 'ok' };
      if (failed) {
        const detail = toolResultText(block.content);
        if (detail) next.detail = truncate(detail, DETAIL_MAX_CHARS);
      }
      this.activities.set(block.tool_use_id, next);
      out.push({ type: 'activity', activity: next });
    }
    return out;
  }

  private onResult(msg: StreamJsonMessage): ChatStreamEvent[] {
    this.finished = true;
    if (msg.is_error === true || (msg.subtype !== undefined && msg.subtype !== 'success')) {
      const detail =
        typeof msg.result === 'string' && msg.result.length > 0
          ? msg.result
          : Array.isArray(msg.errors) && msg.errors.length > 0
            ? msg.errors.map(String).join('; ')
            : (msg.subtype ?? 'unknown error');
      return [{ type: 'error', message: `claude reported an error: ${truncate(detail, 500)}` }];
    }
    const out: ChatStreamEvent[] = [];
    // The final segment can be empty when the model's last text came before
    // a tool call (and was moved to the log). `result` repeats the last
    // assistant text — better than an empty bubble.
    if (!this.segmentHasText && typeof msg.result === 'string' && msg.result.trim().length > 0) {
      out.push({ type: 'token', text: msg.result });
      this.segmentHasText = true;
    }
    if (!this.segmentHasText) {
      out.push({ type: 'error', message: 'claude produced no answer text' });
      return out;
    }
    out.push({ type: 'done' });
    return out;
  }
}

export function activityFromToolUse(
  id: string,
  name: string,
  input: Record<string, unknown>,
): ChatActivity {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '');
  if (name === 'WebSearch') {
    return { id, kind: 'search', label: str('query') || 'web search', status: 'running' };
  }
  if (name === 'WebFetch') {
    const url = safeHttpUrl(str('url'));
    return { id, kind: 'fetch', label: url ? shortUrl(url) : 'web page', url, status: 'running' };
  }
  if (name.endsWith('__fetch_web_image')) {
    const page = safeHttpUrl(str('sourcePageUrl')) ?? safeHttpUrl(str('imageUrl'));
    return {
      id,
      kind: 'image',
      label: truncate(str('description') || (page ? shortUrl(page) : 'image'), 120),
      url: page,
      status: 'running',
    };
  }
  return { id, kind: 'tool', label: name, status: 'running' };
}

function safeHttpUrl(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function shortUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const p = u.pathname === '/' ? '' : u.pathname;
    return truncate(`${u.hostname.replace(/^www\./, '')}${p}`, 80);
  } catch {
    return truncate(raw, 80);
  }
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (c && typeof c === 'object' && typeof (c as ContentBlock).text === 'string' ? (c as ContentBlock).text : ''))
    .join(' ')
    .trim();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
