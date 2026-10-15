import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST as upload } from '@/app/api/lesson-chat/media/route';
import { GET as serve } from '@/app/api/lesson-chat/media/[file]/route';
import {
  ChatMediaError,
  MAX_CHAT_IMAGE_BYTES,
  readMediaFile,
  readMediaMeta,
  saveUploadedImage,
} from './media';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'chat-media-'));
  process.env.CHAT_MEDIA_ROOT_OVERRIDE = root;
});

afterEach(() => {
  delete process.env.CHAT_MEDIA_ROOT_OVERRIDE;
  rmSync(root, { recursive: true, force: true });
});

describe('chat media store', () => {
  it('stores an upload content-addressed and is idempotent', async () => {
    const a = await saveUploadedImage(PNG_1PX);
    expect(a.file).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(a.origin).toBe('upload');
    const b = await saveUploadedImage(PNG_1PX);
    expect(b.file).toBe(a.file);
    expect(b.createdAt).toBe(a.createdAt);
    const read = await readMediaFile(a.file);
    expect(read?.mediaType).toBe('image/png');
    expect(read?.bytes.equals(PNG_1PX)).toBe(true);
  });

  it('keeps web provenance when the same bytes are uploaded later', async () => {
    const first = await saveUploadedImage(PNG_1PX);
    writeFileSync(
      path.join(root, `${first.id}.json`),
      JSON.stringify({ ...first, origin: 'web', sourceName: 'Wikimedia Commons' }),
    );
    const again = await saveUploadedImage(PNG_1PX);
    expect(again.origin).toBe('web');
    expect((await readMediaMeta(first.id))?.sourceName).toBe('Wikimedia Commons');
  });

  it('rejects non-images, empty and oversized bodies', async () => {
    await expect(saveUploadedImage(Buffer.from('<svg/>'))).rejects.toMatchObject({ status: 415 });
    await expect(saveUploadedImage(Buffer.alloc(0))).rejects.toMatchObject({ status: 400 });
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(MAX_CHAT_IMAGE_BYTES)]);
    await expect(saveUploadedImage(big)).rejects.toBeInstanceOf(ChatMediaError);
  });

  it('only reads well-formed media file names', async () => {
    expect(await readMediaFile('../../etc/passwd')).toBeNull();
    expect(await readMediaFile(`${'a'.repeat(32)}.svg`)).toBeNull();
    expect(await readMediaFile(`${'a'.repeat(32)}.png`)).toBeNull();
    expect(await readMediaMeta('../x')).toBeNull();
  });
});

describe('/api/lesson-chat/media routes', () => {
  it('uploads, then serves the image and its provenance record', async () => {
    const res = await upload(
      new Request('http://x/api/lesson-chat/media', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: PNG_1PX,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { file: string; url: string; id: string };
    expect(body.url).toBe(`/api/lesson-chat/media/${body.file}`);

    const img = await serve(new Request(`http://x${body.url}`), { params: Promise.resolve({ file: body.file }) });
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG_1PX)).toBe(true);

    const meta = await serve(new Request('http://x'), { params: Promise.resolve({ file: `${body.id}.json` }) });
    expect(meta.status).toBe(200);
    expect(((await meta.json()) as { origin: string }).origin).toBe('upload');
  });

  it('415 for a non-image upload and 404 for unknown names', async () => {
    const res = await upload(
      new Request('http://x/api/lesson-chat/media', { method: 'POST', body: 'hello' }),
    );
    expect(res.status).toBe(415);
    const missing = await serve(new Request('http://x'), { params: Promise.resolve({ file: 'nope.png' }) });
    expect(missing.status).toBe(404);
  });
});
