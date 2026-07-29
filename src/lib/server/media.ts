// US-214: server-only helper for audio/video source uploads. An uploaded
// lecture recording (.mp3/.wav/.m4a/.mp4) is transcribed locally with the
// existing whisper.cpp infrastructure (src/lib/server/stt.ts) and the
// transcript is written to the same `.extracted/<name>.md` sibling that the
// docx/pdf/pptx extractors use — so once it lands the transcript flows into
// the curriculum/lesson/wizard generation prompts exactly like any other
// extracted text source (extractedFrom set, see resolveSourcePathForPrompt).
//
// Transcription can take minutes for a long .mp4, so the upload route does
// NOT await it: it writes a `transcribing` status marker synchronously and
// kicks the work off in the background. The wizard polls GET
// /api/courses/upload-sources, which reports the per-file status
// (transcribing → done/failed), until it resolves.
//
// When whisper.cpp or ffmpeg is not installed (SttNotInstalledError /
// SttTranscodeError) the file is left as-is on disk and the status is set to
// `failed` with the error's human-readable install hint — the upload itself
// never crashes.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  EXTRACTED_DIRNAME,
  MEDIA_EXTENSIONS,
  extractedSiblingPath,
} from './sources';
import {
  SttNotInstalledError,
  SttSpawnError,
  SttTranscodeError,
  runStt,
} from './stt';
import type { SttResponse } from '@/lib/schemas/tts';

export type TranscriptStatusValue = 'transcribing' | 'done' | 'failed';

export interface TranscriptStatus {
  status: TranscriptStatusValue;
  /** Human-readable reason, set when `status === 'failed'`. For missing
   *  whisper/ffmpeg this is the SttNotInstalledError/SttTranscodeError
   *  message, which already contains the install hint. */
  reason?: string;
  updatedAt: string;
}

/** Whisper transcription language. The bundled model is `ggml-base.en.bin`
 *  (English) but a CUDA / multilingual model may be wired in via
 *  AI_LECTURER_STT_MODEL — `auto` lets whisper.cpp detect the spoken
 *  language. Overridable for callers that know the recording's language. */
function sttLanguage(): string {
  const raw = process.env.AI_LECTURER_STT_LANGUAGE;
  return raw && raw.length > 0 ? raw : 'auto';
}

export function isMediaExtension(ext: string): boolean {
  return MEDIA_EXTENSIONS.has(ext.toLowerCase());
}

/** Status sidecar for a media upload: `<dir>/.extracted/<name>.status.json`.
 *  Lives next to the `<name>.md` transcript so the two move together. */
export function transcriptStatusPath(absPath: string): string {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);
  return path.join(dir, EXTRACTED_DIRNAME, `${base}.status.json`);
}

export async function readTranscriptStatus(
  absPath: string,
): Promise<TranscriptStatus | null> {
  try {
    const raw = await fs.readFile(transcriptStatusPath(absPath), 'utf8');
    const parsed = JSON.parse(raw) as TranscriptStatus;
    if (
      parsed &&
      (parsed.status === 'transcribing' ||
        parsed.status === 'done' ||
        parsed.status === 'failed')
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeTranscriptStatus(
  absPath: string,
  status: TranscriptStatus,
): Promise<void> {
  const statusPath = transcriptStatusPath(absPath);
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.writeFile(statusPath, JSON.stringify(status), 'utf8');
}

// ─── Transcriber (injectable for tests) ─────────────────────────────────────

/** The unit of work behind transcription: take a resolved media path, return
 *  its transcript. Defaults to the real whisper.cpp runner; tests override it
 *  via `__setMediaTranscriberForTesting` so no real whisper/ffmpeg is needed. */
export type MediaTranscriber = (absPath: string) => Promise<SttResponse>;

const defaultTranscriber: MediaTranscriber = (absPath) =>
  runStt({ resolvedAudioPath: absPath, language: sttLanguage() });

let transcriberOverride: MediaTranscriber | null = null;

/** Test-only: swap the function that actually runs whisper.cpp. Pass `null`
 *  to restore the real runner. */
export function __setMediaTranscriberForTesting(
  fn: MediaTranscriber | null,
): void {
  transcriberOverride = fn;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Transcribe `absPath` and write the transcript to its
 * `.extracted/<name>.md` sibling. Returns the resulting `TranscriptStatus`
 * — `done` on success, `failed` (with a readable reason) when whisper/ffmpeg
 * is missing or the run errors. Does NOT throw: every failure is folded into
 * the returned status so the background runner can persist it.
 */
export async function transcribeMediaToSibling(
  absPath: string,
): Promise<TranscriptStatus> {
  const transcriber = transcriberOverride ?? defaultTranscriber;
  let result: SttResponse;
  try {
    result = await transcriber(absPath);
  } catch (err) {
    // Missing tooling (whisper or ffmpeg) is the expected "not processed"
    // path — surface the error message verbatim because it already carries
    // the install hint (see SttNotInstalledError / SttTranscodeError).
    if (
      err instanceof SttNotInstalledError ||
      err instanceof SttTranscodeError ||
      err instanceof SttSpawnError
    ) {
      return { status: 'failed', reason: err.message, updatedAt: nowIso() };
    }
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
      updatedAt: nowIso(),
    };
  }

  // Strip U+0000 for the same reason the pdf/pptx extractors do (US-128): the
  // markdown may later be inlined into a `spawn('claude', ['-p', prompt])`
  // argv, which cannot carry null bytes.
  const transcript = result.transcript.replace(/\u0000/g, '').trim();
  const markdown = `# Transkrypcja: ${path.basename(absPath)}\n\n${transcript}\n`;
  const sibling = extractedSiblingPath(absPath);
  try {
    await fs.mkdir(path.dirname(sibling), { recursive: true });
    await fs.writeFile(sibling, markdown, 'utf8');
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
      updatedAt: nowIso(),
    };
  }
  return { status: 'done', updatedAt: nowIso() };
}

// ─── Background orchestration ────────────────────────────────────────────────

const pending = new Set<Promise<void>>();

/**
 * Kick off transcription for an uploaded media file WITHOUT blocking the
 * caller (the upload request). Writes a `transcribing` status marker first
 * (awaited, so a GET immediately after upload already sees it), then runs the
 * transcription in the background and persists the final `done`/`failed`
 * status when it resolves.
 *
 * Returns after the marker is written; the background promise is tracked so
 * tests can await it via `awaitPendingMediaTranscriptions()`.
 */
export async function startMediaTranscription(absPath: string): Promise<void> {
  await writeTranscriptStatus(absPath, {
    status: 'transcribing',
    updatedAt: nowIso(),
  });
  const work = transcribeMediaToSibling(absPath)
    .then((status) => writeTranscriptStatus(absPath, status))
    .catch(async (err: unknown) => {
      // transcribeMediaToSibling is designed not to throw, but persist a
      // failure status if it ever does so the UI doesn't poll forever.
      await writeTranscriptStatus(absPath, {
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
        updatedAt: nowIso(),
      }).catch(() => {});
    });
  pending.add(work);
  void work.finally(() => pending.delete(work));
}

/** Test-only: await every background transcription started so far. */
export async function awaitPendingMediaTranscriptions(): Promise<void> {
  await Promise.allSettled([...pending]);
}
