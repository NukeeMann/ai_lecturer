import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  domainCap,
  fetchWebImage,
  imageDimensions,
  pageReferencesImage,
  sniffImageType,
} from '../../../scripts/tutor/media-mcp-server.mjs';

const SCRIPT = path.join(process.cwd(), 'scripts', 'tutor', 'media-mcp-server.mjs');

/** Header-only PNG: the server sniffs magic bytes + IHDR, it never decodes. */
function fakePng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

describe('media MCP server — pure helpers', () => {
  it('sniffs image types from magic bytes', () => {
    expect(sniffImageType(fakePng(1, 1))).toBe('image/png');
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffImageType(Buffer.from('<!doctype html>'))).toBeNull();
  });

  it('reads PNG and JPEG dimensions from the header', () => {
    expect(imageDimensions(fakePng(1695, 851), 'image/png')).toEqual({ width: 1695, height: 851 });
    const jpeg = Buffer.alloc(40);
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).copy(jpeg, 0);
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90]).copy(jpeg, 20);
    expect(imageDimensions(jpeg, 'image/jpeg')).toEqual({ width: 400, height: 300 });
  });

  it('ties a Commons file page to both the original and a thumbnail URL', () => {
    const html =
      '<a href="https://upload.wikimedia.org/wikipedia/commons/0/08/Vertex_waves_EEG.png">Original file</a>';
    expect(
      pageReferencesImage(html, 'https://upload.wikimedia.org/wikipedia/commons/0/08/Vertex_waves_EEG.png'),
    ).toBe(true);
    expect(
      pageReferencesImage(
        html,
        'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Vertex_waves_EEG.png/800px-Vertex_waves_EEG.png',
      ),
    ).toBe(true);
    expect(pageReferencesImage('<p>Sleep spindles</p>', 'https://example.org/img/spindle-figure.png')).toBe(false);
  });

  it('caps reliability by domain', () => {
    expect(domainCap(['pl.pinterest.com', 'i.pinimg.com'])).toBe('low');
    expect(domainCap(['commons.wikimedia.org', 'upload.wikimedia.org'])).toBe('medium');
    expect(domainCap(['www.ilae.org'])).toBeNull();
  });
});

