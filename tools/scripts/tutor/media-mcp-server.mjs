#!/usr/bin/env node
/**
 * AI Tutor media MCP server (stdio, zero dependencies).
 *
 * Spawned by the `claude` CLI for every LessonChat turn (see
 * src/lib/lessonChat/tutorAgent.ts). Exposes one tool, `fetch_web_image`,
 * which is the ONLY way the tutor can show a web image to the learner:
 *
 *   1. downloads the image (http/https only, public hosts only, size/type/
 *      dimension limits),
 *   2. fetches the cited source page and checks that it actually references
 *      the image file (catches invented or mismatched attributions),
 *   3. caps the declared reliability by domain policy + those checks,
 *   4. stores bytes + provenance in the chat media store
 *      (`$CHAT_MEDIA_ROOT/<id>.<ext>` + `<id>.json`, id = sha256 prefix),
 *   5. returns the image itself to the model so it can LOOK at it before
 *      embedding, plus the local URL to embed.
 *
 * The app renders the source caption from the stored provenance, so the
 * attribution under an image never depends on the model remembering it.
 *
 * Protocol: MCP over stdio — newline-delimited JSON-RPC 2.0. Only the
 * methods the CLI needs are implemented (initialize, tools/list, tools/call,
 * ping). Everything written to stdout is protocol; logs go to stderr.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const SERVER_INFO = { name: 'ai-lecturer-tutor', version: '1.0.0' };
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

// Raw bytes cap. Base64 inflates by 4/3, and the Messages API rejects images
// over 5 MB once encoded, so 3.6 MB raw is the largest we can hand the model.
const MAX_IMAGE_BYTES = 3_600_000;
const MAX_IMAGE_DIMENSION = 8000;
const MIN_IMAGE_DIMENSION = 16;
const MAX_PAGE_BYTES = 4_000_000;
const IMAGE_TIMEOUT_MS = 20_000;
const PAGE_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'AI-Lecturer-Tutor/1.0 (local educational app; source verification)';

const RELIABILITY_ORDER = ['low', 'medium', 'high'];

// Domains whose content is user-generated, unattributed or stock imagery.
// Matching is by registrable suffix (`pinterest.com` covers `pl.pinterest.com`).
const LOW_CAP_DOMAINS = [
  'pinterest.com', 'pinterest.co.uk', 'pinimg.com', 'facebook.com', 'fbcdn.net',
  'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'twimg.com', 'reddit.com',
  'redd.it', 'quora.com', 'blogspot.com', 'wordpress.com', 'medium.com',
  'tumblr.com', 'imgur.com', 'scribd.com', 'slideshare.net', 'shutterstock.com',
  'alamy.com', 'dreamstime.com', 'istockphoto.com', 'gettyimages.com',
  'freepik.com', 'vecteezy.com', 'depositphotos.com', '123rf.com', 'stock.adobe.com',
  'pngtree.com', 'pngwing.com', 'pngegg.com', 'gstatic.com', 'quizlet.com',
  'coursehero.com', 'studocu.com',
];
// Community-curated or self-archived: useful, never top tier on their own.
const MEDIUM_CAP_DOMAINS = [
  'wikipedia.org', 'wikimedia.org', 'wikiwand.com', 'researchgate.net',
  'academia.edu', 'youtube.com', 'youtu.be',
];

const TOOL_DEFINITION = {
  name: 'fetch_web_image',
  description: [
    'Download and verify an image from the web so it can be shown to the learner.',
    'This is the ONLY way to display a web image in the tutor chat: markdown images with external URLs are not rendered.',
    'Before calling, open the source page (WebFetch) and confirm from its caption/description what the image shows.',
    'The tool checks that the source page really references the image file, caps reliability by domain policy, stores provenance,',
    'and returns the image so you can look at it. Embed it ONLY if it clearly shows what you claim, using the markdown it returns.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      imageUrl: {
        type: 'string',
        description:
          'Direct URL of the image file (PNG, JPEG, GIF or WebP). For Wikimedia Commons use the upload.wikimedia.org URL; for SVG originals use a PNG thumbnail rendition (…/thumb/…/1280px-Name.svg.png).',
      },
      sourcePageUrl: {
        type: 'string',
        description:
          'The page that publishes this image together with its description and attribution (e.g. the Commons file page, the article or figure page). Must be a page you actually opened.',
      },
      sourceName: {
        type: 'string',
        description:
          'Human-readable source, e.g. "Wikimedia Commons", "PMC — Kane et al. 2017, Clin Neurophysiol Pract", "Radiopaedia".',
      },
      description: {
        type: 'string',
        description: 'What the source itself says the image shows (paraphrase of its caption/description).',
      },
      author: { type: 'string', description: 'Author or creator, if the source states it.' },
      license: { type: 'string', description: 'License, if the source states it (e.g. "CC BY-SA 4.0").' },
      reliability: {
        type: 'string',
        enum: RELIABILITY_ORDER,
        description:
          'high = guideline/society, peer-reviewed journal, academic textbook or named-author academic teaching material; medium = curated reference site or community file with clear author and provenance; low = anything else (last resort only).',
      },
      reliabilityNote: {
        type: 'string',
        description: 'Required unless reliability is "high": why the source is not fully reliable.',
      },
    },
    required: ['imageUrl', 'sourcePageUrl', 'sourceName', 'description', 'reliability'],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Media store
// ---------------------------------------------------------------------------

export function mediaRoot() {
  const fromEnv = process.env.CHAT_MEDIA_ROOT;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return path.join(os.homedir(), '.ai-lecturer', 'chat-media');
}

const EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function sniffImageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return 'image/gif';
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Width/height from the file header; null when the header can't be read. */
export function imageDimensions(buf, mediaType) {
  try {
    if (mediaType === 'image/png') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mediaType === 'image/gif') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mediaType === 'image/webp') {
      const chunk = buf.subarray(12, 16).toString('ascii');
      if (chunk === 'VP8X') {
        return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      }
      if (chunk === 'VP8L') {
        const bits = buf.readUInt32LE(21);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      }
      if (chunk === 'VP8 ') {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      return null;
    }
    if (mediaType === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = buf[i + 1];
        // SOF0–SOF15 carry the frame size; C4 (DHT), C8 (JPG), CC (DAC) don't.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

async function storeImage(bytes, mediaType, meta) {
  const root = mediaRoot();
  await fs.mkdir(root, { recursive: true });
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const ext = EXT_BY_TYPE[mediaType];
  const file = `${id}.${ext}`;
  await fs.writeFile(path.join(root, file), bytes);
  const record = { schemaVersion: 1, id, file, mediaType, bytes: bytes.length, ...meta };
  const metaPath = path.join(root, `${id}.json`);
  const tmp = `${metaPath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, metaPath);
  return record;
}

// ---------------------------------------------------------------------------
// Network guards
// ---------------------------------------------------------------------------

class ToolError extends Error {}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') ||
    lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
}

async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ToolError(`Only http(s) URLs are allowed, got ${url.protocol}`);
  }
  // Tests serve fixtures from 127.0.0.1; never set this in production.
  if (process.env.TUTOR_MEDIA_ALLOW_PRIVATE === '1') return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new ToolError('Local addresses are not allowed');
  }
  let addresses;
  try {
    addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  } catch {
    throw new ToolError(`Host does not resolve: ${host}`);
  }
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new ToolError('Private network addresses are not allowed');
  }
  return url;
}

/** fetch() with manual redirects so every hop passes the public-host check. */
async function guardedFetch(rawUrl, { timeoutMs, accept }) {
  let current = await assertPublicUrl(rawUrl);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timed out' : err?.message ?? String(err);
      throw new ToolError(`Request to ${current.hostname} failed: ${reason}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = await assertPublicUrl(new URL(res.headers.get('location'), current).toString());
      continue;
    }
    return { res, finalUrl: current.toString() };
  }
  throw new ToolError('Too many redirects');
}

