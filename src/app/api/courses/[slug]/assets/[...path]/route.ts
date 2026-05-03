import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
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
};

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

export async function GET(_req: Request, { params }: RouteCtx) {
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

  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }
    throw err;
  }

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(relPath),
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-cache',
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
