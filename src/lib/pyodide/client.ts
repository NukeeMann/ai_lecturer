'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type PyodideStatus = 'idle' | 'loading' | 'ready' | 'error';

export type PyodideStopReason = 'user' | 'timeout';

/** Default execution timeout for `run` / `runWithTests` (US-039). */
export const PYODIDE_EXECUTION_TIMEOUT_MS = 30_000;

/**
 * Rejection thrown by `run` / `runWithTests` when the worker is terminated
 * mid-execution — either by the user clicking Stop (`reason === 'user'`) or
 * by the 30s execution timeout (`reason === 'timeout'`).
 */
export class PyodideStopError extends Error {
  reason: PyodideStopReason;
  constructor(reason: PyodideStopReason) {
    super(
      reason === 'timeout'
        ? 'Pyodide execution timed out after 30s'
        : 'Pyodide execution stopped',
    );
    this.name = 'PyodideStopError';
    this.reason = reason;
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
  traceback?: string;
}

export interface TestResult {
  name: string;
  passed: boolean;
  traceback?: string | null;
  assertionDetail?: string | null;
}

export interface RunWithTestsResult extends RunResult {
  testResults: TestResult[];
}

export interface GaussFilterResult {
  png: Uint8Array;
}

export interface ResetNamespaceResult {
  lessonSlug: string | null;
}

export type ParamValue = number | string | boolean;

export interface RunWithPlotParamRequest {
  setupCode: string;
  renderCode: string;
  params: Record<string, ParamValue>;
  outputType: 'plot' | 'value' | 'both';
}

export interface RunWithPlotParamResult extends RunResult {
  png?: Uint8Array;
  value?: string;
}

export interface PyodideTestSpec {
  name: string;
  body: string;
}

interface PendingHandler {
  resolve: (
    value:
      | RunResult
      | RunWithTestsResult
      | GaussFilterResult
      | ResetNamespaceResult
      | RunWithPlotParamResult,
  ) => void;
  reject: (err: unknown) => void;
}

interface WorkerSingleton {
  worker: Worker;
  pending: Map<string, PendingHandler>;
  readyPromise: Promise<void>;
}

// Listeners and current status are hoisted out of the singleton so they
// survive worker recreation after a stop/timeout (US-039).
const statusListeners = new Set<(s: PyodideStatus) => void>();
const restartListeners = new Set<(reason: PyodideStopReason) => void>();
let currentStatus: PyodideStatus = 'idle';
let singleton: WorkerSingleton | null = null;
let nextId = 0;

/**
 * Subscribe to worker-restart events (US-039). Listener fires AFTER pending
 * promises have been rejected and a fresh worker is being booted, so a
 * subscriber can react regardless of whether *its* request was the one
 * rejected (e.g. multiple Code widgets sharing the worker).
 */
export function subscribePyodideRestart(
  cb: (reason: PyodideStopReason) => void,
): () => void {
  restartListeners.add(cb);
  return () => {
    restartListeners.delete(cb);
  };
}


function setStatus(value: PyodideStatus) {
  if (currentStatus === value) return;
  currentStatus = value;
  statusListeners.forEach((l) => l(value));
}

function getOrCreateWorker(): WorkerSingleton {
  if (singleton) return singleton;
  if (typeof window === 'undefined') {
    throw new Error('Pyodide worker can only be created in the browser');
  }

  const worker = new Worker(new URL('./worker.ts', import.meta.url));
  let resolveReady!: () => void;
  let rejectReady!: (err: unknown) => void;
  const readyPromise = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  const obj: WorkerSingleton = {
    worker,
    pending: new Map(),
    readyPromise,
  };

  setStatus('loading');

  worker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as
      | { type: 'ready' }
      | { type: 'error'; error: string }
      | ({ id: string } & Partial<RunResult> &
          Partial<RunWithTestsResult> &
          Partial<GaussFilterResult> &
          Partial<ResetNamespaceResult>);

    if ('type' in data && data.type === 'ready') {
      // Ignore late 'ready' messages from a worker we already replaced.
      if (singleton !== obj) return;
      setStatus('ready');
      resolveReady();
      return;
    }
    if ('type' in data && data.type === 'error') {
      if (singleton !== obj) return;
      setStatus('error');
      rejectReady(new Error(data.error));
      obj.pending.forEach((h) => h.reject(new Error(data.error)));
      obj.pending.clear();
      return;
    }
    if ('id' in data) {
      const handler = obj.pending.get(data.id);
      if (handler) {
        obj.pending.delete(data.id);
        handler.resolve(data as unknown as RunResult);
      }
    }
  });

  worker.addEventListener('error', (event: ErrorEvent) => {
    if (singleton !== obj) return;
    const err = event.error ?? new Error(event.message || 'Pyodide worker error');
    setStatus('error');
    rejectReady(err);
    obj.pending.forEach((h) => h.reject(err));
    obj.pending.clear();
  });

  singleton = obj;
  return obj;
}

/**
 * Terminate the active worker and immediately spawn a fresh one. All pending
 * `run` / `runWithTests` / `gaussFilter` / `resetNamespace` promises are
 * rejected with `PyodideStopError(reason)`. The new worker re-installs
 * pyodide + numpy + scipy on boot, and the lesson namespace + matplotlib /
 * Pillow lazy-install flags are gone with the old worker.
 */
export function stopPyodide(reason: PyodideStopReason = 'user'): void {
  if (!singleton) return;
  const old = singleton;
  singleton = null;
  setStatus('loading');
  try {
    old.worker.terminate();
  } catch {
    // terminate() never throws in spec, but guard anyway.
  }
  old.pending.forEach((h) => h.reject(new PyodideStopError(reason)));
  old.pending.clear();
  // Spawn a fresh worker so it boots toward 'ready' without waiting for the
  // next subscribe.
  getOrCreateWorker();
  restartListeners.forEach((cb) => cb(reason));
}

