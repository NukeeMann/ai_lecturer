// US-154: server-only whisper.cpp subprocess wrapper.
// Spawns the locally-built `main` (or `whisper-cli`) binary, captures the
// transcript .txt it emits, and returns the text.
//
// US-168: device selection (CPU vs CUDA). whisper.cpp ships two distinct
// builds: the default CPU build under `scripts/.bin/whisper.cpp/...` and an
// opt-in CUDA build under `scripts/.whisper-cuda/...` (built via
// `scripts/setup-stt-cuda.sh`). whisper-cli auto-uses GPU when built with
// CUDA, so argv is identical between the two builds — only the binary path
// changes. Behaviour:
//   - `AI_LECTURER_STT_DEVICE=auto` (default) → call `whisperCudaAvailable()`
//     which stat's the CUDA binary and shells out to `nvidia-smi`. If both
//     succeed, the CUDA path is spawned; otherwise the existing CPU path is
//     used unchanged. Probe result is memoised for the process lifetime;
//     failures are silent (CPU fallback) and logged once at info level.
//   - `AI_LECTURER_STT_DEVICE=cuda` → force the CUDA binary path. If it's
//     missing, the spawn fails as SttNotInstalledError.
//   - `AI_LECTURER_STT_DEVICE=cpu` → never consult the probe; use the
//     existing CPU candidate list.
// The CUDA binary path itself can be overridden via
// `AI_LECTURER_WHISPER_CUDA_BIN` (useful when CUDA whisper.cpp is installed
// somewhere outside `scripts/.whisper-cuda/`).

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

/** Path to the optional CUDA-built whisper-cli. Built by
 *  `scripts/setup-stt-cuda.sh`; absent on systems without the CUDA toolkit.
 *  Override with `AI_LECTURER_WHISPER_CUDA_BIN` when whisper.cpp's CUDA
 *  build lives elsewhere. */
export function whisperCudaBinaryPath(): string {
  const override = process.env.AI_LECTURER_WHISPER_CUDA_BIN;
  if (override && override.length > 0) return override;
  return path.join(
    process.cwd(),
    'scripts',
    '.whisper-cuda',
    'build',
    'bin',
    'whisper-cli',
  );
}

export type SttDeviceMode = 'cuda' | 'cpu' | 'auto';

/** Read & validate `AI_LECTURER_STT_DEVICE`. Unknown values fall back to `auto`. */
export function sttDeviceMode(): SttDeviceMode {
  const raw = (process.env.AI_LECTURER_STT_DEVICE ?? 'auto').toLowerCase();
  if (raw === 'cuda' || raw === 'cpu' || raw === 'auto') return raw;
  return 'auto';
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

/** Test-only: replace the spawn / file-existence deps used by `runStt`. Also
 *  resets the memoised CUDA probe result so each test starts from a clean
 *  slate (mock spawn behaviour can change between tests). */
export function __setSttDepsForTesting(deps: SttSpawnDeps | null): void {
  depsOverride = deps;
  whisperCudaProbeResult = null;
  whisperCudaProbeLogged = false;
}

let whisperCudaProbeResult: { available: boolean; binaryPath: string } | null = null;
let whisperCudaProbeLogged = false;

function logWhisperCudaProbeFailure(reason: string): void {
  if (whisperCudaProbeLogged) return;
  whisperCudaProbeLogged = true;
  console.info(`STT CUDA probe failed, using CPU: ${reason}`);
}

/**
 * Spawn `nvidia-smi -L` and resolve true iff it exits 0. Any spawn error
 * (ENOENT when nvidia-smi isn't on PATH, etc.) resolves false. Used as a
 * cheap "is there an NVIDIA driver wired up?" check that doesn't depend on
 * the whisper.cpp build's CUDA backend actually working.
 */
async function probeNvidiaSmi(): Promise<boolean> {
  const spawnFn = depsOverride?.spawn ?? defaultSpawn;
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn('nvidia-smi', ['-L'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Probe whether the CUDA-built whisper.cpp is usable. Order:
 *   1. Stat `whisperCudaBinaryPath()` (default `scripts/.whisper-cuda/build/bin/whisper-cli`
 *      or `AI_LECTURER_WHISPER_CUDA_BIN`). If missing → return CPU fallback.
 *   2. Spawn `nvidia-smi -L`. If exit 0 → CUDA is available. Otherwise → CPU.
 * Memoised for the process lifetime — the answer cannot change without a
 * restart. Any unexpected failure (e.g. spawn throws synchronously) logs
 * once at info level and returns the CPU path. The CPU `binaryPath`
 * returned is the first existing whisper-cli CPU candidate so callers
 * don't have to repeat the lookup; if none exist it falls back to the
 * first declared candidate so `SttNotInstalledError` still has a stable
 * target to mention.
 */
export async function whisperCudaAvailable(): Promise<{
  available: boolean;
  binaryPath: string;
}> {
  if (whisperCudaProbeResult !== null) return whisperCudaProbeResult;
  const exists = depsOverride?.binaryExists ?? defaultBinaryExists;
  const cudaBin = whisperCudaBinaryPath();
  const cpuFallback =
    (await pickWhisperBinary(exists)) ?? whisperBinaryCandidates()[0];
  try {
    const cudaPresent = await exists(cudaBin);
    if (!cudaPresent) {
      whisperCudaProbeResult = { available: false, binaryPath: cpuFallback };
      return whisperCudaProbeResult;
    }
    const gpuOk = await probeNvidiaSmi();
    whisperCudaProbeResult = gpuOk
      ? { available: true, binaryPath: cudaBin }
      : { available: false, binaryPath: cpuFallback };
    return whisperCudaProbeResult;
  } catch (err) {
    logWhisperCudaProbeFailure((err as Error).message);
    whisperCudaProbeResult = { available: false, binaryPath: cpuFallback };
    return whisperCudaProbeResult;
  }
}

/**
 * Resolve which whisper-cli binary to spawn, honouring `AI_LECTURER_STT_DEVICE`.
 * Returns `null` if no usable binary was found — callers translate that into
 * `SttNotInstalledError`.
 */
async function resolveWhisperBinary(): Promise<string | null> {
  const exists = depsOverride?.binaryExists ?? defaultBinaryExists;
  const mode = sttDeviceMode();
  if (mode === 'cuda') {
    const cudaBin = whisperCudaBinaryPath();
    return (await exists(cudaBin)) ? cudaBin : null;
  }
  if (mode === 'cpu') {
    return pickWhisperBinary(exists);
  }
  const probe = await whisperCudaAvailable();
  if (probe.available) return probe.binaryPath;
  // probe.binaryPath is the chosen CPU fallback (first existing CPU
  // candidate, or the first declared candidate when none exist). Verify it
  // actually exists before handing it back.
  return (await exists(probe.binaryPath)) ? probe.binaryPath : null;
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
  const modelCheck = depsOverride?.modelExists ?? defaultModelExists;
  const binaryPath = await resolveWhisperBinary();
  const modelPath = whisperModelPath();
  if (!binaryPath || !(await modelCheck(modelPath))) {
    // Pick the most informative "what was missing" target for the error
    // message: when device=cuda we name the CUDA binary, otherwise the
    // first CPU candidate.
    const intended =
      sttDeviceMode() === 'cuda'
        ? whisperCudaBinaryPath()
        : whisperBinaryCandidates()[0];
    throw new SttNotInstalledError(binaryPath ?? intended, modelPath);
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
