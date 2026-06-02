// US-196: server-only probe for the local Jupyter kernel runtime.
//
// The Code/Sandbox widgets (Option-2 epic) need to execute *real* PyTorch /
// TensorFlow / OpenCV instead of Pyodide-in-the-browser. That requires a
// one-time provisioned Python venv on the (persistent) ralph host, created by
// `scripts/setup-kernel.sh`. This module is the server-side counterpart: it
// reports whether that runtime exists and which compute device it will pick
// (cpu / cuda), and surfaces a typed `KernelRuntimeNotInstalledError` when the
// runtime is missing — mirroring `SttNotInstalledError` in
// `src/lib/server/stt.ts`.
//
// Device selection mirrors the whisper.cpp CUDA pattern (US-168,
// `whisperCudaAvailable()`):
//   - `AI_LECTURER_KERNEL_DEVICE=auto` (default) → call `kernelCudaAvailable()`
//     which checks for the CUDA marker written by `scripts/setup-kernel-cuda.sh`
//     and shells out to `nvidia-smi`. If both succeed, `cuda` is chosen;
//     otherwise it falls back to `cpu`. The probe result is memoised for the
//     process lifetime; failures are silent (CPU fallback) and logged once.
//   - `AI_LECTURER_KERNEL_DEVICE=cuda` → force `cuda` without consulting the
//     probe (parity with the STT force path).
//   - `AI_LECTURER_KERNEL_DEVICE=cpu` → never consult the probe; use `cpu`.
//
// The venv location defaults to `~/.ai-lecturer/py-runtime` and can be
// overridden with `AI_LECTURER_PY_RUNTIME` (e.g. when the runtime is installed
// on a different volume).

import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { aiLecturerHome } from '@/lib/server/tts-cache';

export type KernelDeviceMode = 'cuda' | 'cpu' | 'auto';
export type KernelDevice = 'cuda' | 'cpu';

export class KernelRuntimeNotInstalledError extends Error {
  constructor(public readonly runtimeDir: string, public readonly pythonPath: string) {
    super(
      `Jupyter kernel runtime not installed: missing ${pythonPath} under ${runtimeDir}. ` +
        `Run scripts/setup-kernel.sh first.`,
    );
    this.name = 'KernelRuntimeNotInstalledError';
  }
}

/** Resolve the managed venv directory. Defaults to
 *  `~/.ai-lecturer/py-runtime`; override with `AI_LECTURER_PY_RUNTIME`. */
export function kernelRuntimeDir(): string {
  const override = process.env.AI_LECTURER_PY_RUNTIME;
  if (override && override.length > 0) return override;
  return path.join(aiLecturerHome(), 'py-runtime');
}

/** Path to the venv's Python interpreter. POSIX venvs put it at `bin/python`;
 *  Windows venvs at `Scripts/python.exe`. */
export function kernelPythonPath(): string {
  const dir = kernelRuntimeDir();
  if (process.platform === 'win32') {
    return path.join(dir, 'Scripts', 'python.exe');
  }
  return path.join(dir, 'bin', 'python');
}

/** Marker file written by `scripts/setup-kernel-cuda.sh` after it reinstalls
 *  torch/tensorflow with CUDA wheels. Its presence is what distinguishes a
 *  CUDA-capable runtime from the default CPU baseline (both live in the same
 *  venv, unlike whisper.cpp which uses two separate build dirs). */
export function kernelCudaMarkerPath(): string {
  return path.join(kernelRuntimeDir(), '.cuda-enabled');
}

/** Read & validate `AI_LECTURER_KERNEL_DEVICE`. Unknown values fall back to
 *  `auto`. */
export function kernelDeviceMode(): KernelDeviceMode {
  const raw = (process.env.AI_LECTURER_KERNEL_DEVICE ?? 'auto').toLowerCase();
  if (raw === 'cuda' || raw === 'cpu' || raw === 'auto') return raw;
  return 'auto';
}

export interface KernelRuntimeDeps {
  spawn?: typeof defaultSpawn;
  /** Override venv-python existence check for tests. Default: fs.access X_OK. */
  pythonExists?: (pythonPath: string) => Promise<boolean>;
  /** Override CUDA-marker presence check for tests. Default: fs.access R_OK. */
  cudaMarkerExists?: (markerPath: string) => Promise<boolean>;
}

