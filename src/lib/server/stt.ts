// US-154: server-only whisper.cpp subprocess wrapper.
// Spawns the locally-built `main` (or `whisper-cli`) binary, captures the
// transcript .txt it emits, and returns the text.

import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { aiLecturerHome } from '@/lib/server/tts-cache';
import { coursesRoot } from '@/lib/server/paths';
import type { SttRequest, SttResponse, SttSegment } from '@/lib/schemas/tts';
import { parseWavDurationMs } from '@/lib/server/tts';

export class SttNotInstalledError extends Error {
  constructor(public readonly binaryPath: string, public readonly modelPath: string) {
    super(
      `whisper.cpp not installed: missing ${binaryPath} or ${modelPath}. Run scripts/setup-stt.sh first.`,
    );
    this.name = 'SttNotInstalledError';
  }
}

export class SttSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SttSpawnError';
  }
}

export class SttPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SttPathError';
  }
}

export class SttTranscodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SttTranscodeError';
  }
}

/** Extensions whisper-cli decodes natively. Anything else must be transcoded
 *  to 16 kHz mono PCM WAV via ffmpeg first. */
const WHISPER_NATIVE_EXTS = new Set(['.wav', '.ogg', '.mp3', '.flac']);

/** Transcode `input` to a sibling `.transcoded.wav` (16 kHz mono PCM) using
 *  ffmpeg. Browser MediaRecorder typically produces webm/opus, which
 *  whisper-cli cannot decode. */
async function transcodeToWav(
  input: string,
  spawnFn: typeof defaultSpawn,
): Promise<string> {
  const out = `${input}.transcoded.wav`;
  const args = ['-y', '-i', input, '-ac', '1', '-ar', '16000', out];
  let child: ChildProcess;
  try {
    child = spawnFn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    throw new SttTranscodeError(
      `Failed to spawn ffmpeg: ${(err as Error).message}. Install with: sudo apt-get install -y ffmpeg`,
    );
  }
  const stderrChunks: Buffer[] = [];
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  const exitCode: number = await new Promise((resolve, reject) => {
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new SttTranscodeError(
            'ffmpeg not found on PATH. Install with: sudo apt-get install -y ffmpeg',
          ),
        );
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => resolve(code ?? 0));
  });
  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(0, 512);
    throw new SttTranscodeError(`ffmpeg exited with code ${exitCode}: ${stderr}`);
  }
  return out;
}

/** Default candidate paths for the whisper.cpp executable. Newer
 *  whisper.cpp builds emit `build/bin/whisper-cli` and ship a deprecated
 *  `build/bin/main` stub that prints a warning and exits non-zero on
 *  modern args — so `whisper-cli` MUST come first. Older builds emit a
 *  top-level `main` binary. */
export function whisperBinaryCandidates(): string[] {
  const override = process.env.AI_LECTURER_STT_BIN;
  if (override && override.length > 0) return [override];
  const root = path.join(process.cwd(), 'scripts', '.bin', 'whisper.cpp');
  return [
    path.join(root, 'build', 'bin', 'whisper-cli'),
    path.join(root, 'main'),
    path.join(root, 'build', 'bin', 'main'),
  ];
}

export function whisperModelPath(): string {
  const override = process.env.AI_LECTURER_STT_MODEL;
  if (override && override.length > 0) return override;
  return path.join(
    process.cwd(),
    'scripts',
    '.bin',
    'whisper.cpp',
    'models',
    'ggml-base.en.bin',
  );
}

export interface AllowedRoots {
  home: string;
  courses: string;
}

export function allowedRoots(): AllowedRoots {
  // Use realpath where possible so symlinked tmp dirs (macOS / WSL2) match
  // resolved input paths. Fall back to the literal path on failure.
  return {
    home: aiLecturerHome(),
    courses: coursesRoot(),
  };
}

function endsWithSep(p: string): string {
  return p.endsWith(path.sep) ? p : p + path.sep;
}

