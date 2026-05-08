import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';

import { InvalidSlugError, assertSafeSlug, courseDir } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ slug: string; path: string[] }> };

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

const RANGEABLE_TYPES = new Set(['video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg']);

function assertSafeAssetPath(parts: string[]): string {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new InvalidSlugError(String(parts));
  }
  for (const part of parts) {
    if (typeof part !== 'string' || part.length === 0) {
      throw new InvalidSlugError(String(part));
    }
    if (part.includes('/') || part.includes('\\') || part === '..' || part === '.') {
      throw new InvalidSlugError(part);
    }
    if (part.includes('\0')) {
      throw new InvalidSlugError(part);
    }
  }
  return parts.join('/');
}

function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

interface ParsedRange {
  start: number;
  end: number;
}

export function parseRangeHeader(header: string, size: number): ParsedRange | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const startStr = m[1];
  const endStr = m[2];
  if (startStr === '' && endStr === '') return 'invalid';
  let start: number;
  let end: number;
  if (startStr === '') {
    // Suffix range: last N bytes
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? size - 1 : Number(endStr);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
  }
  if (start < 0 || end < start) return 'invalid';
  if (start >= size) return 'invalid';
  if (end >= size) end = size - 1;
  return { start, end };
}

export async function GET(req: Request, { params }: RouteCtx) {
  const { slug, path: relParts } = await params;

  let assetsDir: string;
  let relPath: string;
  try {
    assertSafeSlug(slug);
    relPath = assertSafeAssetPath(relParts);
    assetsDir = path.join(courseDir(slug), 'assets');
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const filePath = path.join(assetsDir, relPath);
  const resolved = path.resolve(filePath);
  const resolvedAssetsDir = path.resolve(assetsDir);
  if (!resolved.startsWith(resolvedAssetsDir + path.sep) && resolved !== resolvedAssetsDir) {
    return NextResponse.json({ error: 'Invalid asset path' }, { status: 400 });
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }
    throw err;
  }

  const contentType = contentTypeFor(relPath);
  const size = stat.size;
  const rangeHeader = req.headers.get('range');

  // Honour Range requests for media (so <audio>/<video> can seek).
  if (rangeHeader && RANGEABLE_TYPES.has(contentType)) {
    const parsed = parseRangeHeader(rangeHeader, size);
    if (parsed === 'invalid') {
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${size}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }
    if (parsed) {
      const { start, end } = parsed;
      const chunkSize = end - start + 1;
      const nodeStream = createReadStream(filePath, { start, end });
      const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
      return new Response(webStream, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        },
      });
    }
  }

  const buf = await fs.readFile(filePath);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-cache',
      ...(RANGEABLE_TYPES.has(contentType) ? { 'Accept-Ranges': 'bytes' } : {}),
    },
  });
}

export async function PUT(req: Request, { params }: RouteCtx) {
  const { slug, path: relParts } = await params;

  let assetsDir: string;
  let relPath: string;
  try {
    assertSafeSlug(slug);
    relPath = assertSafeAssetPath(relParts);
    assetsDir = path.join(courseDir(slug), 'assets');
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const ext = path.extname(relPath).toLowerCase();
  if (!CONTENT_TYPES[ext]) {
    return NextResponse.json(
      { error: `Unsupported asset extension: ${ext || '(none)'}` },
      { status: 400 },
    );
  }

  const filePath = path.join(assetsDir, relPath);
  const resolved = path.resolve(filePath);
  const resolvedAssetsDir = path.resolve(assetsDir);
  if (!resolved.startsWith(resolvedAssetsDir + path.sep) && resolved !== resolvedAssetsDir) {
    return NextResponse.json({ error: 'Invalid asset path' }, { status: 400 });
  }

  const arrayBuf = await req.arrayBuffer();
  if (arrayBuf.byteLength === 0) {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 });
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(arrayBuf));

  return NextResponse.json({
    src: `/api/courses/${encodeURIComponent(slug)}/assets/${relParts.map((p) => encodeURIComponent(p)).join('/')}`,
    bytes: arrayBuf.byteLength,
  });
}
