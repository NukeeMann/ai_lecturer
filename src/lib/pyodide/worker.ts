// Web Worker that hosts Pyodide. Runs in a DedicatedWorkerGlobalScope, NOT
// the main thread. Loaded lazily from src/lib/pyodide/client.ts via
//   new Worker(new URL('./worker.ts', import.meta.url))
// Pyodide is fetched from the jsdelivr CDN; numpy + scipy are preinstalled
// (numpy is needed by scipy and by the Gauss demo widget).

import { RUNNER_PY } from './runnerPython';

interface PyProxyLike {
  toJs?: (opts?: { dict_converter?: typeof Object.fromEntries }) => unknown;
  destroy?: () => void;
}

interface PyRunOptions {
  globals?: PyProxyLike;
}

interface PyodideAPI {
  loadPackage: (names: string | string[]) => Promise<void>;
  runPython: (code: string, options?: PyRunOptions) => unknown;
  runPythonAsync: (code: string, options?: PyRunOptions) => Promise<unknown>;
  globals: {
    set: (key: string, value: unknown) => void;
    get: (key: string) => unknown;
  };
  setStdout: (opts: { batched?: (s: string) => void }) => void;
  setStderr: (opts: { batched?: (s: string) => void }) => void;
}

interface WorkerScope {
  importScripts: (...urls: string[]) => void;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
  addEventListener: (type: string, listener: (e: MessageEvent) => void) => void;
  loadPyodide?: (cfg?: { indexURL?: string }) => Promise<PyodideAPI>;
}

interface RunRequest {
  id: string;
  type: 'run' | 'runWithTests' | 'gaussFilter' | 'resetNamespace';
  code?: string;
  tests?: Array<{ name: string; body: string }>;
  lessonSlug?: string;
  // gaussFilter payload
  pixels?: Uint8Array;
  width?: number;
  height?: number;
  sigma?: number;
}

const ctx = self as unknown as WorkerScope;

const PYODIDE_VERSION = '0.26.4';
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise: Promise<PyodideAPI> | null = null;
let runnerInstalled = false;
let gaussInstalled = false;
let pillowPromise: Promise<void> | null = null;
// Per-lesson Python namespace. The Python dict lives in worker globals as
// `__ai_lesson_globals`; this proxy is captured once after the runner is
// installed and reused for every `'run'` exec so user-defined names persist
// across calls within the same lesson. `'resetNamespace'` wipes the dict
// in-place (so the proxy stays valid) and stores the new lesson slug.
let lessonGlobalsProxy: PyProxyLike | null = null;
let currentLessonSlug: string | null = null;

function loadPyodideOnce(): Promise<PyodideAPI> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      ctx.importScripts(PYODIDE_INDEX + 'pyodide.js');
      if (!ctx.loadPyodide) {
        throw new Error('loadPyodide is not defined after importScripts');
      }
      const py = await ctx.loadPyodide({ indexURL: PYODIDE_INDEX });
      await py.loadPackage(['numpy', 'scipy']);
      return py;
    })();
  }
  return pyodidePromise;
}

async function ensureRunner(py: PyodideAPI): Promise<void> {
  if (runnerInstalled) return;
  await py.runPythonAsync(RUNNER_PY);
  lessonGlobalsProxy = py.globals.get('__ai_lesson_globals') as PyProxyLike;
  runnerInstalled = true;
}

// Gauss filter routine — installed lazily on first gaussFilter request so the
// Code widget's startup path doesn't pay for Pillow. Reads RGBA bytes from the
// `__gauss_pixels__` global, blurs each color channel via
// scipy.ndimage.gaussian_filter (alpha untouched), encodes PNG via Pillow,
// and stashes the bytes in `__gauss_png__` for the JS side to read.
const GAUSS_PY = `
import numpy as _np
import io as _io
from PIL import Image as _Image
from scipy.ndimage import gaussian_filter as _gauss

def __ai_gauss(__pixels, __w, __h, __sigma):
    # __pixels arrives as a JsProxy over Uint8Array — to_py() yields a memoryview
    # over the underlying ArrayBuffer that np.frombuffer accepts.
    buf = __pixels.to_py() if hasattr(__pixels, 'to_py') else __pixels
    arr = _np.frombuffer(buf, dtype=_np.uint8).reshape(__h, __w, 4)
    out = _np.empty_like(arr)
    s = float(__sigma)
    if s <= 0:
        out[:] = arr
    else:
        for c in range(3):
            out[..., c] = _gauss(arr[..., c], sigma=s, mode='reflect')
        out[..., 3] = arr[..., 3]
    img = _Image.fromarray(out, mode='RGBA')
    buf = _io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()
`;