describe('media MCP server — fetch_web_image', () => {
  let server: http.Server;
  let base: string;
  let mediaRoot: string;
  const PNG = fakePng(640, 320);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/files/Test_EEG.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(PNG);
      } else if (url === '/redirect.png') {
        res.writeHead(302, { Location: '/files/Test_EEG.png' });
        res.end();
      } else if (url === '/wiki/File:Test_EEG.png') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><img src="/files/Test_EEG.png" alt="EEG"></body></html>');
      } else if (url === '/unrelated') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>No image here</body></html>');
      } else if (url === '/forbidden') {
        res.writeHead(403);
        res.end();
      } else if (url === '/page.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html></html>');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    delete process.env.TUTOR_MEDIA_ALLOW_PRIVATE;
    delete process.env.CHAT_MEDIA_ROOT;
    if (mediaRoot) rmSync(mediaRoot, { recursive: true, force: true });
  });

  function allowLocal() {
    mediaRoot = mkdtempSync(path.join(tmpdir(), 'tutor-media-'));
    process.env.CHAT_MEDIA_ROOT = mediaRoot;
    process.env.TUTOR_MEDIA_ALLOW_PRIVATE = '1';
  }

  const baseArgs = () => ({
    imageUrl: `${base}/files/Test_EEG.png`,
    sourcePageUrl: `${base}/wiki/File:Test_EEG.png`,
    sourceName: 'Test archive',
    description: 'EEG with vertex waves',
    reliability: 'high',
  });

  it('stores a verified image with provenance and returns it to the model', async () => {
    allowLocal();
    const result = await fetchWebImage({ ...baseArgs(), author: 'Dr X', license: 'CC BY 4.0' });
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png', data: PNG.toString('base64') });
    const text = result.content[1].text as string;
    expect(text).toMatch(/references this image file ✓/);
    const embed = /\]\((\/api\/lesson-chat\/media\/([a-f0-9]{32})\.png)\)/.exec(text);
    expect(embed).not.toBeNull();
    const meta = JSON.parse(readFileSync(path.join(mediaRoot, `${embed![2]}.json`), 'utf8'));
    expect(meta).toMatchObject({
      origin: 'web',
      mediaType: 'image/png',
      width: 640,
      height: 320,
      sourceName: 'Test archive',
      author: 'Dr X',
      license: 'CC BY 4.0',
      reliability: 'high',
      pageCheck: 'linked',
    });
    expect(readFileSync(path.join(mediaRoot, `${embed![2]}.png`)).equals(PNG)).toBe(true);
  });

  it('follows redirects and records the final image URL', async () => {
    allowLocal();
    const result = await fetchWebImage({ ...baseArgs(), imageUrl: `${base}/redirect.png` });
    const id = /media\/([a-f0-9]{32})\.png/.exec(result.content[1].text as string)![1];
    const meta = JSON.parse(readFileSync(path.join(mediaRoot, `${id}.json`), 'utf8'));
    expect(meta.finalImageUrl).toBe(`${base}/files/Test_EEG.png`);
    expect(meta.pageCheck).toBe('linked');
  });

  it('downgrades when the source page does not reference the image', async () => {
    allowLocal();
    const result = await fetchWebImage({ ...baseArgs(), sourcePageUrl: `${base}/unrelated` });
    const text = result.content[1].text as string;
    expect(text).toMatch(/does NOT reference this image file/);
    expect(text).toMatch(/Recorded reliability: medium \(declared high\)/);
  });

  it('downgrades when the source page blocks the check', async () => {
    allowLocal();
    const result = await fetchWebImage({ ...baseArgs(), sourcePageUrl: `${base}/forbidden` });
    expect(result.content[1].text).toMatch(/could not be checked \(HTTP 403\)/);
    expect(result.content[1].text).toMatch(/Recorded reliability: medium/);
  });

  it('rejects a source page that does not exist', async () => {
    allowLocal();
    await expect(fetchWebImage({ ...baseArgs(), sourcePageUrl: `${base}/nope` })).rejects.toThrow(/HTTP 404/);
  });

  it('rejects URLs that are not images', async () => {
    allowLocal();
    await expect(fetchWebImage({ ...baseArgs(), imageUrl: `${base}/page.html` })).rejects.toThrow(
      /did not return a PNG\/JPEG\/GIF\/WebP image/,
    );
  });

  it('requires a reason when the declared reliability is not high', async () => {
    allowLocal();
    await expect(fetchWebImage({ ...baseArgs(), reliability: 'low' })).rejects.toThrow(/reliabilityNote/);
  });

  it('refuses local and private addresses outside tests', async () => {
    mediaRoot = mkdtempSync(path.join(tmpdir(), 'tutor-media-'));
    process.env.CHAT_MEDIA_ROOT = mediaRoot;
    await expect(fetchWebImage(baseArgs())).rejects.toThrow(/Private network addresses are not allowed/);
    await expect(
      fetchWebImage({ ...baseArgs(), imageUrl: 'http://localhost/x.png' }),
    ).rejects.toThrow(/Local addresses are not allowed/);
    await expect(fetchWebImage({ ...baseArgs(), imageUrl: 'file:///etc/passwd' })).rejects.toThrow(/http\(s\)/);
  });
});

describe('media MCP server — stdio protocol', () => {
  it('answers initialize and lists the fetch_web_image tool', async () => {
    const child = spawn(process.execPath, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = readline.createInterface({ input: child.stdout! });
    const responses: Array<Record<string, unknown>> = [];
    const done = new Promise<void>((resolve) => {
      lines.on('line', (line) => {
        responses.push(JSON.parse(line));
        if (responses.length === 2) resolve();
      });
    });
    const send = (m: unknown) => child.stdin!.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await done;
    child.stdin!.end();
    expect(responses[0]).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
    });
    const tools = (responses[1].result as { tools: Array<{ name: string; inputSchema: { required: string[] } }> }).tools;
    expect(tools.map((t) => t.name)).toEqual(['fetch_web_image']);
    expect(tools[0].inputSchema.required).toEqual(
      expect.arrayContaining(['imageUrl', 'sourcePageUrl', 'sourceName', 'description', 'reliability']),
    );
  });
});