type WorkerPayload =
  | { type: 'run'; code: string }
  | { type: 'runWithTests'; code: string; tests: PyodideTestSpec[] }
  | {
      type: 'gaussFilter';
      pixels: Uint8Array;
      width: number;
      height: number;
      sigma: number;
    }
  | { type: 'resetNamespace'; lessonSlug: string }
  | ({ type: 'runWithPlotParam' } & RunWithPlotParamRequest);

interface CallOptions {
  /** When set, auto-stops the worker (and rejects this promise) after N ms. */
  timeoutMs?: number;
}

function callWorker<T>(
  payload: WorkerPayload,
  transfer?: Transferable[],
  options?: CallOptions,
): Promise<T> {
  const s = getOrCreateWorker();
  const id = `req-${++nextId}`;
  return new Promise<T>((resolve, reject) => {
    let timer: number | null = null;
    if (options?.timeoutMs && typeof window !== 'undefined') {
      timer = window.setTimeout(() => {
        // stopPyodide rejects all pending (including this one) with
        // PyodideStopError('timeout').
        stopPyodide('timeout');
      }, options.timeoutMs);
    }
    const clearTimer = () => {
      if (timer !== null && typeof window !== 'undefined') {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    s.pending.set(id, {
      resolve: (v) => {
        clearTimer();
        resolve(v as T);
      },
      reject: (err) => {
        clearTimer();
        reject(err);
      },
    });
    s.readyPromise.then(
      () => {
        // Worker may have been replaced between scheduling and ready.
        // The pending handler is keyed in the OLD singleton, so just bail.
        if (singleton !== s) return;
        if (transfer && transfer.length > 0) {
          s.worker.postMessage({ id, ...payload }, transfer);
        } else {
          s.worker.postMessage({ id, ...payload });
        }
      },
      (err) => {
        s.pending.delete(id);
        clearTimer();
        reject(err);
      },
    );
  });
}

export interface UsePyodideReturn {
  status: PyodideStatus;
  run: (code: string) => Promise<RunResult>;
  runWithTests: (code: string, tests: PyodideTestSpec[]) => Promise<RunWithTestsResult>;
  gaussFilter: (
    pixels: Uint8Array,
    width: number,
    height: number,
    sigma: number,
  ) => Promise<GaussFilterResult>;
  runWithPlotParam: (
    request: RunWithPlotParamRequest,
  ) => Promise<RunWithPlotParamResult>;
  resetNamespace: (lessonSlug: string) => Promise<ResetNamespaceResult>;
  /** Terminate the current execution + restart the worker (US-039). */
  stop: (reason?: PyodideStopReason) => void;
}

function subscribeStatus(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  getOrCreateWorker();
  statusListeners.add(callback);
  // Notify once on subscription so the consumer pulls the current snapshot
  // (covers the case where the worker hit 'ready' before this hook mounted).
  callback();
  return () => {
    statusListeners.delete(callback);
  };
}

function getStatusSnapshot(): PyodideStatus {
  return currentStatus;
}

function getServerStatusSnapshot(): PyodideStatus {
  return 'idle';
}

export function usePyodide(): UsePyodideReturn {
  const status = useSyncExternalStore(
    subscribeStatus,
    getStatusSnapshot,
    getServerStatusSnapshot,
  );

  const run = useCallback(
    (code: string) =>
      callWorker<RunResult>({ type: 'run', code }, undefined, {
        timeoutMs: PYODIDE_EXECUTION_TIMEOUT_MS,
      }),
    [],
  );

  const runWithTests = useCallback(
    (code: string, tests: PyodideTestSpec[]) =>
      callWorker<RunWithTestsResult>(
        { type: 'runWithTests', code, tests },
        undefined,
        { timeoutMs: PYODIDE_EXECUTION_TIMEOUT_MS },
      ),
    [],
  );

  const gaussFilter = useCallback(
    (pixels: Uint8Array, width: number, height: number, sigma: number) =>
      callWorker<GaussFilterResult>(
        { type: 'gaussFilter', pixels, width, height, sigma },
        [pixels.buffer],
      ),
    [],
  );

  const resetNamespace = useCallback(
    (lessonSlug: string) =>
      callWorker<ResetNamespaceResult>({ type: 'resetNamespace', lessonSlug }),
    [],
  );

  const runWithPlotParam = useCallback(
    (request: RunWithPlotParamRequest) =>
      callWorker<RunWithPlotParamResult>(
        { type: 'runWithPlotParam', ...request },
        undefined,
        { timeoutMs: PYODIDE_EXECUTION_TIMEOUT_MS },
      ),
    [],
  );

  const stop = useCallback((reason: PyodideStopReason = 'user') => {
    stopPyodide(reason);
  }, []);

  return {
    status,
    run,
    runWithTests,
    gaussFilter,
    runWithPlotParam,
    resetNamespace,
    stop,
  };
}

/**
 * Test-only helpers. Not part of the public surface — exported so unit tests
 * can drive the singleton without rendering React.
 */
export const __test = {
  ensureWorker: () => getOrCreateWorker(),
  call: <T,>(payload: WorkerPayload, options?: CallOptions): Promise<T> =>
    callWorker<T>(payload, undefined, options),
  getStatus: () => currentStatus,
  reset: () => {
    if (singleton) {
      try {
        singleton.worker.terminate();
      } catch {
        /* noop */
      }
      singleton = null;
    }
    currentStatus = 'idle';
    statusListeners.clear();
    restartListeners.clear();
  },
};
