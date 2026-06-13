import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  __setYouTubeTranscriptFetcherForTesting,
  addYouTubeSource,
  buildYouTubeSourceMarkdown,
  canonicalYouTubeUrl,
  youTubeSourceFilename,
} from './youtubeSource';
import type { TranscriptFetchResult } from '@/lib/video/transcript';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'yt-source-test-'));
});

afterEach(async () => {
  __setYouTubeTranscriptFetcherForTesting(null);
  await fs.rm(dir, { recursive: true, force: true });
});

describe('youTubeSourceFilename', () => {
  it('embeds the videoId deterministically', () => {
    expect(youTubeSourceFilename('dQw4w9WgXcQ')).toBe('youtube-dQw4w9WgXcQ.md');
  });
});

describe('buildYouTubeSourceMarkdown', () => {
  it('renders a provenance header (url, fetch date, source) + body', () => {
    const md = buildYouTubeSourceMarkdown({
      videoId: 'abcdefghijk',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      source: 'captions',
      segments: [
        { tStart: 0, text: 'Hello there.' },
        { tStart: 5, text: 'Second line.' },
      ],
      fetchedAt: new Date('2026-06-13T10:00:00.000Z'),
    });
    expect(md).toContain('url: https://www.youtube.com/watch?v=abcdefghijk');
    expect(md).toContain('videoId: abcdefghijk');
    expect(md).toContain('fetchedAt: 2026-06-13T10:00:00.000Z');
    expect(md).toContain('transcriptSource: captions');
    expect(md).toContain('Hello there.');
    expect(md).toContain('Second line.');
  });
});

describe('addYouTubeSource', () => {
  it('writes a provenance .md from fetched segments (mocked fetcher)', async () => {
    const fetched: TranscriptFetchResult = {
      source: 'captions',
      segments: [
        { tStart: 0, text: 'Welcome to the lecture.' },
        { tStart: 3, text: 'Today we cover SAR.' },
      ],
    };
    __setYouTubeTranscriptFetcherForTesting(async () => fetched);

    const res = await addYouTubeSource(dir, 'https://youtu.be/abcdefghijk');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.videoId).toBe('abcdefghijk');
    expect(res.filename).toBe('youtube-abcdefghijk.md');
    expect(res.source).toBe('captions');
    expect(res.url).toBe(canonicalYouTubeUrl('abcdefghijk'));

    const written = await fs.readFile(path.join(dir, res.filename), 'utf8');
    expect(written).toContain('source: youtube');
    expect(written).toContain('url: https://www.youtube.com/watch?v=abcdefghijk');
    expect(written).toContain('transcriptSource: captions');
    expect(written).toContain('Welcome to the lecture.');
    expect(written).toContain('Today we cover SAR.');
  });

  it('accepts a bare videoId', async () => {
    __setYouTubeTranscriptFetcherForTesting(async () => ({
      source: 'description',
      segments: [{ tStart: 0, text: 'Description text.' }],
    }));
    const res = await addYouTubeSource(dir, 'abcdefghijk');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.source).toBe('description');
  });

  it('returns an error with NO file written when source is "none"', async () => {
    __setYouTubeTranscriptFetcherForTesting(async () => ({
      source: 'none',
      segments: [],
    }));
    const res = await addYouTubeSource(dir, 'https://youtu.be/abcdefghijk');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/no captions or description/i);
    // Nothing should have been written.
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('rejects an unparseable input with no file written', async () => {
    __setYouTubeTranscriptFetcherForTesting(async () => {
      throw new Error('fetcher should not be called for invalid input');
    });
    const res = await addYouTubeSource(dir, 'not a youtube link');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/valid youtube/i);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('overwrites (does not duplicate) when the same video is re-added', async () => {
    __setYouTubeTranscriptFetcherForTesting(async () => ({
      source: 'captions',
      segments: [{ tStart: 0, text: 'First fetch.' }],
    }));
    const a = await addYouTubeSource(dir, 'abcdefghijk');
    expect(a.ok).toBe(true);

    __setYouTubeTranscriptFetcherForTesting(async () => ({
      source: 'captions',
      segments: [{ tStart: 0, text: 'Second fetch overwrites.' }],
    }));
    const b = await addYouTubeSource(dir, 'https://www.youtube.com/watch?v=abcdefghijk');
    expect(b.ok).toBe(true);

    const files = await fs.readdir(dir);
    expect(files).toEqual(['youtube-abcdefghijk.md']);
    const written = await fs.readFile(path.join(dir, 'youtube-abcdefghijk.md'), 'utf8');
    expect(written).toContain('Second fetch overwrites.');
    expect(written).not.toContain('First fetch.');
  });
});
