'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type {
  RunResult,
  RunWithTestsResult,
  TestResult,
  PyodideTestSpec,
  PyodideInputFile,
} from '@/lib/pyodide/client';

import { KERNEL_TEST_RESULT_MARKER, buildTestHarness } from './kernelPython';

/**
 * Client hook mirroring `usePyodide` (src/lib/pyodide/client.ts) but backed by
 * the server-side IPython kernel routes from US-198. The surface — `status`,
 * `run`, `runWithTests`, `stop`, `reset` — and the returned `RunResult` /
 * `RunWithTestsResult` shapes are intentionally identical so Code/Sandbox can
 * swap runtimes with a near drop-in change (US-199).
 *
 * This module is the pure *client* API: it does NOT touch the widgets yet.
 */

export type KernelStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Mirror of `PyodideStopReason` so widget catch-blocks port 1:1. */
export type KernelStopReason = 'user' | 'timeout';

/**
 * Default server-enforced execution timeout. Parity with
 * `PYODIDE_EXECUTION_TIMEOUT_MS` (US-039) and the 30s server timeout in US-198.
 */
export const KERNEL_EXECUTION_TIMEOUT_MS = 30_000;

// Re-export the shape types so kernel consumers import them from one place
// while the canonical definitions stay in the pyodide client.
export type {
  RunResult,
  RunWithTestsResult,
  TestResult,
  PyodideTestSpec,
  PyodideInputFile,
};

/**
 * Rejection thrown by `run` / `runWithTests` when execution is cut short —
 * either by the user calling `stop` (`reason === 'user'`, mapped onto the
 * kernel `interrupt`) or by the 30s execution timeout (`reason === 'timeout'`).
 * Structurally mirrors `PyodideStopError` so existing widget catch-blocks port
 * over with only a class-name swap.
 */
export class KernelStopError extends Error {
  reason: KernelStopReason;
  constructor(reason: KernelStopReason) {
    super(
      reason === 'timeout'
        ? 'Kernel execution timed out after 30s'
        : 'Kernel execution stopped',
    );
    this.name = 'KernelStopError';
    this.reason = reason;
  }
}

/** Typed HTTP error so a missing runtime / server failure is renderable. */
export class KernelRequestError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'KernelRequestError';
    this.status = status;
    this.code = code;
  }
}

/** Whether a request error means the US-196 runtime isn't installed. */
export function isRuntimeNotInstalled(err: unknown): boolean {
  return (
    err instanceof KernelRequestError &&
    (err.status === 503 || err.code === 'kernel_runtime_not_installed')
  );
}

/** Session identity: one kernel per (course, lesson) keyed per widget section. */
export interface KernelSessionKey {
  courseSlug: string;
  lessonSlug: string;
  sectionId: string;
}

export type KernelControlAction = 'interrupt' | 'restart' | 'reset';

export interface KernelRunRequest {
  session: KernelSessionKey;
  code: string;
  requiresPackages?: string[];
  inputs?: PyodideInputFile[];
}

/**
 * NDJSON events streamed by `POST /api/code/run` (US-198): interim
 * `stream` / `display` / `result` events as the cell runs, then a single
 * `final` aggregated event mirroring the `RunResult` field names.
 */
