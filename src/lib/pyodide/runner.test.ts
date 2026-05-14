// Verifies the per-lesson Pyodide namespace contracts that the worker relies
// on (US-031). Runs Pyodide in Node via the `pyodide` npm package; the worker
// itself loads the same Python source from `runnerPython.ts`, so behavior
// observed here is faithful to what runs in the browser worker.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { RUNNER_PY } from './runnerPython';

interface PyDictProxy {
  get(key: string): unknown;
  has(key: string): boolean;
  toJs(opts?: { dict_converter?: typeof Object.fromEntries }): unknown;
  destroy?: () => void;
  length?: number;
}

interface PyodideAPI {
  loadPackage: (names: string | string[]) => Promise<void>;
  runPython: (code: string, options?: { globals?: PyDictProxy }) => unknown;
  runPythonAsync: (
    code: string,
    options?: { globals?: PyDictProxy },
  ) => Promise<unknown>;
  globals: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  FS: {
    writeFile(path: string, data: Uint8Array | string): void;
    mkdir(path: string): void;
    analyzePath(path: string): { exists: boolean };
  };
}

let py: PyodideAPI;
let lessonGlobals: PyDictProxy;

beforeAll(async () => {
  // Pyodide-in-node loads the wasm runtime + stdlib from disk. First boot
  // takes a few seconds; one boot serves the whole describe block.
  const { loadPyodide } = await import('pyodide');
  py = (await loadPyodide({ indexURL: requirePyodideDir() })) as unknown as PyodideAPI;
  await py.runPythonAsync(RUNNER_PY);
  lessonGlobals = py.globals.get('__ai_lesson_globals') as PyDictProxy;
}, 60_000);

function requirePyodideDir(): string {
  // Pyodide needs the directory containing pyodide.asm.wasm + python_stdlib.zip.
  // Resolved from the npm package root so the test stays portable.
  const pkgPath = require.resolve('pyodide/package.json');
  return pkgPath.replace(/package\.json$/, '');
}

function reset(): Promise<unknown> {
  return py.runPythonAsync('__ai_reset_namespace()');
}

describe('Pyodide lesson namespace (RUNNER_PY)', () => {
  it('namespace persists across runs in the same lesson', async () => {
    await reset();
    await py.runPythonAsync('helper = lambda x: x * 2', { globals: lessonGlobals });
    await py.runPythonAsync('result = helper(21)', { globals: lessonGlobals });
    expect(lessonGlobals.get('result')).toBe(42);
  });

  it('namespace clears on lesson change (resetNamespace)', async () => {
    await reset();
    await py.runPythonAsync('secret = 7', { globals: lessonGlobals });
    expect(lessonGlobals.get('secret')).toBe(7);
    await reset();
    expect(lessonGlobals.has('secret')).toBe(false);
    // The cleared dict still has __name__='__main__' so subsequent execs
    // behave like a fresh module.
    expect(lessonGlobals.get('__name__')).toBe('__main__');
  });

  it('test runner uses dict(lessonGlobals) copy — tests do not pollute lesson namespace', async () => {
    await reset();
    // The user's solution code runs against lesson globals (so helpers persist
    // for sandbox cells later in the lesson).
    const userCode = 'def add(a, b):\n    return a + b\n';
    const tests = [
      {
        name: 'test_basic',
        // The test body sets `leaked` and mutates `add`. Both should stay
        // confined to the test-local copy of lesson globals.
        body:
          'leaked = "side effect"\n' +
          'add = lambda a, b: a - b\n' +
          'assert add(2, 3) == -1\n',
      },
    ];
    py.globals.set('__ai_user_code__', userCode);
    py.globals.set('__ai_tests__', tests);
    const proxy = (await py.runPythonAsync(
      '__ai_run_tests(__ai_user_code__, __ai_tests__.to_py())',
    )) as PyDictProxy;
    const results = proxy.toJs({
      dict_converter: Object.fromEntries,
    }) as Array<{ name: string; passed: boolean }>;
    proxy.destroy?.();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'test_basic', passed: true });

    // Solution's `add` IS in lessonGlobals (so future widgets can call it).
    const addProxy = lessonGlobals.get('add') as { toString(): string };
    expect(addProxy).toBeTruthy();
    const sumResult = await py.runPythonAsync('add(2, 3)', { globals: lessonGlobals });
    expect(sumResult).toBe(5); // not -1 — the test's mutation didn't leak.

    // The test body's `leaked` global stayed in the test-local dict copy.
    expect(lessonGlobals.has('leaked')).toBe(false);
  });

  it('test runner reports failure on AssertionError but still leaves user code in lesson namespace', async () => {
    await reset();
    const userCode = 'value = 10\n';
    const tests = [{ name: 'expect_42', body: 'assert value == 42, "expected 42"\n' }];
    py.globals.set('__ai_user_code__', userCode);
    py.globals.set('__ai_tests__', tests);
    const proxy = (await py.runPythonAsync(
      '__ai_run_tests(__ai_user_code__, __ai_tests__.to_py())',
    )) as PyDictProxy;
    const results = proxy.toJs({
      dict_converter: Object.fromEntries,
    }) as Array<{ name: string; passed: boolean; assertionDetail: string | null }>;
    proxy.destroy?.();
    expect(results[0].passed).toBe(false);
    expect(results[0].assertionDetail).toBe('expected 42');
    expect(lessonGlobals.get('value')).toBe(10);
  });
});

