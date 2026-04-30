// Web Worker that hosts Pyodide. Runs in a DedicatedWorkerGlobalScope, NOT
// the main thread. Loaded lazily from src/lib/pyodide/client.ts via
//   new Worker(new URL('./worker.ts', import.meta.url))
// Pyodide is fetched from the jsdelivr CDN; numpy + scipy are preinstalled
// (numpy is needed by scipy and by the Gauss demo widget).

interface PyProxyLike {
  toJs?: (opts?: { dict_converter?: typeof Object.fromEntries }) => unknown;
  destroy?: () => void;
}

interface PyodideAPI {
  loadPackage: (names: string | string[]) => Promise<void>;
  runPython: (code: string) => unknown;
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: {
    set: (key: string, value: unknown) => void;
    get: (key: string) => unknown;
  };
  setStdout: (opts: { batched?: (s: string) => void }) => void;
  setStderr: (opts: { batched?: (s: string) => void }) => void;
}

interface WorkerScope {
  importScripts: (...urls: string[]) => void;
  postMessage: (msg: unknown) => void;
  addEventListener: (type: string, listener: (e: MessageEvent) => void) => void;
  loadPyodide?: (cfg?: { indexURL?: string }) => Promise<PyodideAPI>;
}

interface RunRequest {
  id: string;
  type: 'run' | 'runWithTests';
  code: string;
  tests?: Array<{ name: string; body: string }>;
}

const ctx = self as unknown as WorkerScope;

const PYODIDE_VERSION = '0.26.4';
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise: Promise<PyodideAPI> | null = null;
let runnerInstalled = false;

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

// Custom test runner — much smaller than pulling pytest. Each test body is
// exec()'d in a copy of the namespace produced by the user's code, so tests
// can't pollute one another. AssertionError → assertionDetail; any other
// exception → traceback. Stdout from tests is suppressed via redirect_stdout
// so test prints don't leak into the user-visible stdout.
const RUNNER_PY = `
import sys as _sys
import io as _io
import traceback as _tb
import contextlib as _cl

def __ai_run_tests(__user_code, __tests):
    results = []
    user_ns = {'__name__': '__main__'}
    try:
        exec(__user_code, user_ns)
    except Exception:
        tb = _tb.format_exc()
        for t in __tests:
            results.append({
                'name': t['name'],
                'passed': False,
                'traceback': tb,
                'assertionDetail': None,
            })
        return results
    for t in __tests:
        test_ns = dict(user_ns)
        sink = _io.StringIO()
        try:
            with _cl.redirect_stdout(sink), _cl.redirect_stderr(sink):
                exec(t['body'], test_ns)
            results.append({
                'name': t['name'],
                'passed': True,
                'traceback': None,
                'assertionDetail': None,
            })
        except AssertionError as e:
            tb = _tb.format_exc()
            detail = str(e) if str(e) else None
            results.append({
                'name': t['name'],
                'passed': False,
                'traceback': tb,
                'assertionDetail': detail,
            })
        except Exception:
            tb = _tb.format_exc()
            results.append({
                'name': t['name'],
                'passed': False,
                'traceback': tb,
                'assertionDetail': None,
            })
    return results
`;

async function ensureRunner(py: PyodideAPI): Promise<void> {
  if (runnerInstalled) return;
  await py.runPythonAsync(RUNNER_PY);
  runnerInstalled = true;
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
  if (!data || (data.type !== 'run' && data.type !== 'runWithTests')) return;
  const { id, type, code, tests } = data;

  const stdoutBuf: string[] = [];
  const stderrBuf: string[] = [];

  try {
    const py = await loadPyodideOnce();
    py.setStdout({ batched: (s) => stdoutBuf.push(s) });
    py.setStderr({ batched: (s) => stderrBuf.push(s) });

    if (type === 'run') {
      try {
        await py.runPythonAsync(code);
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

    // runWithTests
    await ensureRunner(py);
    py.globals.set('__ai_user_code__', code);
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
