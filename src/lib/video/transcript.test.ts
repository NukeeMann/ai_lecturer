import { describe, expect, test, vi } from 'vitest';

import {
  extractCaptionTrackUrl,
  extractShortDescription,
  fetchYouTubeTranscript,
  parseTimedTextXml,
} from './transcript';

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<transcript>
  <text start="0" dur="3.5">Hello there.</text>
  <text start="3.5" dur="4.2">This is a transcript &amp; it works.</text>
  <text start="7.7" dur="5">Final &#39;line&#39;.</text>
</transcript>`;

const HTML_WITH_CAPTIONS = `<html><head></head><body>
<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc\\u0026lang=en\\u0026sig=XYZ","name":{"simpleText":"English"},"languageCode":"en"}]}},"videoDetails":{"shortDescription":"Hello\\nworld"}};</script>
</body></html>`;

const HTML_DESCRIPTION_ONLY = `<html><head></head><body>
<script>var ytInitialPlayerResponse = {"captions":{},"videoDetails":{"shortDescription":"Just a description.\\nLine two."}};</script>
</body></html>`;

const HTML_NEITHER = `<html><head></head><body>
<script>var ytInitialPlayerResponse = {};</script>
</body></html>`;

describe('parseTimedTextXml', () => {
  test('parses <text> entries with start, dur, decoded text', () => {
    const segs = parseTimedTextXml(SAMPLE_XML);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ tStart: 0, text: 'Hello there.' });
    expect(segs[0].tEnd).toBeCloseTo(3.5);
    expect(segs[1].text).toBe('This is a transcript & it works.');
    expect(segs[2].text).toBe(`Final 'line'.`);
  });

  test('returns empty array for empty/invalid XML', () => {
    expect(parseTimedTextXml('')).toEqual([]);
    expect(parseTimedTextXml('<garbage />')).toEqual([]);
  });
});

describe('extractCaptionTrackUrl', () => {
  test('finds first English caption track baseUrl', () => {
    const url = extractCaptionTrackUrl(HTML_WITH_CAPTIONS);
    expect(url).toContain('https://www.youtube.com/api/timedtext?v=abc');
    expect(url).toContain('lang=en');
    // & must be unescaped to &
    expect(url).not.toContain('\\u0026');
  });

  test('returns null when no captionTracks present', () => {
    expect(extractCaptionTrackUrl(HTML_DESCRIPTION_ONLY)).toBeNull();
  });
});

describe('extractShortDescription', () => {
  test('extracts and unescapes shortDescription', () => {
    expect(extractShortDescription(HTML_WITH_CAPTIONS)).toBe('Hello\nworld');
    expect(extractShortDescription(HTML_DESCRIPTION_ONLY)).toBe(
      'Just a description.\nLine two.',
    );
  });

  test('returns null when missing', () => {
    expect(extractShortDescription(HTML_NEITHER)).toBeNull();
  });
});

describe('fetchYouTubeTranscript — captions priority', () => {
  test('returns caption-derived segments when captions exist', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/watch?v=')) {
        return new Response(HTML_WITH_CAPTIONS, { status: 200 });
      }
      if (url.includes('/api/timedtext')) {
        return new Response(SAMPLE_XML, { status: 200 });
      }
      throw new Error('unexpected url ' + url);
    });
    const result = await fetchYouTubeTranscript('abc', fetcher);
    expect(result.source).toBe('captions');
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments[0].text).toContain('Hello there');
    // captions endpoint must be called AFTER the watch page
    const callOrder = fetcher.mock.calls.map((c) => String(c[0]));
    expect(callOrder[0]).toContain('/watch?v=');
    expect(callOrder.some((u) => u.includes('/api/timedtext'))).toBe(true);
  });
});

describe('fetchYouTubeTranscript — description fallback', () => {
  test('falls back to description when no caption track is listed', async () => {
    const fetcher = vi.fn(async () =>
      new Response(HTML_DESCRIPTION_ONLY, { status: 200 }),
    );
    const result = await fetchYouTubeTranscript('xyz', fetcher);
    expect(result.source).toBe('description');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      tStart: 0,
      text: 'Just a description.\nLine two.',
    });
  });

  test('falls back to description when caption fetch returns empty body', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/watch?v=')) {
        // include a caption track but the captions endpoint will return empty
        return new Response(HTML_WITH_CAPTIONS, { status: 200 });
      }
      if (url.includes('/api/timedtext')) {
        return new Response('', { status: 200 });
      }
      throw new Error('unexpected url ' + url);
    });
    const result = await fetchYouTubeTranscript('abc', fetcher);
    expect(result.source).toBe('description');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('Hello\nworld');
  });
});

describe('fetchYouTubeTranscript — neither captions nor description', () => {
  test('returns empty segments and source=none (no error)', async () => {
    const fetcher = vi.fn(async () => new Response(HTML_NEITHER, { status: 200 }));
    const result = await fetchYouTubeTranscript('nope', fetcher);
    expect(result.source).toBe('none');
    expect(result.segments).toEqual([]);
  });

  test('does NOT throw when watch page request fails', async () => {
    const fetcher = vi.fn(async () => new Response('boom', { status: 500 }));
    const result = await fetchYouTubeTranscript('nope', fetcher);
    expect(result.source).toBe('none');
    expect(result.segments).toEqual([]);
  });
});