/**
 * Resolve a user-supplied audioPath into an absolute path that is
 * guaranteed to live under one of the allowed roots. Throws SttPathError
 * on traversal attempts or unknown locations.
 *
 * Accepts:
 *   - absolute paths (must start with one of the allowed roots after
 *     resolve)
 *   - paths starting with `~/` (expanded against `os.homedir()`)
 *   - relative paths (resolved against `~/.ai-lecturer/` first; if the
 *     file does not exist there, retried against `<courses>/`)
 */
export async function resolveAudioPath(
  input: string,
  rootsOverride?: AllowedRoots,
): Promise<string> {
  const roots = rootsOverride ?? allowedRoots();
  let candidate: string;
  if (input.startsWith('~/') || input === '~') {
    candidate = path.resolve(path.join(os.homedir(), input.slice(1)));
  } else if (path.isAbsolute(input)) {
    candidate = path.resolve(input);
  } else {
    // Try home first; fall back to courses if not present there.
    const homeCandidate = path.resolve(roots.home, input);
    let exists = false;
    try {
      await fs.access(homeCandidate);
      exists = true;
    } catch {
      exists = false;
    }
    candidate = exists ? homeCandidate : path.resolve(roots.courses, input);
  }

  const homePrefix = endsWithSep(roots.home);
  const coursesPrefix = endsWithSep(roots.courses);
  const inHome = candidate === roots.home || candidate.startsWith(homePrefix);
  const inCourses =
    candidate === roots.courses || candidate.startsWith(coursesPrefix);

  if (!inHome && !inCourses) {
    throw new SttPathError(
      `Refusing audioPath outside allowed roots: ${candidate}`,
    );
  }

  // Final existence check — opening a directory would also fail at whisper
  // time, so we surface the clearer error here.
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) {
      throw new SttPathError(`audioPath is not a regular file: ${candidate}`);
    }
  } catch (err) {
    if (err instanceof SttPathError) throw err;
    throw new SttPathError(`audioPath does not exist: ${candidate}`);
  }

  return candidate;
}

export interface SttSpawnDeps {
  spawn?: typeof defaultSpawn;
  /** Override binary-existence check for tests. Default: fs.access X_OK. */
  binaryExists?: (binaryPath: string) => Promise<boolean>;
  /** Override model-presence check for tests. Default: fs.access R_OK. */
  modelExists?: (modelPath: string) => Promise<boolean>;
}

let depsOverride: SttSpawnDeps | null = null;

/** Test-only: replace the spawn / file-existence deps used by `runStt`. */
export function __setSttDepsForTesting(deps: SttSpawnDeps | null): void {
  depsOverride = deps;
}

