// US-200 — parity of the kernel hidden-test runner with the Pyodide RUNNER_PY.
//
// The kernel `runWithTests` path executes a compiled harness (kernelPython.ts)
// instead of the worker's RUNNER_PY (runnerPython.ts). Both are plain CPython
// semantics — exec / AssertionError / traceback behave identically in Pyodide
// and CPython — so we verify behavioural parity by running BOTH through a local
// python interpreter and asserting the returned `testResults` shape matches for
// representative pass / fail / assertion / user-code-error cases, plus the
// namespace persistence + reset + per-test isolation contracts.
//
// Requires any python3 on PATH (stdlib only — no jupyter deps). If none is
// found the suite is skipped, exactly like the kernelManager integration tests.
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { RUNNER_PY } from '@/lib/pyodide/runnerPython';

import { extractHarnessPayload } from './client';
import { buildTestHarness, RESET_NAMESPACE_CELL } from './kernelPython';

interface RawTestResult {
  name: string;
  passed: boolean;
  traceback: string | null;
  assertionDetail: string | null;
}

interface Test {
  name: string;
  body: string;
}

function findPython(): string | null {
  const candidates = [process.env.AI_LECTURER_TEST_PYTHON, 'python3', 'python'].filter(
    (c): c is string => !!c,
  );
  for (const cand of candidates) {
    try {
      const res = spawnSync(cand, ['-c', 'import sys, json, base64'], {
        stdio: 'ignore',
        timeout: 20000,
      });
      if (res.status === 0) return cand;
    } catch {
      /* try next */
    }
  }
  return null;
}

const PYTHON = findPython();

function runPython(py: string, script: string, args: string[] = []): string {
  const res = spawnSync(py, ['-c', script, ...args], {
    encoding: 'utf-8',
    timeout: 30000,
  });
  if (res.status !== 0) {
    throw new Error(`python exited ${res.status}: ${res.stderr}`);
  }
  return res.stdout;
}

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64');
}

/** Canonical results: drive the Pyodide worker's RUNNER_PY in CPython. */
function runCanonical(py: string, code: string, tests: Test[]): RawTestResult[] {
  const script = `${RUNNER_PY}
import json, base64, sys
_p = json.loads(base64.b64decode(sys.argv[1]).decode('utf-8'))
print(json.dumps(__ai_run_tests(_p['code'], _p['tests'])))
`;
  const out = runPython(py, script, [b64({ code, tests })]);
  return JSON.parse(out.trim()) as RawTestResult[];
}

/**
 * Kernel results: run a sequence of cells in ONE shared namespace `G` — exactly
 * how the real IPython kernel persists top-level names between executions — and
 * return each cell's captured stdout. The harness's persistent
 * `__ai_lesson_globals` therefore lives across cells just like in the kernel.
 */
function runKernelCells(py: string, cells: string[]): string[] {
  const driver = `
import json, base64, sys, io, contextlib, traceback
cells = json.loads(base64.b64decode(sys.argv[1]).decode('utf-8'))
G = {}
outs = []
for cell in cells:
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(cell, G)
    except Exception:
        buf.write(traceback.format_exc())
    outs.append(buf.getvalue())
sys.stdout.write(base64.b64encode(json.dumps(outs).encode('utf-8')).decode('ascii'))
`;
  const out = runPython(py, driver, [b64(cells)]);
  return JSON.parse(Buffer.from(out.trim(), 'base64').toString('utf-8')) as string[];
}

/** Run one harness cell and pull the decoded testResults back out of stdout. */
function runKernelTests(py: string, code: string, tests: Test[]): RawTestResult[] {
  const [stdout] = runKernelCells(py, [buildTestHarness(code, tests)]);
  const { payload } = extractHarnessPayload(stdout);
  return (payload?.testResults ?? []) as RawTestResult[];
}

/** Compare on the observable contract: name, passed, assertionDetail, and
 *  whether a traceback is present (exact trace text is intentionally loose). */
function normalize(results: RawTestResult[]) {
  return results.map((r) => ({
    name: r.name,
    passed: r.passed,
    assertionDetail: r.assertionDetail,
    hasTraceback: typeof r.traceback === 'string' && r.traceback.length > 0,
  }));
}

const describeKernel = PYTHON ? describe : describe.skip;

