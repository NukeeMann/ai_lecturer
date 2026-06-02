// US-205 — Comprehensive end-to-end suite: REAL libraries through the kernel +
// every Code/Sandbox flow, with ZERO skip-if-missing.
//
// Unlike `kernelManager.test.ts` (whose integration block `it.skip`s when no
// python with jupyter deps is found), this suite is DELIBERATELY un-skippable:
// it drives the genuine US-196 runtime venv through the real kernel bridge and
// performs REAL `import cv2 / numpy / torch / tensorflow` on every run. If the
// runtime is not provisioned the one-line health-check below converts
// "runtime not prepared" into an explicit, actionable FAIL — never a silent
// skip or pass.
//
// This file is named `*.e2e.test.ts` so the default `vitest run` (which now
// excludes that glob) stays green on hosts without the heavy runtime. Run it
// explicitly after the one-time setup:
//
//   bash scripts/setup-kernel.sh        # one-time: provisions the venv + libs
//   npm run test:e2e                    # runs THIS suite against that runtime
//
// Override the interpreter when the libraries live in a different python:
//   AI_LECTURER_E2E_PYTHON=/path/to/python npm run test:e2e
//   AI_LECTURER_PY_RUNTIME=/path/to/py-runtime npm run test:e2e
//
// See docs/kernel-e2e.md for the full runbook.

import { spawnSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { extractHarnessPayload } from '@/lib/kernel/client';
import { buildTestHarness, RESET_NAMESPACE_CELL } from '@/lib/kernel/kernelPython';
import {
  KernelSessionManager,
  KernelRuntimeNotInstalledError,
  defaultBridgeScriptPath,
} from '@/lib/server/kernelManager';
import { kernelPythonPath, __setKernelRuntimeDepsForTesting } from '@/lib/server/kernelRuntime';

const BRIDGE = defaultBridgeScriptPath();

/** The interpreter the kernel runs under. Defaults to the US-196 runtime venv
 *  python (`~/.ai-lecturer/py-runtime/bin/python`, honouring
 *  `AI_LECTURER_PY_RUNTIME`). `AI_LECTURER_E2E_PYTHON` is an explicit override
 *  for hosts where the real libraries live in a different python. */
const RUNTIME_PYTHON = process.env.AI_LECTURER_E2E_PYTHON ?? kernelPythonPath();

/** The four REAL libraries the migration must prove work through the kernel. */
const REQUIRED_IMPORTS = ['cv2', 'numpy', 'torch', 'tensorflow'] as const;

/**
 * ONE-LINE runtime health-check. Imports all four real libraries in the very
 * interpreter the kernel will use. On any failure it THROWS an actionable error
 * (run setup-kernel.sh) instead of skipping — so a missing/half-provisioned
 * runtime turns the build RED, satisfying the "never silent skip/pass" AC.
 */
function healthCheckRuntime(python: string): void {
  const probe = spawnSync(python, ['-c', `import ${REQUIRED_IMPORTS.join(', ')}`], {
    encoding: 'utf-8',
    timeout: 180_000,
  });
  if (probe.status === 0) return;
  const detail = (probe.stderr || probe.error?.message || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .pop();
  throw new Error(
    `AI Lecturer kernel E2E runtime is NOT ready (python: ${python}).\n` +
      `Required REAL libraries failed to import: ${REQUIRED_IMPORTS.join(', ')}.\n` +
      `Fix it with the one-time setup:\n` +
      `    bash scripts/setup-kernel.sh\n` +
      `or point the suite at a provisioned runtime:\n` +
      `    AI_LECTURER_E2E_PYTHON=/path/to/python npm run test:e2e\n` +
      `    AI_LECTURER_PY_RUNTIME=/path/to/py-runtime npm run test:e2e\n` +
      (detail ? `Underlying import error: ${detail}` : ''),
  );
}

// ---------------------------------------------------------------------------
// One manager per file, pointed at the real runtime + real bridge. 30s
// execution timeout honours the AC's "runaway cell → 30s timeout → killed".
// ---------------------------------------------------------------------------
let mgr: KernelSessionManager;
const COURSE = 'e2e-course';
const LESSON = 'e2e-lesson';

beforeAll(() => {
  // No skip: a missing runtime fails EVERY test below with the actionable
  // message above (vitest reports the beforeAll error against each test).
  healthCheckRuntime(RUNTIME_PYTHON);
  mgr = new KernelSessionManager(
    { idleTtlMs: 5 * 60_000, executionTimeoutMs: 30_000, startupTimeoutMs: 120_000 },
    { resolvePython: async () => RUNTIME_PYTHON, bridgeScriptPath: BRIDGE },
  );
}, 200_000);

afterAll(async () => {
  await mgr?.shutdownAll();
});

/** Run a harness cell and pull back its decoded test results + captured png. */
async function runWithTests(
  code: string,
  tests: { name: string; body: string }[],
  captureLiveImage = false,
) {
  const cell = buildTestHarness(code, tests, captureLiveImage);
  const res = await mgr.execute(COURSE, LESSON, cell);
  const { stdout, payload } = extractHarnessPayload(res.stdout);
  return { res, stdout, payload };
}

// ===========================================================================
// AC 1 — REAL library imports through the kernel (no skip, every run).
// ===========================================================================
describe('US-205 E2E · real libraries through the kernel', () => {
  it('health-check: cv2 / numpy / torch / tensorflow import for real', () => {
    // Re-asserting the beforeAll guard as a named, visible checkpoint.
    expect(() => healthCheckRuntime(RUNTIME_PYTHON)).not.toThrow();
  });

  it('cv2: runs Canny edge detection on an input image', async () => {
    const code = [
      'import cv2, numpy as np',
      // A 64x64 image with a bright square → Canny must find edges around it.
      'img = np.zeros((64, 64), dtype=np.uint8)',
      'img[16:48, 16:48] = 255',
      'edges = cv2.Canny(img, 50, 150)',
      'print("CANNY", edges.shape, int((edges > 0).sum()))',
    ].join('\n');
    const r = await mgr.execute(COURSE, LESSON, code);
    expect(r.status).toBe('ok');
    expect(r.stdout).toContain('CANNY (64, 64)');
    // The square's border produces a non-trivial number of edge pixels.
    const edgePixels = Number(/CANNY \(64, 64\) (\d+)/.exec(r.stdout)?.[1] ?? '0');
    expect(edgePixels).toBeGreaterThan(0);
  }, 120_000);

  it('numpy: builds an array and reduces it', async () => {
    const r = await mgr.execute(
      COURSE,
      LESSON,
      'import numpy as np\nprint("NUMPY", int(np.arange(10).sum()))',
    );
    expect(r.status).toBe('ok');
    expect(r.stdout).toContain('NUMPY 45');
  }, 120_000);

  it('torch: builds a tensor and runs an operation', async () => {
    const code = [
      'import torch',
      't = torch.tensor([1.0, 2.0, 3.0])',
      'print("TORCH", float((t * 2).sum().item()))',
    ].join('\n');
    const r = await mgr.execute(COURSE, LESSON, code);
    expect(r.status).toBe('ok');
    expect(r.stdout).toContain('TORCH 12.0');
  }, 120_000);

  it('tensorflow: builds a constant and executes a trivial op', async () => {
    const code = [
      'import tensorflow as tf',
      'x = tf.constant([1, 2, 3])',
      'print("TF", int(tf.reduce_sum(x).numpy()))',
    ].join('\n');
    const r = await mgr.execute(COURSE, LESSON, code);
    expect(r.status).toBe('ok');
    expect(r.stdout).toContain('TF 6');
  }, 120_000);
});

// ===========================================================================
// AC 3 — Code flow: Submit with hidden tests → correct PASS and correct FAIL,
// plus a rendered live figure.
// ===========================================================================
describe('US-205 E2E · Code widget Submit flow (hidden tests)', () => {
  it('hidden tests report a genuine PASS and a genuine FAIL', async () => {
    const code = 'def double(x):\n    return x * 2\n';
    const { payload } = await runWithTests(code, [
      { name: 'doubles two', body: 'assert double(2) == 4' },
      { name: 'wrong expectation', body: 'assert double(2) == 5, "double(2) should be 4"' },
    ]);
    expect(payload).not.toBeNull();
    const byName = Object.fromEntries(payload!.testResults.map((t) => [t.name, t]));
    expect(byName['doubles two'].passed).toBe(true);
    expect(byName['wrong expectation'].passed).toBe(false);
    expect(byName['wrong expectation'].assertionDetail).toBe('double(2) should be 4');
  }, 120_000);

  it('captures a live matplotlib figure alongside the test run', async () => {
    const code = [
      'import matplotlib',
      "matplotlib.use('AGG')",
      'import matplotlib.pyplot as plt',
      'plt.figure()',
      'plt.plot([0, 1, 2], [0, 1, 4])',
    ].join('\n');
    const { payload } = await runWithTests(
      code,
      [{ name: 'plotted', body: 'assert True' }],
      /* captureLiveImage */ true,
    );
    expect(payload).not.toBeNull();
    expect(payload!.testResults[0].passed).toBe(true);
    // A real PNG was rendered and base64-encoded by the harness.
    expect(typeof payload!.png).toBe('string');
    expect((payload!.png ?? '').length).toBeGreaterThan(100);
  }, 120_000);
});

// ===========================================================================
// AC 4 — Sandbox flow: free-run renders a matplotlib image via display_data.
// ===========================================================================
describe('US-205 E2E · Sandbox free-run flow', () => {
  it('free-run renders a matplotlib image through display_data', async () => {
    const code = [
      '%matplotlib inline',
      'import matplotlib.pyplot as plt',
      'plt.plot([1, 2, 3], [2, 4, 6])',
      'plt.show()',
    ].join('\n');
    const r = await mgr.execute(COURSE, LESSON, code);
    expect(r.status).toBe('ok');
    // The inline backend publishes the figure as a display_data image/png,
    // which the bridge surfaces in `images` (US-201 capture path).
    expect(r.images.length).toBeGreaterThan(0);
    expect(r.images[0].length).toBeGreaterThan(100);
  }, 120_000);
});

// ===========================================================================
// AC 5 — Control flows: Stop, namespace reset, runaway 30s timeout, no-runtime.
// ===========================================================================
describe('US-205 E2E · control flows', () => {
  it('Stop interrupts a long-running cell with KeyboardInterrupt', async () => {
    await mgr.execute(COURSE, LESSON, 'import time'); // warm the kernel
    const pending = mgr.execute(COURSE, LESSON, 'while True:\n    time.sleep(0.05)');
    await new Promise((r) => setTimeout(r, 600));
    await mgr.interrupt(COURSE, LESSON);
    const r = await pending;
    expect(r.status).toBe('error');
    expect(r.error?.ename).toBe('KeyboardInterrupt');
    // Kernel survives the interrupt and is still usable.
    const after = await mgr.execute(COURSE, LESSON, 'print(2 + 2)');
    expect(after.stdout).toContain('4');
  }, 120_000);

  it('reset clears the lesson namespace (parity with lesson switch)', async () => {
    await mgr.execute(COURSE, LESSON, 'secret_token = 4242');
    const before = await mgr.execute(COURSE, LESSON, "print('secret_token' in dir())");
    expect(before.stdout).toContain('True');
    await mgr.reset(COURSE, LESSON);
    const after = await mgr.execute(COURSE, LESSON, "print('secret_token' in dir())");
    expect(after.stdout).toContain('False');
  }, 120_000);

  it('reset via the harness RESET_NAMESPACE_CELL also wipes user names', async () => {
    await runWithTests('marker = 7\n', [{ name: 'set', body: 'assert marker == 7' }]);
    await mgr.execute(COURSE, LESSON, RESET_NAMESPACE_CELL);
    const { payload } = await runWithTests('', [
      { name: 'cleared', body: 'assert "marker" not in __ai_lesson_globals' },
    ]);
    expect(payload!.testResults[0].passed).toBe(true);
  }, 120_000);

  it('a runaway cell hits the 30s timeout and is force-killed', async () => {
    const r = await mgr.execute(COURSE, LESSON, 'while True:\n    pass');
    expect(r.status).toBe('timeout');
    // The force-kill reaped the session → a fresh kernel spawns on next use.
    expect(mgr.hasSession(COURSE, LESSON)).toBe(false);
  }, 60_000);

  it('a missing runtime surfaces a gentle KernelRuntimeNotInstalledError', async () => {
    // Drive the DEFAULT manager (which resolves the real runtime) but force the
    // venv-python existence probe to report "absent".
    __setKernelRuntimeDepsForTesting({
      pythonExists: async () => false,
      cudaMarkerExists: async () => false,
    });
    try {
      const missingMgr = new KernelSessionManager();
      await expect(missingMgr.execute('c', 'l', 'print(1)')).rejects.toBeInstanceOf(
        KernelRuntimeNotInstalledError,
      );
    } finally {
      __setKernelRuntimeDepsForTesting(null);
    }
  });
});