async function defaultBinaryExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function defaultModelExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Pick the first whisper binary candidate that exists; null if none. */
export async function pickWhisperBinary(
  exists: (p: string) => Promise<boolean> = defaultBinaryExists,
): Promise<string | null> {
  for (const candidate of whisperBinaryCandidates()) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Build the argv list for the whisper.cpp CLI. Exposed for tests.
 * `-otxt` writes the plain transcript to `<outBase>.txt`; `-oj` adds a
 * `<outBase>.json` with word/segment timings (consumed for the optional
 * `segments` output field).
 */
export function buildWhisperArgs(opts: {
  audioPath: string;
  modelPath: string;
  outBase: string;
  language: string;
}): string[] {
  return [
    '-m',
    opts.modelPath,
    '-f',
    opts.audioPath,
    '-l',
    opts.language,
    '-otxt',
    '-oj',
    '-of',
    opts.outBase,
  ];
}

interface WhisperJsonSegment {
  offsets?: { from?: number; to?: number };
  text?: string;
}

interface WhisperJsonOutput {
  transcription?: WhisperJsonSegment[];
}

export function parseWhisperSegments(json: string): SttSegment[] | undefined {
  let parsed: WhisperJsonOutput;
  try {
    parsed = JSON.parse(json) as WhisperJsonOutput;
  } catch {
    return undefined;
  }
  const list = parsed.transcription;
  if (!Array.isArray(list)) return undefined;
  const segments: SttSegment[] = [];
  for (const seg of list) {
    const fromMs = seg.offsets?.from;
    const toMs = seg.offsets?.to;
    const text = seg.text;
    if (typeof fromMs !== 'number' || typeof toMs !== 'number' || typeof text !== 'string') {
      continue;
    }
    segments.push({
      start: fromMs / 1000,
      end: toMs / 1000,
      text: text.trim(),
    });
  }
  return segments.length > 0 ? segments : undefined;
}

export interface RunSttInput {
  resolvedAudioPath: string;
  language: string;
}

/**
 * Run whisper.cpp on `resolvedAudioPath` (already validated by the caller
 * to live under an allowed root) and return its transcript. The caller is
 * responsible for path-resolution + traversal-rejection so this function
 * stays focused on the subprocess shape.
 */
export async function runStt(input: RunSttInput): Promise<SttResponse> {
  const exists = depsOverride?.binaryExists ?? defaultBinaryExists;
  const modelCheck = depsOverride?.modelExists ?? defaultModelExists;
  const binaryPath = await pickWhisperBinary(exists);
  const modelPath = whisperModelPath();
  if (!binaryPath || !(await modelCheck(modelPath))) {
    throw new SttNotInstalledError(
      binaryPath ?? whisperBinaryCandidates()[0],
      modelPath,
    );
  }

  const spawnFn = depsOverride?.spawn ?? defaultSpawn;

  // whisper-cli only decodes flac/mp3/ogg/wav natively; transcode anything
  // else (webm, m4a, mp4, ...) to 16 kHz mono WAV first.
  let audioPath = input.resolvedAudioPath;
  let transcodedPath: string | null = null;
  const ext = path.extname(audioPath).toLowerCase();
  if (!WHISPER_NATIVE_EXTS.has(ext)) {
    transcodedPath = await transcodeToWav(audioPath, spawnFn);
    audioPath = transcodedPath;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-lecturer-stt-'));
  const outBase = path.join(tmpDir, 'out');
  const args = buildWhisperArgs({
    audioPath,
    modelPath,
    outBase,
    language: input.language,
  });

  let child: ChildProcess;
  try {
    child = spawnFn(binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    throw new SttSpawnError(`Failed to spawn ${binaryPath}: ${(err as Error).message}`);
  }

  if (!child.stdout || !child.stderr) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    throw new SttSpawnError(`Spawned ${binaryPath} but stdio is not piped`);
  }

  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', () => {
    /* ignore */
  });
  child.stderr.on('data', (chunk: Buffer | string) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  if (child.stdin) {
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
  }

  const exitCode: number = await new Promise((resolve, reject) => {
    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve(code ?? 0));
  });

  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString('utf8');
    await fs.rm(tmpDir, { recursive: true, force: true });
    if (transcodedPath) await fs.rm(transcodedPath, { force: true });
    throw new SttSpawnError(
      `whisper.cpp exited with code ${exitCode}: ${stderr.slice(0, 512)}`,
    );
  }

  let transcript = '';
  try {
    transcript = (await fs.readFile(`${outBase}.txt`, 'utf8')).trim();
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    if (transcodedPath) await fs.rm(transcodedPath, { force: true });
    throw new SttSpawnError(
      `whisper.cpp succeeded but did not produce ${outBase}.txt: ${(err as Error).message}`,
    );
  }

  let segments: SttSegment[] | undefined;
  try {
    const json = await fs.readFile(`${outBase}.json`, 'utf8');
    segments = parseWhisperSegments(json);
  } catch {
    segments = undefined;
  }

  // Best-effort duration: wav-header parse on whichever path is WAV. Prefer
  // the transcoded WAV when present (covers webm/m4a uploads); fall back to
  // the original (works when the source is already WAV).
  let durationMs = 0;
  try {
    const audioBuf = await fs.readFile(transcodedPath ?? input.resolvedAudioPath);
    durationMs = parseWavDurationMs(audioBuf);
  } catch {
    durationMs = 0;
  }

  await fs.rm(tmpDir, { recursive: true, force: true });
  if (transcodedPath) await fs.rm(transcodedPath, { force: true });

  const result: SttResponse = { transcript, durationMs };
  if (segments) result.segments = segments;
  return result;
}

export async function processSttRequest(req: SttRequest): Promise<SttResponse> {
  const resolved = await resolveAudioPath(req.audioPath);
  return runStt({ resolvedAudioPath: resolved, language: req.language });
}