let depsOverride: KernelRuntimeDeps | null = null;
let kernelCudaProbeResult: { available: boolean } | null = null;
let kernelCudaProbeLogged = false;

/** Test-only: replace the spawn / file-existence deps and reset the memoised
 *  CUDA probe so each test starts from a clean slate. */
export function __setKernelRuntimeDepsForTesting(deps: KernelRuntimeDeps | null): void {
  depsOverride = deps;
  kernelCudaProbeResult = null;
  kernelCudaProbeLogged = false;
}

function logKernelCudaProbeFailure(reason: string): void {
  if (kernelCudaProbeLogged) return;
  kernelCudaProbeLogged = true;
  console.info(`Kernel CUDA probe failed, using CPU: ${reason}`);
}

async function defaultPythonExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function defaultCudaMarkerExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn `nvidia-smi -L` and resolve true iff it exits 0. Any spawn error
 * (ENOENT when nvidia-smi isn't on PATH, etc.) resolves false. Cheap "is there
 * an NVIDIA driver wired up?" check — same shape as `probeNvidiaSmi` in
 * `stt.ts`.
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
 * Probe whether the runtime's CUDA build is usable. Order:
 *   1. Check the `.cuda-enabled` marker (written by setup-kernel-cuda.sh). If
 *      absent → CPU.
 *   2. Spawn `nvidia-smi -L`. If exit 0 → CUDA available; otherwise → CPU.
 * Memoised for the process lifetime — the answer cannot change without a
 * re-provision + restart. Unexpected failures log once at info level and
 * return CPU. Mirrors `whisperCudaAvailable()`.
 */
export async function kernelCudaAvailable(): Promise<{ available: boolean }> {
  if (kernelCudaProbeResult !== null) return kernelCudaProbeResult;
  const markerExists = depsOverride?.cudaMarkerExists ?? defaultCudaMarkerExists;
  try {
    const cudaPresent = await markerExists(kernelCudaMarkerPath());
    if (!cudaPresent) {
      kernelCudaProbeResult = { available: false };
      return kernelCudaProbeResult;
    }
    const gpuOk = await probeNvidiaSmi();
    kernelCudaProbeResult = { available: gpuOk };
    return kernelCudaProbeResult;
  } catch (err) {
    logKernelCudaProbeFailure((err as Error).message);
    kernelCudaProbeResult = { available: false };
    return kernelCudaProbeResult;
  }
}

/**
 * Resolve which compute device the runtime will use, honouring
 * `AI_LECTURER_KERNEL_DEVICE`. `cpu`/`cuda` are forced without probing;
 * `auto` consults `kernelCudaAvailable()`.
 */
export async function resolveKernelDevice(): Promise<KernelDevice> {
  const mode = kernelDeviceMode();
  if (mode === 'cpu') return 'cpu';
  if (mode === 'cuda') return 'cuda';
  const probe = await kernelCudaAvailable();
  return probe.available ? 'cuda' : 'cpu';
}

export interface KernelRuntimeStatus {
  installed: boolean;
  device: KernelDevice;
  runtimeDir: string;
  pythonPath: string;
}

/**
 * Report runtime status without throwing: whether the venv python exists and
 * which device it would select. The `device` field is meaningful regardless of
 * `installed` (it reflects the configured/auto-detected preference).
 */
export async function probeKernelRuntime(): Promise<KernelRuntimeStatus> {
  const pythonExists = depsOverride?.pythonExists ?? defaultPythonExists;
  const runtimeDir = kernelRuntimeDir();
  const pythonPath = kernelPythonPath();
  const installed = await pythonExists(pythonPath);
  const device = await resolveKernelDevice();
  return { installed, device, runtimeDir, pythonPath };
}

/**
 * Like `probeKernelRuntime()` but throws `KernelRuntimeNotInstalledError` when
 * the venv is missing — for callers (Code/Sandbox execution endpoints) that
 * cannot proceed without a real runtime. Mirrors how `runStt` raises
 * `SttNotInstalledError`.
 */
export async function requireKernelRuntime(): Promise<KernelRuntimeStatus> {
  const status = await probeKernelRuntime();
  if (!status.installed) {
    throw new KernelRuntimeNotInstalledError(status.runtimeDir, status.pythonPath);
  }
  return status;
}
