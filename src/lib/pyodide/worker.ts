// Web Worker that hosts Pyodide. Runs in a DedicatedWorkerGlobalScope, NOT
// the main thread. Loaded lazily from src/lib/pyodide/client.ts via
//   new Worker(new URL('./worker.ts', import.meta.url))
// Pyodide is fetched from the jsdelivr CDN; numpy + scipy are preinstalled
// (numpy is needed by scipy and by the Gauss demo widget).

import { extractPythonError } from './errorFormat';
import { RUNNER_PY } from './runnerPython';
import { formatStdoutChunks } from './stdout';

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
  type:
    | 'run'
    | 'runWithTests'
    | 'gaussFilter'
    | 'resetNamespace'
    | 'runWithPlotParam';
  code?: string;
  tests?: Array<{ name: string; body: string }>;
  lessonSlug?: string;
  // 'run' / 'runWithTests' optional package-precondition list. Carried for
  // wire-compat with the client payload; the Pyodide worker no longer acts on
  // it. Real libraries (cv2, torch, …) live in the IPython kernel runtime
  // (US-196/201) where the Code/Sandbox widgets actually execute; US-206
  // removed the legacy Pyodide cv2 shim, so there is nothing to preload here.
  requiresPackages?: string[];
  // gaussFilter payload
  pixels?: Uint8Array;
  width?: number;
  height?: number;
  sigma?: number;
  // runWithPlotParam payload
  setupCode?: string;
  renderCode?: string;
  params?: Record<string, number | string | boolean>;
  outputType?: 'plot' | 'value' | 'both';
}

const ctx = self as unknown as WorkerScope;

// Keep this in lockstep with the `pyodide` dependency in package.json. The
// loader script and every wheel `loadPackage` pulls come from this same CDN
// tree, so a stale pin silently serves a different runtime than the bundled
// wheels — which is how matplotlib (3.5.2 on the old 0.26.4 tree) stopped
// resolving for the ParametricExplorer histogram.
const PYODIDE_VERSION = '0.29.3';
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise: Promise<PyodideAPI> | null = null;
let runnerInstalled = false;
let gaussInstalled = false;
let pillowPromise: Promise<void> | null = null;
let pexpInstalled = false;
let matplotlibPromise: Promise<void> | null = null;
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
    // Don't cache a rejected promise: a transient CDN hiccup would otherwise
    // wedge the widget for the rest of the session. Clear it on failure so the
    // next call retries the download.
    pillowPromise = py.loadPackage(['Pillow']).catch((err) => {
      pillowPromise = null;
      throw err;
    });
  }
  await pillowPromise;
  await py.runPythonAsync(GAUSS_PY);
  gaussInstalled = true;
}

// ParametricExplorer (US-045) — installed lazily on first runWithPlotParam.
// Per-setupCode namespace cache: setupCode strings are used as the cache key,
// so identical setupCode runs once per lesson session and renderCode reuses
// the cached namespace for every param change. Each render exec'd in a fresh
// `dict(cached)` copy so user mutations in renderCode don't pollute setup.
const PEXP_PY = `
import io as __pexp_io
import json as __pexp_json
import matplotlib as __pexp_mpl
__pexp_mpl.use('AGG')
import matplotlib.pyplot as __pexp_plt

__ai_pexp_namespaces = {}

def __ai_pexp_run(setup_code, render_code, params, capture_plot, capture_value):
    p = params.to_py() if hasattr(params, 'to_py') else dict(params)
    if setup_code not in __ai_pexp_namespaces:
        ns = {'__name__': '__pexp__'}
        if setup_code:
            exec(setup_code, ns)
        __ai_pexp_namespaces[setup_code] = ns
    g = dict(__ai_pexp_namespaces[setup_code])
    g.update(p)
    g['result'] = None
    __pexp_plt.close('all')
    exec(render_code, g)
    out = {}
    if capture_plot:
        nums = __pexp_plt.get_fignums()
        if nums:
            fig = __pexp_plt.figure(nums[-1])
            buf = __pexp_io.BytesIO()
            fig.savefig(buf, format='png', bbox_inches='tight', dpi=110)
            out['png'] = buf.getvalue()
        __pexp_plt.close('all')
    if capture_value:
        v = g.get('result', None)
        try:
            out['value'] = __pexp_json.dumps(v)
        except Exception:
            out['value'] = str(v)
    return out
`;