describeKernel('kernel test-runner parity with RUNNER_PY', () => {
  const py = PYTHON as string;

  const cases: Array<{ label: string; code: string; tests: Test[] }> = [
    {
      label: 'pass',
      code: 'def add(a, b):\n    return a + b\n',
      tests: [{ name: 'adds', body: 'assert add(2, 3) == 5' }],
    },
    {
      label: 'fail without message',
      code: 'def add(a, b):\n    return a + b\n',
      tests: [{ name: 'wrong', body: 'assert add(2, 3) == 6' }],
    },
    {
      label: 'assertion with detail',
      code: 'def add(a, b):\n    return a + b\n',
      tests: [{ name: 'msg', body: 'assert add(2, 2) == 5, "math is broken"' }],
    },
    {
      label: 'non-assertion exception',
      code: '',
      tests: [{ name: 'boom', body: 'raise ValueError("boom")' }],
    },
    {
      label: 'user-code error fails all tests',
      code: 'raise RuntimeError("setup failed")\n',
      tests: [
        { name: 'a', body: 'assert True' },
        { name: 'b', body: 'assert True' },
      ],
    },
  ];

  for (const c of cases) {
    it(`matches RUNNER_PY for: ${c.label}`, () => {
      const canonical = runCanonical(py, c.code, c.tests);
      const kernel = runKernelTests(py, c.code, c.tests);
      expect(normalize(kernel)).toEqual(normalize(canonical));
    });
  }

  it('surfaces the exact AssertionError detail (parity)', () => {
    const code = '';
    const tests = [{ name: 'd', body: 'assert 1 == 2, "expected 1 to equal 2"' }];
    const canonical = runCanonical(py, code, tests);
    const kernel = runKernelTests(py, code, tests);
    expect(kernel[0].assertionDetail).toBe('expected 1 to equal 2');
    expect(canonical[0].assertionDetail).toBe('expected 1 to equal 2');
  });

  it('user-code error shares one traceback across all tests', () => {
    const results = runKernelTests(py, 'raise RuntimeError("setup failed")\n', [
      { name: 'a', body: 'assert True' },
      { name: 'b', body: 'assert True' },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.passed)).toBe(true);
    expect(results[0].traceback).toBe(results[1].traceback);
    expect(results[0].traceback).toContain('RuntimeError: setup failed');
  });

  it('isolates each test in its own namespace copy (parity)', () => {
    const code = '';
    const tests: Test[] = [
      { name: 'leak', body: 'leaked = 1' },
      { name: 'isolated', body: 'assert "leaked" not in dir(), "namespace leaked"' },
    ];
    const canonical = normalize(runCanonical(py, code, tests));
    const kernel = normalize(runKernelTests(py, code, tests));
    // Both: first test passes (sets a name), second passes BECAUSE the name did
    // not leak into its fresh copy.
    expect(kernel).toEqual(canonical);
    expect(kernel[1].passed).toBe(true);
  });

  it('persists the namespace across runs in a session', () => {
    const cell1 = buildTestHarness('counter = 41\n', [
      { name: 'set', body: 'assert counter == 41' },
    ]);
    const cell2 = buildTestHarness('counter += 1\n', [
      { name: 'persisted', body: 'assert counter == 42' },
    ]);
    const [out1, out2] = runKernelCells(py, [cell1, cell2]);
    const r1 = extractHarnessPayload(out1).payload?.testResults as RawTestResult[];
    const r2 = extractHarnessPayload(out2).payload?.testResults as RawTestResult[];
    expect(r1[0].passed).toBe(true);
    // counter survived from cell1 into cell2's user code → +=1 reached 42.
    expect(r2[0].passed).toBe(true);
  });

  it('clears the namespace on reset', () => {
    const define = buildTestHarness('token = 99\n', [
      { name: 'present', body: 'assert "token" in dir()' },
    ]);
    const check = buildTestHarness('', [
      { name: 'gone', body: 'assert "token" not in dir(), "namespace not reset"' },
    ]);
    const [outDefine, , outCheck] = runKernelCells(py, [
      define,
      RESET_NAMESPACE_CELL,
      check,
    ]);
    const rDefine = extractHarnessPayload(outDefine).payload?.testResults as RawTestResult[];
    const rCheck = extractHarnessPayload(outCheck).payload?.testResults as RawTestResult[];
    expect(rDefine[0].passed).toBe(true); // token visible before reset
    expect(rCheck[0].passed).toBe(true); // and gone after reset
  });

  it('does not leak the harness sentinel into user-visible stdout', () => {
    const [stdout] = runKernelCells(py, [
      buildTestHarness('print("hello from user")\n', [
        { name: 't', body: 'assert True' },
      ]),
    ]);
    const { stdout: cleaned, payload } = extractHarnessPayload(stdout);
    expect(cleaned).toBe('hello from user\n');
    expect(payload?.testResults[0].passed).toBe(true);
  });
});