async function ensureGauss(py: PyodideAPI): Promise<void> {
  if (gaussInstalled) return;
  if (!pillowPromise) {
    pillowPromise = py.loadPackage(['Pillow']);
  }
  await pillowPromise;
  await py.runPythonAsync(GAUSS_PY);
  gaussInstalled = true;
}

function formatTraceback(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.toString();
  }
  return String(err);
}

// Eager bootstrap: start loading immediately so the main thread sees
// status='ready' as soon as Pyodide + numpy + scipy finish installing.
loadPyodideOnce().then(
  () => ctx.postMessage({ type: 'ready' }),
  (err: unknown) => ctx.postMessage({ type: 'error', error: formatTraceback(err) }),
);

ctx.addEventListener('message', async (event: MessageEvent<RunRequest>) => {
  const data = event.data;
  if (
    !data ||
    (data.type !== 'run' &&
      data.type !== 'runWithTests' &&
      data.type !== 'gaussFilter' &&
      data.type !== 'resetNamespace')
  )
    return;
  const { id, type, code, tests } = data;

  const stdoutBuf: string[] = [];
  const stderrBuf: string[] = [];

  try {
    const py = await loadPyodideOnce();
    py.setStdout({ batched: (s) => stdoutBuf.push(s) });
    py.setStderr({ batched: (s) => stderrBuf.push(s) });

    if (type === 'resetNamespace') {
      try {
        await ensureRunner(py);
        await py.runPythonAsync('__ai_reset_namespace()');
        currentLessonSlug = data.lessonSlug ?? null;
        ctx.postMessage({ id, lessonSlug: currentLessonSlug });
      } catch (err) {
        ctx.postMessage({
          id,
          traceback: formatTraceback(err),
        });
      }
      return;
    }

    if (type === 'run') {
      try {
        await ensureRunner(py);
        await py.runPythonAsync(code ?? '', {
          globals: lessonGlobalsProxy ?? undefined,
        });
        ctx.postMessage({
          id,
          stdout: stdoutBuf.join(''),
          stderr: stderrBuf.join(''),
        });
      } catch (err) {
        ctx.postMessage({
          id,
          stdout: stdoutBuf.join(''),
          stderr: stderrBuf.join(''),
          traceback: formatTraceback(err),
        });
      }
      return;
    }

    if (type === 'gaussFilter') {
      try {
        await ensureGauss(py);
        py.globals.set('__gauss_pixels__', data.pixels ?? new Uint8Array());
        py.globals.set('__gauss_w__', data.width ?? 0);
        py.globals.set('__gauss_h__', data.height ?? 0);
        py.globals.set('__gauss_sigma__', data.sigma ?? 0);
        const proxy = (await py.runPythonAsync(
          '__ai_gauss(__gauss_pixels__, __gauss_w__, __gauss_h__, __gauss_sigma__)',
        )) as PyProxyLike;
        const png = proxy?.toJs ? (proxy.toJs() as Uint8Array) : (proxy as unknown as Uint8Array);
        proxy?.destroy?.();
        const bytes = png instanceof Uint8Array ? png : new Uint8Array(png as ArrayBufferLike);
        ctx.postMessage({ id, png: bytes }, [bytes.buffer]);
      } catch (err) {
        ctx.postMessage({
          id,
          stdout: stdoutBuf.join(''),
          stderr: stderrBuf.join(''),
          traceback: formatTraceback(err),
        });
      }
      return;
    }

    // runWithTests
    await ensureRunner(py);
    py.globals.set('__ai_user_code__', code ?? '');
    py.globals.set('__ai_tests__', tests ?? []);
    let testResults: unknown = [];
    let traceback: string | undefined;
    try {
      const proxy = (await py.runPythonAsync(
        '__ai_run_tests(__ai_user_code__, __ai_tests__.to_py())',
      )) as PyProxyLike;
      testResults = proxy?.toJs
        ? proxy.toJs({ dict_converter: Object.fromEntries })
        : proxy;
      proxy?.destroy?.();
    } catch (err) {
      traceback = formatTraceback(err);
    }
    ctx.postMessage({
      id,
      stdout: stdoutBuf.join(''),
      stderr: stderrBuf.join(''),
      traceback,
      testResults,
    });
  } catch (err) {
    ctx.postMessage({
      id,
      stdout: stdoutBuf.join(''),
      stderr: stderrBuf.join(''),
      traceback: formatTraceback(err),
    });
  }
});

export {};