async function readCapped(res, cap) {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > cap) return { tooLarge: true, buf: null };
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body ?? []) {
    total += chunk.length;
    if (total > cap) return { tooLarge: true, buf: null };
    chunks.push(Buffer.from(chunk));
  }
  return { tooLarge: false, buf: Buffer.concat(chunks) };
}

// ---------------------------------------------------------------------------
// Provenance checks
// ---------------------------------------------------------------------------

function registrableMatch(hostname, list) {
  const host = hostname.toLowerCase();
  return list.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Highest reliability any of these hosts allows, or null for no cap. */
export function domainCap(hostnames) {
  if (hostnames.some((h) => registrableMatch(h, LOW_CAP_DOMAINS))) return 'low';
  if (hostnames.some((h) => registrableMatch(h, MEDIUM_CAP_DOMAINS))) return 'medium';
  return null;
}

/** Strings whose presence in the source page ties the page to the image. */
export function imageReferenceCandidates(imageUrl) {
  const out = new Set();
  let url;
  try {
    url = new URL(imageUrl);
  } catch {
    return [];
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const add = (s) => {
    if (!s) return;
    for (const v of [s, safeDecode(s)]) {
      if (v.length >= 6) out.add(v);
    }
  };
  add(`${url.host}${url.pathname}`);
  add(url.pathname);
  const last = segments.at(-1);
  add(last);
  // Thumbnail renditions: …/thumb/a/ab/Name.png/800px-Name.png → Name.png
  if (last) add(last.replace(/^\d+px-/, ''));
  if (segments.includes('thumb') && segments.length >= 2) add(segments.at(-2));
  return [...out];
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function pageReferencesImage(html, imageUrl) {
  const haystacks = [html, html.replace(/&amp;/g, '&'), safeDecode(html)];
  const candidates = imageReferenceCandidates(imageUrl);
  // Commons file names are usually linked with underscores but captioned
  // with spaces; accept either spelling.
  const variants = candidates.flatMap((c) => [c, c.replace(/_/g, ' '), c.replace(/ /g, '_')]);
  return variants.some((c) => haystacks.some((h) => h.includes(c)));
}

async function checkSourcePage(sourcePageUrl, imageUrl, finalImageUrl) {
  let res;
  try {
    ({ res } = await guardedFetch(sourcePageUrl, {
      timeoutMs: PAGE_TIMEOUT_MS,
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
    }));
  } catch (err) {
    if (err instanceof ToolError && /resolve|valid URL|allowed/.test(err.message)) throw err;
    return { status: 'blocked', httpStatus: null, detail: err.message };
  }
  if (res.status === 404 || res.status === 410) {
    throw new ToolError(
      `Source page returned HTTP ${res.status} — it does not exist. Cite the page you actually opened.`,
    );
  }
  if (!res.ok) {
    return { status: 'blocked', httpStatus: res.status, detail: `HTTP ${res.status}` };
  }
  const { tooLarge, buf } = await readCapped(res, MAX_PAGE_BYTES);
  if (tooLarge || !buf) return { status: 'blocked', httpStatus: res.status, detail: 'page too large to check' };
  const html = buf.toString('utf8');
  const linked = pageReferencesImage(html, imageUrl) || pageReferencesImage(html, finalImageUrl);
  return { status: linked ? 'linked' : 'unlinked', httpStatus: res.status, detail: null };
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

function requireString(args, key) {
  const v = args?.[key];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new ToolError(`"${key}" is required`);
  }
  return v.trim();
}

function optionalString(args, key) {
  const v = args?.[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

export async function fetchWebImage(args) {
  const imageUrl = requireString(args, 'imageUrl');
  const sourcePageUrl = requireString(args, 'sourcePageUrl');
  const sourceName = requireString(args, 'sourceName');
  const description = requireString(args, 'description');
  const declared = requireString(args, 'reliability');
  if (!RELIABILITY_ORDER.includes(declared)) {
    throw new ToolError('"reliability" must be one of high, medium, low');
  }
  const reliabilityNote = optionalString(args, 'reliabilityNote');
  if (declared !== 'high' && !reliabilityNote) {
    throw new ToolError('"reliabilityNote" is required when reliability is not "high" — say why the source is uncertain');
  }

  const { res, finalUrl } = await guardedFetch(imageUrl, {
    timeoutMs: IMAGE_TIMEOUT_MS,
    accept: 'image/png,image/jpeg,image/gif,image/webp;q=0.9,*/*;q=0.1',
  });
  if (!res.ok) throw new ToolError(`Image URL returned HTTP ${res.status}`);
  const { tooLarge, buf } = await readCapped(res, MAX_IMAGE_BYTES);
  if (tooLarge || !buf) {
    throw new ToolError(
      `Image is larger than ${Math.round(MAX_IMAGE_BYTES / 1_000_000 * 10) / 10} MB — use a smaller rendition (e.g. a 1280px thumbnail).`,
    );
  }
  const mediaType = sniffImageType(buf);
  if (!mediaType) {
    const declaredType = res.headers.get('content-type') ?? 'unknown';
    throw new ToolError(
      `URL did not return a PNG/JPEG/GIF/WebP image (content-type: ${declaredType}). ` +
        'If it is an HTML page, find the direct image file URL; for SVG use a PNG thumbnail rendition.',
    );
  }
  const dims = imageDimensions(buf, mediaType);
  if (dims && (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION)) {
    throw new ToolError(`Image is ${dims.width}×${dims.height}px — use a rendition no larger than ${MAX_IMAGE_DIMENSION}px.`);
  }
  if (dims && (dims.width < MIN_IMAGE_DIMENSION || dims.height < MIN_IMAGE_DIMENSION)) {
    throw new ToolError(`Image is only ${dims.width}×${dims.height}px — that is an icon, not a usable example.`);
  }

  const page = await checkSourcePage(sourcePageUrl, imageUrl, finalUrl);

  const notes = [];
  let reliability = declared;
  const cap = domainCap([new URL(sourcePageUrl).hostname, new URL(finalUrl).hostname]);
  if (cap === 'low' && reliability !== 'low') {
    notes.push('Capped to low: user-generated, social or stock-image site.');
    reliability = 'low';
  } else if (cap === 'medium' && reliability === 'high') {
    notes.push('Capped to medium: community-uploaded or self-archived content, not peer reviewed.');
    reliability = 'medium';
  }
  if (page.status === 'unlinked') {
    if (reliability === 'high') reliability = 'medium';
    notes.push('The source page does not reference this image file — the attribution could not be confirmed automatically.');
  } else if (page.status === 'blocked') {
    if (reliability === 'high') reliability = 'medium';
    notes.push(`The source page could not be checked automatically (${page.detail}).`);
  }

  const record = await storeImage(buf, mediaType, {
    origin: 'web',
    createdAt: new Date().toISOString(),
    width: dims?.width,
    height: dims?.height,
    imageUrl,
    finalImageUrl: finalUrl === imageUrl ? undefined : finalUrl,
    sourcePageUrl,
    sourceName,
    description,
    author: optionalString(args, 'author'),
    license: optionalString(args, 'license'),
    declaredReliability: declared,
    reliability,
    reliabilityNote,
    autoNotes: notes,
    pageCheck: page.status,
  });

  const embedUrl = `/api/lesson-chat/media/${record.file}`;
  const pageLine = {
    linked: 'source page reachable and it references this image file ✓',
    unlinked: 'source page reachable but it does NOT reference this image file ✗',
    blocked: `source page could not be checked (${page.detail})`,
  }[page.status];
  const text = [
    `Image stored (${mediaType}${dims ? `, ${dims.width}×${dims.height}px` : ''}, ${Math.round(buf.length / 1024)} KB).`,
    `Provenance check: ${pageLine}.`,
    `Recorded reliability: ${reliability}${reliability !== declared ? ` (declared ${declared})` : ''}.`,
    ...notes.map((n) => `- ${n}`),
    '',
    'NOW LOOK AT THE IMAGE ABOVE before using it:',
    `- Does it clearly show: "${description}"? Is it a real recording/photo, or a schematic/drawing/AI-generated picture? Is it legible?`,
    '- If it does not match, or the learner asked for real examples and this is a drawing, do NOT embed it — look for a better source or say none was found.',
    '',
    'If it matches, embed it exactly like this (the app adds the source caption from the stored provenance):',
    `![${description.replace(/[[\]]/g, '')}](${embedUrl})`,
    'and still name the source with a link, the author/licence if known, and the reliability with its reason when not high.',
  ].join('\n');

  return {
    content: [
      { type: 'image', data: buf.toString('base64'), mimeType: mediaType },
      { type: 'text', text },
    ],
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC plumbing
// ---------------------------------------------------------------------------

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(request) {
  const { id, method, params } = request;
  const isNotification = id === undefined || id === null;
  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        },
      });
    }
    if (method === 'tools/list') {
      return send({ jsonrpc: '2.0', id, result: { tools: [TOOL_DEFINITION] } });
    }
    if (method === 'tools/call') {
      if (params?.name !== TOOL_DEFINITION.name) {
        return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
      }
      try {
        const result = await fetchWebImage(params.arguments ?? {});
        return send({ jsonrpc: '2.0', id, result });
      } catch (err) {
        const message = err instanceof ToolError ? err.message : `Unexpected error: ${err?.message ?? err}`;
        if (!(err instanceof ToolError)) process.stderr.write(`[tutor-media] ${err?.stack ?? err}\n`);
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Image rejected: ${message}` }], isError: true } });
      }
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (isNotification) return undefined;
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    process.stderr.write(`[tutor-media] ${err?.stack ?? err}\n`);
    if (!isNotification) send({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } });
  }
  return undefined;
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (line.trim().length === 0) return;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    void handle(request);
  });
  rl.on('close', () => process.exit(0));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('media-mcp-server.mjs')) {
  main();
}