async function ensurePexp(py: PyodideAPI): Promise<void> {
  if (pexpInstalled) return;
  if (!matplotlibPromise) {
    // See ensureGauss: clear on failure so a transient load error can retry
    // instead of permanently breaking the histogram for the session.
    matplotlibPromise = py.loadPackage(['matplotlib']).catch((err) => {
      matplotlibPromise = null;
      throw err;
    });
  }
  await matplotlibPromise;
  await py.runPythonAsync(PEXP_PY);
  pexpInstalled = true;
}

function formatTraceback(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.toString();
  }
  return String(err);
}

interface ErrorFields {
  traceback: string;
  errorType?: string;
  errorMessage?: string;
}

function errorFields(err: unknown): ErrorFields {
  return extractPythonError(err);
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
      data.type !== 'resetNamespace' &&
      data.type !== 'runWithPlotParam')
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
          ...errorFields(err),
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
          stdout: formatStdoutChunks(stdoutBuf),
          stderr: formatStdoutChunks(stderrBuf),
        });
      } catch (err) {
        ctx.postMessage({
          id,
          stdout: formatStdoutChunks(stdoutBuf),
          stderr: formatStdoutChunks(stderrBuf),
          ...errorFields(err),
        });
      }
      return;
    }

    if (type === 'runWithPlotParam') {
      try {
        await ensurePexp(py);
        const outputType = data.outputType ?? 'plot';
        py.globals.set('__pexp_setup_code__', data.setupCode ?? '');
        py.globals.set('__pexp_render_code__', data.renderCode ?? '');
        py.globals.set('__pexp_params__', data.params ?? {});
        py.globals.set('__pexp_capture_plot__', outputType !== 'value');
        py.globals.set('__pexp_capture_value__', outputType !== 'plot');
        const proxy = (await py.runPythonAsync(
          '__ai_pexp_run(__pexp_setup_code__, __pexp_render_code__, __pexp_params__, __pexp_capture_plot__, __pexp_capture_value__)',
        )) as PyProxyLike;
        const result = (proxy?.toJs
          ? proxy.toJs({ dict_converter: Object.fromEntries })
          : proxy) as { png?: Uint8Array; value?: string };
        proxy?.destroy?.();
        const transfer: Transferable[] = [];
        if (result?.png instanceof Uint8Array) {
          transfer.push(result.png.buffer);
        }
        ctx.postMessage(
          {
            id,
            stdout: formatStdoutChunks(stdoutBuf),
            stderr: formatStdoutChunks(stderrBuf),
            png: result?.png,
            value: result?.value,
          },
          transfer,
        );
      } catch (err) {
        ctx.postMessage({
          id,
          stdout: formatStdoutChunks(stdoutBuf),
          stderr: formatStdoutChunks(stderrBuf),
          ...errorFields(err),
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
          stdout: formatStdoutChunks(stdoutBuf),
          stderr: formatStdoutChunks(stderrBuf),
          ...errorFields(err),
        });
      }
      return;
    }

    // runWithTests
    await ensureRunner(py);
    py.globals.set('__ai_user_code__', code ?? '');
    py.globals.set('__ai_tests__', tests ?? []);
    let testResults: unknown = [];
    let extras: ErrorFields | { traceback?: undefined } = {};
    try {
      const proxy = (await py.runPythonAsync(
        '__ai_run_tests(__ai_user_code__, __ai_tests__.to_py())',
      )) as PyProxyLike;
      testResults = proxy?.toJs
        ? proxy.toJs({ dict_converter: Object.fromEntries })
        : proxy;
      proxy?.destroy?.();
    } catch (err) {
      extras = errorFields(err);
    }
    ctx.postMessage({
      id,
      stdout: formatStdoutChunks(stdoutBuf),
      stderr: formatStdoutChunks(stderrBuf),
      ...extras,
      testResults,
    });
  } catch (err) {
    ctx.postMessage({
      id,
      stdout: formatStdoutChunks(stdoutBuf),
      stderr: formatStdoutChunks(stderrBuf),
      ...errorFields(err),
    });
  }
});

export {};