export type KernelRunEvent =
  | { type: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | { type: 'display'; png: string }
  | { type: 'result'; png?: string; text?: string }
  | {
      type: 'final';
      stdout: string;
      stderr: string;
      traceback?: string;
      errorType?: string;
      errorMessage?: string;
      images?: string[];
      status?: 'ok' | 'timeout' | 'error';
    };

/** Pluggable transport so unit tests can mock the HTTP layer (US-199). */
export interface KernelTransport {
  run(
    req: KernelRunRequest,
    onEvent: (event: KernelRunEvent) => void,
    signal: AbortSignal,
  ): Promise<void>;
  control(action: KernelControlAction, session: KernelSessionKey): Promise<void>;
}

export interface KernelStreamChunk {
  stdout: string;
  stderr: string;
}

export interface KernelRunOptions {
  requiresPackages?: string[];
  inputs?: PyodideInputFile[];
  /** Incremental stdout/stderr as it streams, where the UI supports it. */
  onStream?: (chunk: KernelStreamChunk) => void;
}

export interface KernelRunWithTestsOptions extends KernelRunOptions {
  /** Capture the most-recent matplotlib figure as `png` (parity w/ Sandbox). */
  captureLiveImage?: boolean;
}

export interface UseKernelReturn {
  status: KernelStatus;
  run: (
    code: string,
    requiresPackages?: string[],
    options?: KernelRunOptions,
  ) => Promise<RunResult>;
  runWithTests: (
    code: string,
    tests: PyodideTestSpec[],
    options?: KernelRunWithTestsOptions,
  ) => Promise<RunWithTestsResult>;
  /** Interrupt the in-flight execution (mapped onto the kernel SIGINT). */
  stop: (reason?: KernelStopReason) => void;
  /** Clear the session namespace; defaults to this hook's session. */
  reset: (sessionKey?: KernelSessionKey) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Event aggregation (pure — directly unit-tested)
// ---------------------------------------------------------------------------

export interface AggregatedRun {
  stdout: string;
  stderr: string;
  traceback?: string;
  errorType?: string;
  errorMessage?: string;
  images: string[];
  status: 'ok' | 'timeout' | 'error';
}

/** Fold the NDJSON event stream into the stable run shape. */
export function aggregateRunEvents(events: KernelRunEvent[]): AggregatedRun {
  let streamedStdout = '';
  let streamedStderr = '';
  const images: string[] = [];
  let final: Extract<KernelRunEvent, { type: 'final' }> | null = null;

  for (const event of events) {
    switch (event.type) {
      case 'stream':
        if (event.name === 'stdout') streamedStdout += event.text;
        else streamedStderr += event.text;
        break;
      case 'display':
        if (event.png) images.push(event.png);
        break;
      case 'result':
        if (event.png) images.push(event.png);
        break;
      case 'final':
        final = event;
        break;
    }
  }

  const result: AggregatedRun = {
    // `final` carries the server-aggregated buffers; fall back to what we
    // accumulated from interim stream events.
    stdout: final?.stdout ?? streamedStdout,
    stderr: final?.stderr ?? streamedStderr,
    images: final?.images && final.images.length > 0 ? final.images : images,
    status: final?.status ?? 'ok',
  };
  if (final?.traceback) {
    result.traceback = final.traceback;
    if (final.errorType) result.errorType = final.errorType;
    if (final.errorMessage) result.errorMessage = final.errorMessage;
  }
  return result;
}

function toRunResult(agg: AggregatedRun): RunResult {
  const out: RunResult = { stdout: agg.stdout, stderr: agg.stderr };
  if (agg.traceback) {
    out.traceback = agg.traceback;
    if (agg.errorType) out.errorType = agg.errorType;
    if (agg.errorMessage) out.errorMessage = agg.errorMessage;
  }
  return out;
}

interface ParsedHarness {
  testResults: TestResult[];
  png?: string;
}

/**
 * Pull the harness sentinel line out of stdout, returning the cleaned stdout
 * (user output only) and the decoded `{ testResults, png }` payload.
 */
export function extractHarnessPayload(stdout: string): {
  stdout: string;
  payload: ParsedHarness | null;
} {
  const idx = stdout.indexOf(KERNEL_TEST_RESULT_MARKER);
  if (idx < 0) return { stdout, payload: null };

  // Bounds of the marker's own line so we can excise it losslessly (the
  // surrounding user newlines stay intact, unlike a split/join round-trip).
  const lineStart = stdout.lastIndexOf('\n', idx - 1) + 1;
  let lineEnd = stdout.indexOf('\n', idx);
  if (lineEnd < 0) lineEnd = stdout.length;

  const b64 = stdout.slice(idx + KERNEL_TEST_RESULT_MARKER.length, lineEnd).trim();
  let payload: ParsedHarness | null = null;
  try {
    const obj = JSON.parse(decodeBase64Utf8(b64)) as {
      testResults?: TestResult[];
      png?: string | null;
    };
    payload = {
      testResults: Array.isArray(obj.testResults) ? obj.testResults : [],
      png: obj.png ?? undefined,
    };
  } catch {
    payload = null;
  }

  // Keep any prefix that shared the marker's line, drop the marker line plus
  // its trailing newline.
  const prefix = stdout.slice(lineStart, idx);
  const after = lineEnd < stdout.length ? stdout.slice(lineEnd + 1) : '';
  const cleaned = stdout.slice(0, lineStart) + prefix + after;
  return { stdout: cleaned, payload };
}

// ---------------------------------------------------------------------------
// Core engine (framework-free so it can be unit-tested without React)
// ---------------------------------------------------------------------------

export class KernelClient {
  private session: KernelSessionKey;
  private transport: KernelTransport;
  private statusValue: KernelStatus = 'idle';
  private listeners = new Set<() => void>();
  private currentAbort: AbortController | null = null;
  private abortReason: KernelStopReason | null = null;

  constructor(session: KernelSessionKey, transport: KernelTransport) {
    this.session = session;
    this.transport = transport;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): KernelStatus => this.statusValue;

  private setStatus(value: KernelStatus) {
    if (this.statusValue === value) return;
    this.statusValue = value;
    this.listeners.forEach((l) => l());
  }

  private async execute(
    code: string,
    requiresPackages: string[] | undefined,
    options: KernelRunOptions | undefined,
  ): Promise<AggregatedRun> {
    if (this.statusValue !== 'ready') this.setStatus('loading');

    const abort = new AbortController();
    this.currentAbort = abort;
    this.abortReason = null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, KERNEL_EXECUTION_TIMEOUT_MS);

    const events: KernelRunEvent[] = [];
    let acc = { stdout: '', stderr: '' };

    try {
      await this.transport.run(
        {
          session: this.session,
          code,
          requiresPackages,
          inputs: options?.inputs,
        },
        (event) => {
          events.push(event);
          if (this.statusValue !== 'ready') this.setStatus('ready');
          if (options?.onStream && event.type === 'stream') {
            if (event.name === 'stdout') acc = { ...acc, stdout: acc.stdout + event.text };
            else acc = { ...acc, stderr: acc.stderr + event.text };
            options.onStream({ ...acc });
          }
        },
        abort.signal,
      );
    } catch (err) {
      if (abort.signal.aborted) {
        // Kernel stays alive after an interrupt/timeout.
        this.setStatus('ready');
        throw new KernelStopError(timedOut ? 'timeout' : this.abortReason ?? 'user');
      }
      if (isRuntimeNotInstalled(err)) this.setStatus('error');
      throw err;
    } finally {
      clearTimeout(timer);
      this.currentAbort = null;
    }

    this.setStatus('ready');
    const agg = aggregateRunEvents(events);
    // Server-side timeout (no client abort) mirrors the user/timeout stop UX.
    if (agg.status === 'timeout') throw new KernelStopError('timeout');
    return agg;
  }

  run = async (
    code: string,
    requiresPackages?: string[],
    options?: KernelRunOptions,
  ): Promise<RunResult> => {
    const agg = await this.execute(code, requiresPackages, options);
    return toRunResult(agg);
  };

  runWithTests = async (
    code: string,
    tests: PyodideTestSpec[],
    options?: KernelRunWithTestsOptions,
  ): Promise<RunWithTestsResult> => {
    const harness = buildTestHarness(
      code,
      tests ?? [],
      options?.captureLiveImage,
    );
    const agg = await this.execute(harness, options?.requiresPackages, options);
    const { stdout, payload } = extractHarnessPayload(agg.stdout);

    const result: RunWithTestsResult = {
      stdout,
      stderr: agg.stderr,
      testResults: payload?.testResults ?? [],
    };
    if (agg.traceback) {
      result.traceback = agg.traceback;
      if (agg.errorType) result.errorType = agg.errorType;
      if (agg.errorMessage) result.errorMessage = agg.errorMessage;
    }
    const pngB64 = payload?.png;
    if (pngB64) result.png = base64ToBytes(pngB64);
    return result;
  };

  /** Map `stop` onto the kernel interrupt and abort the in-flight request. */
  stop = (reason: KernelStopReason = 'user'): void => {
    this.abortReason = reason;
    const abort = this.currentAbort;
    if (abort) abort.abort();
    void this.transport.control('interrupt', this.session).catch(() => {
      // Best-effort: the abort above already unblocks the caller.
    });
  };

  reset = async (sessionKey?: KernelSessionKey): Promise<void> => {
    await this.transport.control('reset', sessionKey ?? this.session);
  };
}

// ---------------------------------------------------------------------------
// Default fetch transport
// ---------------------------------------------------------------------------

async function parseError(res: Response): Promise<KernelRequestError> {
  let message = `Kernel request failed (${res.status})`;
  let code: string | undefined;
  try {
    const body = (await res.json()) as {
      error?: string;
      message?: string;
      code?: string;
    };
    message = body.error ?? body.message ?? message;
    code = body.code;
  } catch {
    // Non-JSON error body — keep the status-derived message.
  }
  return new KernelRequestError(res.status, message, code);
}

export const fetchKernelTransport: KernelTransport = {
  async run(req, onEvent, signal) {
    const res = await fetch('/api/code/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...req.session,
        code: req.code,
        requiresPackages: req.requiresPackages,
        inputs: req.inputs,
      }),
      signal,
    });
    if (!res.ok) throw await parseError(res);

    if (!res.body) {
      // Environments without a streaming body: parse the whole response.
      const text = await res.text();
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) onEvent(JSON.parse(trimmed) as KernelRunEvent);
      }
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) onEvent(JSON.parse(line) as KernelRunEvent);
      }
    }
    buf += decoder.decode();
    const last = buf.trim();
    if (last) onEvent(JSON.parse(last) as KernelRunEvent);
  },
  async control(action, session) {
    const path =
      action === 'interrupt'
        ? '/api/code/interrupt'
        : action === 'restart'
          ? '/api/code/restart'
          : '/api/code/reset';
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(session),
    });
    if (!res.ok) throw await parseError(res);
  },
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useKernel(
  session: KernelSessionKey,
  transport: KernelTransport = fetchKernelTransport,
): UseKernelReturn {
  const { courseSlug, lessonSlug, sectionId } = session;
  const client = useMemo(
    () =>
      new KernelClient({ courseSlug, lessonSlug, sectionId }, transport),
    [courseSlug, lessonSlug, sectionId, transport],
  );

  const status = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    () => 'idle' as KernelStatus,
  );

  const run = useCallback(
    (code: string, requiresPackages?: string[], options?: KernelRunOptions) =>
      client.run(code, requiresPackages, options),
    [client],
  );
  const runWithTests = useCallback(
    (
      code: string,
      tests: PyodideTestSpec[],
      options?: KernelRunWithTestsOptions,
    ) => client.runWithTests(code, tests, options),
    [client],
  );
  const stop = useCallback(
    (reason?: KernelStopReason) => client.stop(reason),
    [client],
  );
  const reset = useCallback(
    (sessionKey?: KernelSessionKey) => client.reset(sessionKey),
    [client],
  );

  return { status, run, runWithTests, stop, reset };
}

// ---------------------------------------------------------------------------
// base64 helpers (browser + node test envs)
// ---------------------------------------------------------------------------

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeBase64Utf8(b64: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf-8');
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
