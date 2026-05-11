// US-158: serves cached TTS audio files for the TtsDemo widget. The
// /api/tts POST handler returns `audioPath` (e.g. `tts-cache/<hash>.wav`,
// relative to AI_LECTURER_HOME). This route resolves that path against the
// user-state directory and streams the file. Access is constrained to the
// `tts-cache/` subdirectory; any traversal attempt returns 400.

import { NextResponse } from 'next/server';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { aiLecturerHome, ttsCacheDir } from '@/lib/server/tts-cache';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ path: string[] }> };

const CONTENT_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: 'bad-request', message }, { status: 400 });
}

function notFound(): NextResponse {
  return NextResponse.json({ error: 'not-found' }, { status: 404 });
}

function assertSafePathParts(parts: string[]): void {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('empty path');
  }
  for (const part of parts) {
    if (typeof part !== 'string' || part.length === 0) {
      throw new Error('empty segment');
    }
    if (
      part.includes('/') ||
      part.includes('\\') ||
      part === '..' ||
      part === '.' ||
      part.includes('\0')
    ) {
      throw new Error(`unsafe segment: ${part}`);
    }
  }
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const { path: parts } = await ctx.params;
  try {
    assertSafePathParts(parts);
  } catch (err) {
    return badRequest((err as Error).message);
  }

  // The audioPath returned by /api/tts starts with `tts-cache/`. Allow callers
  // to pass either `tts-cache/<file>` (the full audioPath) or just `<file>`
  // (drop the prefix). Either way the resolved path MUST live under the
  // tts-cache directory.
  const rel = parts[0] === 'tts-cache' ? parts.slice(1).join('/') : parts.join('/');
  if (!rel) return badRequest('missing filename');

  const cacheDir = ttsCacheDir();
  const home = aiLecturerHome();
  const abs = path.resolve(cacheDir, rel);
  // Reconfirm containment after resolve() has normalised any oddities.
  if (abs !== cacheDir && !abs.startsWith(cacheDir + path.sep)) {
    return badRequest('path escapes tts-cache');
  }
  if (!abs.startsWith(home + path.sep) && abs !== home) {
    return badRequest('path escapes home');
  }

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return notFound();
  }
  if (!stat.isFile()) return notFound();

  const ext = path.extname(abs).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
    },
  });
}