// cv2 shim (US-173) — exercises the same `loadPackage(['scipy','scikit-image'])
// + runPythonAsync(CV2_SHIM_PY)` sequence the worker's ensureCv2Shim runs
// when a Code widget sets `requiresPackages: ['cv2']`. The worker itself is
// a Web Worker and can't be instantiated in Node, so we drive the underlying
// Pyodide instance directly to verify the shim's behavior end-to-end.
const CV2_SHIM_PY_PATH = resolve(__dirname, '../../../scripts/pyodide/cv2_shim.py');

describe('cv2 shim', () => {
  let cv2Ready = false;

  beforeAll(async () => {
    await py.loadPackage(['scipy', 'scikit-image']);
    const cv2Src = readFileSync(CV2_SHIM_PY_PATH, 'utf-8');
    await py.runPythonAsync(cv2Src);
    cv2Ready = true;
  }, 180_000);

  it('cv2 shim — Sobel returns same-shape float array', async () => {
    expect(cv2Ready).toBe(true);
    await reset();
    const code = [
      'import cv2',
      'import numpy as np',
      'img = np.zeros((8, 8), dtype=np.uint8)',
      'img[2:6, 2:6] = 255',
      'gx = cv2.Sobel(img, cv2.CV_64F, 1, 0)',
      'assert gx.shape == (8, 8)',
      'assert gx.dtype == np.float64',
    ].join('\n');
    let error: unknown = null;
    try {
      await py.runPythonAsync(code, { globals: lessonGlobals });
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  }, 60_000);

  it('cv2 shim — Canny returns binary uint8', async () => {
    expect(cv2Ready).toBe(true);
    await reset();
    const code = [
      'import cv2',
      'import numpy as np',
      'img = np.zeros((32, 32), dtype=np.uint8)',
      'img[8:24, 8:24] = 255',
      'edges = cv2.Canny(img, 100, 200)',
      'assert edges.dtype == np.uint8',
      'assert set(int(v) for v in np.unique(edges).tolist()) <= {0, 255}',
      'assert edges.max() == 255',
    ].join('\n');
    let error: unknown = null;
    try {
      await py.runPythonAsync(code, { globals: lessonGlobals });
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
  }, 60_000);
});

// Lesson-provided input files (US-?? — schema CodeInputSchema). The worker
// fetches bytes over HTTP and writes them into Pyodide's VFS at
// `/inputs/<filename>` before user code runs. Fetch is browser-only, but the
// FS.writeFile → exec contract is what this test guards.
describe('lesson input mounting', () => {
  it('user code reads bytes written to /inputs/ via FS.writeFile', async () => {
    await reset();
    if (!py.FS.analyzePath('/inputs').exists) {
      py.FS.mkdir('/inputs');
    }
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]);
    py.FS.writeFile('/inputs/blob.bin', payload);

    const userCode = [
      "with open('/inputs/blob.bin', 'rb') as f:",
      '    data = f.read()',
    ].join('\n');
    await py.runPythonAsync(userCode, { globals: lessonGlobals });

    const lengthResult = await py.runPythonAsync('len(data)', {
      globals: lessonGlobals,
    });
    expect(lengthResult).toBe(payload.length);
    const firstByte = await py.runPythonAsync('data[0]', {
      globals: lessonGlobals,
    });
    expect(firstByte).toBe(0xde);
  }, 30_000);
});
