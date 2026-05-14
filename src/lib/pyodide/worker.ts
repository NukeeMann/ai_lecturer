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

interface PyodideFS {
  writeFile: (path: string, data: Uint8Array | string) => void;
  mkdir: (path: string) => void;
  analyzePath: (path: string) => { exists: boolean };
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
  FS: PyodideFS;
}

interface WorkerScope {
  importScripts: (...urls: string[]) => void;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
  addEventListener: (type: string, listener: (e: MessageEvent) => void) => void;
  loadPyodide?: (cfg?: { indexURL?: string }) => Promise<PyodideAPI>;
}

/**
 * Lesson-provided file to mount into the Pyodide virtual filesystem at
 * `/inputs/<filename>` before user code runs. `src` is fetched by the worker
 * (which has unrestricted access to same-origin URLs) and cached by URL so
 * repeated runs don't refetch. The cache is cleared on `resetNamespace`.
 */
interface WorkerInput {
  filename: string;
  src: string;
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
  // 'run' / 'runWithTests' optional package preload (US-173). Currently the
  // only meaningful value is 'cv2', which triggers ensureCv2Shim(py) before
  // user code is exec'd.
  requiresPackages?: string[];
  // Lesson-provided files mounted into Pyodide VFS at /inputs/<filename>
  // before user code runs. See WorkerInput above.
  inputs?: WorkerInput[];
  // When true on 'runWithTests', capture any matplotlib figure left open
  // after user code + tests ran and return it as PNG bytes (US-174).
  captureLiveImage?: boolean;
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

const PYODIDE_VERSION = '0.26.4';
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise: Promise<PyodideAPI> | null = null;
let runnerInstalled = false;
let gaussInstalled = false;
let pillowPromise: Promise<void> | null = null;
let pexpInstalled = false;
let matplotlibPromise: Promise<void> | null = null;
let cv2InstalledOnce = false;
let cv2PackagesPromise: Promise<void> | null = null;
// Per-lesson Python namespace. The Python dict lives in worker globals as
// `__ai_lesson_globals`; this proxy is captured once after the runner is
// installed and reused for every `'run'` exec so user-defined names persist
// across calls within the same lesson. `'resetNamespace'` wipes the dict
// in-place (so the proxy stays valid) and stores the new lesson slug.
let lessonGlobalsProxy: PyProxyLike | null = null;
let currentLessonSlug: string | null = null;

// Mount path inside the Pyodide virtual filesystem. Lesson-provided files
// land here as `/inputs/<filename>` so user code can read them with
// idiomatic OpenCV-style calls (e.g. `cv2.imread('/inputs/lena.png')`).
const INPUTS_DIR = '/inputs';
let inputsDirReady = false;
// Cached fetched bytes keyed by source URL. Cleared on `resetNamespace`
// because lesson switches typically change all referenced URLs.
const inputBytesCache = new Map<string, Uint8Array>();
// Filenames already written into INPUTS_DIR during this lesson. Lets us
// skip the FS.writeFile syscall on repeated runs of the same lesson.
const mountedFilenames = new Set<string>();

function ensureInputsDir(py: PyodideAPI): void {
  if (inputsDirReady) return;
  if (!py.FS.analyzePath(INPUTS_DIR).exists) {
    py.FS.mkdir(INPUTS_DIR);
  }
  inputsDirReady = true;
}

async function fetchInputBytes(src: string): Promise<Uint8Array> {
  const cached = inputBytesCache.get(src);
  if (cached) return cached;
  const res = await fetch(src);
  if (!res.ok) {
    throw new Error(`Failed to fetch lesson input ${src}: HTTP ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  inputBytesCache.set(src, buf);
  return buf;
}

async function mountInputs(
  py: PyodideAPI,
  inputs: WorkerInput[] | undefined,
): Promise<void> {
  if (!inputs || inputs.length === 0) return;
  ensureInputsDir(py);
  // Detect collisions up front — same filename mapped to two URLs in one
  // payload is an authoring bug; surface it instead of letting the later
  // write silently shadow the earlier one.
  const seen = new Map<string, string>();
  for (const input of inputs) {
    const prev = seen.get(input.filename);
    if (prev && prev !== input.src) {
      throw new Error(
        `Duplicate input filename "${input.filename}" mapped to both ${prev} and ${input.src}`,
      );
    }
    seen.set(input.filename, input.src);
  }
  for (const input of inputs) {
    const path = `${INPUTS_DIR}/${input.filename}`;
    if (mountedFilenames.has(input.filename) && inputBytesCache.has(input.src)) {
      continue;
    }
    const bytes = await fetchInputBytes(input.src);
    py.FS.writeFile(path, bytes);
    mountedFilenames.add(input.filename);
  }
}

function clearMountedInputs(): void {
  inputBytesCache.clear();
  mountedFilenames.clear();
  // Leave the /inputs directory in place — next mount will reuse it.
}

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
    matplotlibPromise = py.loadPackage(['matplotlib']);
  }
  await matplotlibPromise;
  await py.runPythonAsync(PEXP_PY);
  pexpInstalled = true;
}

// cv2 shim (US-173) — Pyodide has no native OpenCV, so we expose a thin
// Python shim over scipy.ndimage + scikit-image that mimics the subset of
// the cv2 API used by lessons. After load, `import cv2` resolves to the
// shim module. Keep CV2_SHIM_PY in sync with scripts/pyodide/cv2_shim.py.
const CV2_SHIM_PY = `
"""cv2 shim for Pyodide (NOT real OpenCV). See scripts/pyodide/cv2_shim.py
for the canonical source + caveats."""
import sys

import numpy as np
import scipy.ndimage as _ndimage
import skimage.color as _color
import skimage.feature as _feature
import skimage.io as _skio

IMREAD_GRAYSCALE = 0
IMREAD_COLOR = 1
CV_8U = 0
CV_64F = 6


def imread(path, flags=IMREAD_COLOR):
    img = _skio.imread(path)
    if flags == IMREAD_GRAYSCALE:
        if img.ndim == 3:
            img = _color.rgb2gray(img)
        img = (np.asarray(img) * 255).astype(np.uint8) if img.dtype != np.uint8 else img
    return img


def imwrite(path, img):
    _skio.imsave(path, img)
    return True


def Sobel(src, ddepth, dx, dy, ksize=3):
    if ksize != 3:
        raise ValueError("cv2 shim Sobel only supports ksize=3")
    arr = src.astype(np.float64)
    if dx == 1 and dy == 0:
        return _ndimage.sobel(arr, axis=1)
    if dx == 0 and dy == 1:
        return _ndimage.sobel(arr, axis=0)
    raise ValueError("cv2 shim Sobel only supports (dx=1,dy=0) or (dx=0,dy=1)")


def Canny(image, threshold1, threshold2):
    edges = _feature.canny(
        image.astype(np.float64) / 255.0,
        low_threshold=threshold1 / 255.0,
        high_threshold=threshold2 / 255.0,
    )
    return (edges.astype(np.uint8)) * 255


sys.modules['cv2'] = sys.modules[__name__]
`;

async function ensureCv2Shim(py: PyodideAPI): Promise<void> {
  if (cv2InstalledOnce) return;
  if (!cv2PackagesPromise) {
    cv2PackagesPromise = py.loadPackage(['scipy', 'scikit-image']);
  }
  await cv2PackagesPromise;
  await py.runPythonAsync(CV2_SHIM_PY);
  cv2InstalledOnce = true;
}

// Live matplotlib figure capture for the Code widget (US-174). Set to AGG so
// figures render off-screen; called AFTER user code (and tests) finish.
const LIVE_PNG_PY = `
import io as __live_io
import matplotlib as __live_mpl
__live_mpl.use('AGG')
import matplotlib.pyplot as __live_plt

def __ai_capture_live_png():
    nums = __live_plt.get_fignums()
    if not nums:
        __live_plt.close('all')
        return None
    fig = __live_plt.figure(nums[-1])
    buf = __live_io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', dpi=110)
    __live_plt.close('all')
    return buf.getvalue()
`;

let livePngInstalled = false;
async function ensureLivePngCapture(py: PyodideAPI): Promise<void> {
  if (livePngInstalled) return;
  if (!matplotlibPromise) {
    matplotlibPromise = py.loadPackage(['matplotlib']);
  }
  await matplotlibPromise;
  await py.runPythonAsync(LIVE_PNG_PY);
  livePngInstalled = true;
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
        clearMountedInputs();
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
        if (data.requiresPackages?.includes('cv2')) {
          await ensureCv2Shim(py);
        }
        await mountInputs(py, data.inputs);
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
    if (data.requiresPackages?.includes('cv2')) {
      await ensureCv2Shim(py);
    }
    if (data.captureLiveImage) {
      await ensureLivePngCapture(py);
    }
    await mountInputs(py, data.inputs);
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
    let livePng: Uint8Array | undefined;
    if (data.captureLiveImage) {
      try {
        const raw = (await py.runPythonAsync(
          '__ai_capture_live_png()',
        )) as unknown;
        if (raw instanceof Uint8Array) {
          livePng = raw;
        } else if (
          raw &&
          typeof (raw as PyProxyLike).toJs === 'function'
        ) {
          const conv = (raw as PyProxyLike).toJs!() as unknown;
          if (conv instanceof Uint8Array) {
            livePng = conv;
          }
          (raw as PyProxyLike).destroy?.();
        }
      } catch {
        // Figure capture failures must not break test reporting.
      }
    }
    const transfer: Transferable[] = livePng ? [livePng.buffer] : [];
    ctx.postMessage(
      {
        id,
        stdout: formatStdoutChunks(stdoutBuf),
        stderr: formatStdoutChunks(stderrBuf),
        ...extras,
        testResults,
        ...(livePng ? { png: livePng } : {}),
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
});

export {};
