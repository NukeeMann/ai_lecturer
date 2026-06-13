// US-215 — turn a YouTube link into a source-material file.
//
// The wizard's materials step lets the user paste a YouTube URL (or bare
// videoId). We fetch the video's transcript with the existing
// `fetchYouTubeTranscript` helper (captions first, description fallback) and
// persist it under /sources/ as a plain `.md` file with a provenance header,
// so it flows through the rest of the pipeline (Clarify / Structure / lesson
// generation) exactly like any uploaded text document.
//
// Filename is deterministic — `youtube-<videoId>.md` — so re-adding the same
// video OVERWRITES the previous transcript instead of duplicating it.

import path from 'node:path';
import { promises as fs } from 'node:fs';

import { extractYouTubeId, type VideoTranscriptSegment } from '@/widgets/Video/schema';
import {
  fetchYouTubeTranscript,
  type TranscriptFetchResult,
  type TranscriptSource,
} from '@/lib/video/transcript';

/** A function that, given a videoId, resolves its transcript. Defaults to the
 *  real `fetchYouTubeTranscript`; overridable in tests so we never hit the
 *  network. */
export type YouTubeTranscriptFetcher = (
  videoId: string,
) => Promise<TranscriptFetchResult>;

const defaultFetcher: YouTubeTranscriptFetcher = (videoId) =>
  fetchYouTubeTranscript(videoId);

let transcriptFetcher: YouTubeTranscriptFetcher = defaultFetcher;

/** Test seam: inject a mock transcript fetcher (or pass null to restore the
 *  real network-backed one). */
export function __setYouTubeTranscriptFetcherForTesting(
  fn: YouTubeTranscriptFetcher | null,
): void {
  transcriptFetcher = fn ?? defaultFetcher;
}

/** Deterministic on-disk filename for a YouTube transcript source. The
 *  videoId is embedded so re-adding the same video overwrites rather than
 *  duplicates (US-215). Always `.md` — a plain-text source the prompt loaders
 *  read directly. */
export function youTubeSourceFilename(videoId: string): string {
  return `youtube-${videoId}.md`;
}

/** Canonical watch URL for a videoId — used as the provenance `url`. */
export function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

const SOURCE_LABEL: Record<Exclude<TranscriptSource, 'none'>, string> = {
  captions: 'captions',
  description: 'description',
};

/** Render the transcript file body: a YAML-style provenance header (URL, fetch
 *  date, source) followed by the transcript text, one segment per line. Pure —
 *  no I/O — so tests can assert on the exact output. */
export function buildYouTubeSourceMarkdown(args: {
  videoId: string;
  url: string;
  source: Exclude<TranscriptSource, 'none'>;
  segments: VideoTranscriptSegment[];
  fetchedAt: Date;
}): string {
  const { videoId, url, source, segments, fetchedAt } = args;
  const body = segments
    .map((s) => s.text.trim())
    .filter((t) => t.length > 0)
    .join('\n\n');
  const header = [
    '---',
    'source: youtube',
    `url: ${url}`,
    `videoId: ${videoId}`,
    `fetchedAt: ${fetchedAt.toISOString()}`,
    `transcriptSource: ${SOURCE_LABEL[source]}`,
    '---',
    '',
    `# YouTube transcript — ${videoId}`,
    '',
    `Fetched from ${url} on ${fetchedAt.toISOString()} (source: ${SOURCE_LABEL[source]}).`,
    '',
  ].join('\n');
  return `${header}\n${body}\n`;
}

export type AddYouTubeSourceResult =
  | {
      ok: true;
      videoId: string;
      url: string;
      filename: string;
      size: number;
      source: Exclude<TranscriptSource, 'none'>;
    }
  | { ok: false; reason: string };

/**
 * Resolve `rawInput` (full URL or bare videoId) to a transcript and write it
 * to `targetDir` as `youtube-<videoId>.md`. Overwrites on repeat. Returns a
 * structured error (no file written) when the input is unparseable or the
 * video has neither captions nor a description (`source: 'none'`).
 */
export async function addYouTubeSource(
  targetDir: string,
  rawInput: string,
): Promise<AddYouTubeSourceResult> {
  const videoId = extractYouTubeId(typeof rawInput === 'string' ? rawInput : '');
  if (!videoId) {
    return { ok: false, reason: 'Enter a valid YouTube URL or video ID' };
  }

  const result = await transcriptFetcher(videoId);
  if (result.source === 'none' || result.segments.length === 0) {
    return {
      ok: false,
      reason:
        'This video has no captions or description we can use as source material',
    };
  }

  const url = canonicalYouTubeUrl(videoId);
  const md = buildYouTubeSourceMarkdown({
    videoId,
    url,
    source: result.source,
    segments: result.segments,
    fetchedAt: new Date(),
  });

  await fs.mkdir(targetDir, { recursive: true });
  const filename = youTubeSourceFilename(videoId);
  const destPath = path.join(targetDir, filename);
  // Deterministic name → plain writeFile overwrites a prior transcript for
  // the same video rather than producing `youtube-<id> (2).md`.
  await fs.writeFile(destPath, md, 'utf8');
  const stat = await fs.stat(destPath);

  return {
    ok: true,
    videoId,
    url,
    filename,
    size: stat.size,
    source: result.source,
  };
}
