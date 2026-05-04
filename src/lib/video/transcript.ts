import type { VideoTranscriptSegment } from '@/widgets/Video/schema';

export type TranscriptSource = 'captions' | 'description' | 'none';

export interface TranscriptFetchResult {
  segments: VideoTranscriptSegment[];
  source: TranscriptSource;
}

type Fetcher = typeof fetch;

const YT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function parseTimedTextXml(xml: string): VideoTranscriptSegment[] {
  if (!xml) return [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  const segments: VideoTranscriptSegment[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const startMatch = /\bstart="([^"]+)"/.exec(attrs);
    const durMatch = /\bdur="([^"]+)"/.exec(attrs);
    if (!startMatch) continue;
    const tStart = Number(startMatch[1]);
    if (!Number.isFinite(tStart) || tStart < 0) continue;
    // strip nested tags like <br />, decode entities, normalise whitespace
    const text = decodeXmlEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const seg: VideoTranscriptSegment = { tStart, text };
    if (durMatch) {
      const dur = Number(durMatch[1]);
      if (Number.isFinite(dur) && dur > 0) seg.tEnd = tStart + dur;
    }
    segments.push(seg);
  }
  return segments;
}

/**
 * Find the first JSON-string value associated with `key` in `html`. Returns
 * the unescaped string, or null if not found / not parseable.
 */
function extractJsonStringValue(html: string, key: string): string | null {
  const needle = `"${key}":"`;
  const i = html.indexOf(needle);
  if (i < 0) return null;
  const start = i + needle.length - 1; // index of opening quote
  let j = i + needle.length;
  while (j < html.length) {
    const c = html.charCodeAt(j);
    if (c === 0x5c /* \\ */) {
      j += 2;
      continue;
    }
    if (c === 0x22 /* " */) break;
    j++;
  }
  if (j >= html.length) return null;
  const raw = html.slice(start, j + 1);
  try {
    return JSON.parse(raw) as string;
  } catch {
    return null;
  }
}

export function extractShortDescription(html: string): string | null {
  return extractJsonStringValue(html, 'shortDescription');
}

/**
 * Pulls the first caption track baseUrl from a YouTube watch-page HTML.
 * Prefers `lang=en` if multiple tracks are present.
 */
export function extractCaptionTrackUrl(html: string): string | null {
  // Find captionTracks JSON array; do not assume strict JSON-friendly delimiters
  // because the watch page often contains nested objects/strings inside that array.
  const idx = html.indexOf('"captionTracks":[');
  if (idx < 0) return null;
  // Walk a bracket counter to find the matching ']'.
  let i = idx + '"captionTracks":'.length; // points at '['
  if (html[i] !== '[') return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  let end = -1;
  for (; i < html.length; i++) {
    const c = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  const arrText = html.slice(idx + '"captionTracks":'.length, end).replace(/\\u0026/g, '&');
  let arr: unknown;
  try {
    arr = JSON.parse(arrText);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const tracks = arr as Array<{
    baseUrl?: string;
    languageCode?: string;
    kind?: string;
  }>;
  // Prefer manual English captions; then any English; then anything.
  const englishManual = tracks.find(
    (t) => t.languageCode === 'en' && t.kind !== 'asr',
  );
  const englishAny = tracks.find((t) => t.languageCode === 'en');
  const first = tracks.find((t) => typeof t.baseUrl === 'string');
  const pick = englishManual ?? englishAny ?? first;
  return pick?.baseUrl ?? null;
}

async function safeFetchText(
  fetcher: Fetcher,
  url: string,
): Promise<string | null> {
  try {
    const res = await fetcher(url, {
      headers: {
        'User-Agent': YT_USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Fetch a transcript for the given YouTube video id. Tries caption tracks first,
 * then falls back to the video description (rendered as a single segment at t=0).
 *
 * Never throws — on any error returns `{ segments: [], source: 'none' }`.
 */
export async function fetchYouTubeTranscript(
  videoId: string,
  fetcher: Fetcher = fetch,
): Promise<TranscriptFetchResult> {
  if (!videoId) return { segments: [], source: 'none' };
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;
  const html = await safeFetchText(fetcher, watchUrl);
  if (!html) return { segments: [], source: 'none' };

  const captionUrl = extractCaptionTrackUrl(html);
  if (captionUrl) {
    const xml = await safeFetchText(fetcher, captionUrl);
    if (xml && xml.trim()) {
      const segments = parseTimedTextXml(xml);
      if (segments.length > 0) {
        return { segments, source: 'captions' };
      }
    }
  }

  const description = extractShortDescription(html);
  if (description && description.trim()) {
    return {
      segments: [{ tStart: 0, text: description.trim() }],
      source: 'description',
    };
  }

  return { segments: [], source: 'none' };
}
