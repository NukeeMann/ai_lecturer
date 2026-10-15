/**
 * Agent configuration for an AI Tutor turn: which tools the tutor may use and
 * the per-call MCP server that verifies web images.
 *
 * - Built-ins are restricted to WebSearch + WebFetch (no Bash/Read/Write: the
 *   lesson context is inlined, the tutor never needs the filesystem).
 * - `mcp__tutor__fetch_web_image` (scripts/tutor/media-mcp-server.mjs) is
 *   the only path for a web image into the chat.
 * - The CLI runs inside the chat media dir so it doesn't pick up this repo's
 *   CLAUDE.md / auto-memory / git status as tutor context.
 *
 * `LESSON_CHAT_WEB=off` disables web access (images from the learner still
 * work).
 */
import path from 'node:path';

import type { ConnectorRequest } from './connector';
import { chatMediaRoot } from './media';

export const TUTOR_MCP_SERVER = 'tutor';
export const FETCH_WEB_IMAGE_TOOL = `mcp__${TUTOR_MCP_SERVER}__fetch_web_image`;
export const WEB_TOOLS = ['WebSearch', 'WebFetch'];

export function tutorWebEnabled(): boolean {
  const v = (process.env.LESSON_CHAT_WEB ?? '').trim().toLowerCase();
  return !(v === 'off' || v === '0' || v === 'false');
}

export function mediaMcpServerScript(): string {
  // Resolved against process.cwd() (the repo root under `next dev`/`start`),
  // like the generation mock scripts — __dirname points into .next/.
  return path.join(process.cwd(), 'scripts', 'tutor', 'media-mcp-server.mjs');
}

export type TutorAgentOptions = Pick<
  ConnectorRequest,
  'tools' | 'allowedTools' | 'mcpServers' | 'cwd'
>;

export function tutorAgentOptions(): TutorAgentOptions {
  const root = chatMediaRoot();
  if (!tutorWebEnabled()) return { tools: [], cwd: root };
  return {
    tools: WEB_TOOLS,
    allowedTools: [...WEB_TOOLS, FETCH_WEB_IMAGE_TOOL],
    mcpServers: {
      [TUTOR_MCP_SERVER]: {
        // The Node running Next — avoids depending on `node` being on PATH.
        command: process.execPath,
        args: [mediaMcpServerScript()],
        env: { CHAT_MEDIA_ROOT: root },
      },
    },
    cwd: root,
  };
}
