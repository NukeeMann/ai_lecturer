'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type PyodideStatus = 'idle' | 'loading' | 'ready' | 'error';

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

export interface PyodideTestSpec {
  name: string;
  body: string;
}

interface PendingHandler {
  resolve: (value: RunResult | RunWithTestsResult | GaussFilterResult) => void;
  reject: (err: unknown) => void;
}

interface WorkerSingleton {
  worker: Worker;
  status: PyodideStatus;
  pending: Map<string, PendingHandler>;
  readyPromise: Promise<void>;
  statusListeners: Set<(s: PyodideStatus) => void>;
}

let singleton: WorkerSingleton | null = null;
let nextId = 0;

function setStatus(s: WorkerSingleton, value: PyodideStatus) {
  s.status = value;
  s.statusListeners.forEach((l) => l(value));
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
    status: 'loading',
    pending: new Map(),
    readyPromise,
    statusListeners: new Set(),
  };

  worker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as
      | { type: 'ready' }
      | { type: 'error'; error: string }
      | ({ id: string } & Partial<RunResult> &
          Partial<RunWithTestsResult> &
          Partial<GaussFilterResult>);

    if ('type' in data && data.type === 'ready') {
      setStatus(obj, 'ready');
      resolveReady();
      return;
    }
    if ('type' in data && data.type === 'error') {
      setStatus(obj, 'error');
      rejectReady(new Error(data.error));
      // Reject any pending requests too.
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
    const err = event.error ?? new Error(event.message || 'Pyodide worker error');
    setStatus(obj, 'error');
    rejectReady(err);
    obj.pending.forEach((h) => h.reject(err));
    obj.pending.clear();
  });

  singleton = obj;
  return obj;
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
    };

function callWorker<T>(payload: WorkerPayload, transfer?: Transferable[]): Promise<T> {
  const s = getOrCreateWorker();
  const id = `req-${++nextId}`;
  return new Promise<T>((resolve, reject) => {
    s.pending.set(id, {
      resolve: resolve as PendingHandler['resolve'],
      reject,
    });
    s.readyPromise.then(
      () => {
        if (transfer && transfer.length > 0) {
          s.worker.postMessage({ id, ...payload }, transfer);
        } else {
          s.worker.postMessage({ id, ...payload });
        }
      },
      (err) => {
        s.pending.delete(id);
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
}

function subscribeStatus(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const s = getOrCreateWorker();
  s.statusListeners.add(callback);
  // Notify once on subscription so the consumer pulls the current snapshot
  // (covers the case where the worker hit 'ready' before this hook mounted).
  callback();
  return () => {
    s.statusListeners.delete(callback);
  };
}

function getStatusSnapshot(): PyodideStatus {
  return singleton?.status ?? 'idle';
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
    (code: string) => callWorker<RunResult>({ type: 'run', code }),
    [],
  );

  const runWithTests = useCallback(
    (code: string, tests: PyodideTestSpec[]) =>
      callWorker<RunWithTestsResult>({ type: 'runWithTests', code, tests }),
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

  return { status, run, runWithTests, gaussFilter };
}
