// Verifies the per-lesson Pyodide namespace contracts that the worker relies
// on (US-031). Runs Pyodide in Node via the `pyodide` npm package; the worker
// itself loads the same Python source from `runnerPython.ts`, so behavior
// observed here is faithful to what runs in the browser worker.
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

// cv2 is no longer shimmed in the Pyodide worker (US-206 removed the legacy
// scipy/scikit-image cv2 shim). Real OpenCV now lives in the IPython kernel
// runtime where the Code/Sandbox widgets execute; the kernel end-to-end suite
// (src/lib/server/kernelE2E.e2e.test.ts) exercises real `import cv2` there.

// Lesson-provided `/inputs/<filename>` mounting is no longer a Pyodide-worker
// concern (US-207 decommissioned the worker's VFS-mount path; the IPython
// kernel runtime now mounts lesson inputs). The kernel end-to-end suite
// (src/lib/server/kernelE2E.e2e.test.ts) covers reading mounted input bytes.
