/**
 * Chat media store — images the learner attaches to AI Tutor messages and
 * web images the tutor verified through the `fetch_web_image` MCP tool.
 *
 * Layout: `~/.ai-lecturer/chat-media/<id>.<ext>` plus a `<id>.json` sidecar
 * with provenance. `id` is the first 32 hex chars of the bytes' sha256, so
 * identical images dedupe and URLs are immutable. The MCP server
 * (scripts/tutor/media-mcp-server.mjs) writes the same layout; keep the two
 * in sync.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { atomicWriteJson } from '@/lib/server/atomic';

export type ChatMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export type SourceReliability = 'high' | 'medium' | 'low';

export interface ChatMediaMeta {
  schemaVersion: 1;
  id: string;
  file: string;
  mediaType: ChatMediaType;
  bytes: number;
  origin: 'upload' | 'web';
  createdAt: string;
  width?: number;
  height?: number;
  // Web provenance (origin === 'web').
  imageUrl?: string;
  finalImageUrl?: string;
  sourcePageUrl?: string;
  sourceName?: string;
  description?: string;
  author?: string;
  license?: string;
  declaredReliability?: SourceReliability;
  reliability?: SourceReliability;
  reliabilityNote?: string;
  autoNotes?: string[];
  pageCheck?: 'linked' | 'unlinked' | 'blocked';
}

/** Largest image we accept: the Messages API caps base64 images at 5 MB. */
export const MAX_CHAT_IMAGE_BYTES = 3_600_000;

export const MEDIA_FILE_RE = /^([a-f0-9]{32})\.(png|jpg|gif|webp)$/;
export const MEDIA_URL_PREFIX = '/api/lesson-chat/media/';

const EXT_BY_TYPE: Record<ChatMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const TYPE_BY_EXT: Record<string, ChatMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export function chatMediaRoot(): string {
  const override = process.env.CHAT_MEDIA_ROOT_OVERRIDE;
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), '.ai-lecturer', 'chat-media');
}

export function mediaUrl(file: string): string {
  return `${MEDIA_URL_PREFIX}${file}`;
}

/** Media type from magic bytes — the declared Content-Type is never trusted. */
export function sniffImageType(buf: Uint8Array): ChatMediaType | null {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const head6 = b.subarray(0, 6).toString('ascii');
  if (b.length >= 6 && (head6 === 'GIF87a' || head6 === 'GIF89a')) return 'image/gif';
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('ascii') === 'RIFF' &&
    b.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export class ChatMediaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ChatMediaError';
  }
}

/** Store a learner-attached image. Re-uploading identical bytes is a no-op. */
export async function saveUploadedImage(bytes: Buffer): Promise<ChatMediaMeta> {
  if (bytes.length === 0) throw new ChatMediaError('Empty image', 400);
  if (bytes.length > MAX_CHAT_IMAGE_BYTES) {
    throw new ChatMediaError(
      `Image too large (${Math.round(bytes.length / 1024)} KB, max ${Math.round(MAX_CHAT_IMAGE_BYTES / 1024)} KB)`,
      413,
    );
  }
  const mediaType = sniffImageType(bytes);
  if (!mediaType) throw new ChatMediaError('Unsupported image format (use PNG, JPEG, GIF or WebP)', 415);

  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const file = `${id}.${EXT_BY_TYPE[mediaType]}`;
  const root = chatMediaRoot();
  await fs.mkdir(root, { recursive: true });

  // Same bytes already stored (possibly as a verified web image): keep that
  // record — its provenance is more informative than "uploaded".
  const existing = await readMediaMeta(id);
  if (existing) return existing;

  await fs.writeFile(path.join(root, file), bytes);
  const meta: ChatMediaMeta = {
    schemaVersion: 1,
    id,
    file,
    mediaType,
    bytes: bytes.length,
    origin: 'upload',
    createdAt: new Date().toISOString(),
  };
  await atomicWriteJson(path.join(root, `${id}.json`), meta);
  return meta;
}

export async function readMediaMeta(id: string): Promise<ChatMediaMeta | null> {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  try {
    const raw = await fs.readFile(path.join(chatMediaRoot(), `${id}.json`), 'utf8');
    return JSON.parse(raw) as ChatMediaMeta;
  } catch {
    return null;
  }
}

/** Read a stored image by its `<id>.<ext>` file name. */
export async function readMediaFile(
  file: string,
): Promise<{ bytes: Buffer; mediaType: ChatMediaType } | null> {
  const m = MEDIA_FILE_RE.exec(file);
  if (!m) return null;
  try {
    const bytes = await fs.readFile(path.join(chatMediaRoot(), file));
    return { bytes, mediaType: TYPE_BY_EXT[m[2]] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
