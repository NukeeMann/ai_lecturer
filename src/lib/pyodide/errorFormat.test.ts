// Unit + integration tests for the Pyodide error formatter (US-061).
//
// The unit suite covers the regression directly with synthetic PythonError-like
// objects. The integration suite boots Pyodide in Node and exercises the real
// `PythonError` shape so the formatter stays compatible with the worker's
// runtime — the prior bug was that `raise ValueError('boom')` produced a fully
// populated traceback string but the Output panel never surfaced the
// exception type/message as a headline (and the panel hid `stderr` entirely).
import { beforeAll, describe, expect, it } from 'vitest';

import { extractPythonError } from './errorFormat';

describe('extractPythonError (unit)', () => {
  it('returns just the stringified value for non-Error inputs', () => {
    expect(extractPythonError('plain')).toEqual({ traceback: 'plain' });
    expect(extractPythonError(undefined)).toEqual({ traceback: '' });
    expect(extractPythonError(null)).toEqual({ traceback: '' });
  });

  it('extracts errorType + errorMessage from a PythonError-shaped object', () => {
    const fakeErr = {
      type: 'ValueError',
      message:
        'Traceback (most recent call last):\n  File "<exec>", line 1, in <module>\nValueError: boom',
    };
    const out = extractPythonError(fakeErr);
    expect(out.errorType).toBe('ValueError');
    expect(out.errorMessage).toBe('boom');
    expect(out.traceback).toContain('Traceback');
    expect(out.traceback).toContain('ValueError: boom');
  });

  it('handles exceptions whose message is empty (Type only)', () => {
    const fakeErr = {
      type: 'KeyboardInterrupt',
      message:
        'Traceback (most recent call last):\n  File "<exec>", line 1, in <module>\nKeyboardInterrupt',
    };
    const out = extractPythonError(fakeErr);
    expect(out.errorType).toBe('KeyboardInterrupt');
    expect(out.errorMessage).toBe('');
  });

  it('falls through to no errorType for non-Python errors', () => {
    const jsErr = new Error('something broke');
    const out = extractPythonError(jsErr);
    expect(out.errorType).toBeUndefined();
    expect(out.errorMessage).toBeUndefined();
    expect(out.traceback).toBe('something broke');
  });

  it('uses toString() when message is missing', () => {
    const obj = { toString: () => 'fallback string' } as unknown;
    const out = extractPythonError(obj);
    expect(out.traceback).toBe('fallback string');
  });
});

interface PyodideAPI {
  runPythonAsync: (code: string) => Promise<unknown>;
  setStdout: (opts: { batched?: (s: string) => void }) => void;
  setStderr: (opts: { batched?: (s: string) => void }) => void;
}

function requirePyodideDir(): string {
  const pkgPath = require.resolve('pyodide/package.json');
  return pkgPath.replace(/package\.json$/, '');
}

describe('Pyodide PythonError integration (US-061)', () => {
  let py: PyodideAPI;

  beforeAll(async () => {
    const { loadPyodide } = await import('pyodide');
    py = (await loadPyodide({ indexURL: requirePyodideDir() })) as unknown as PyodideAPI;
  }, 60_000);

  it('captures errorType + errorMessage from `raise ValueError("boom")`', async () => {
    py.setStdout({ batched: () => {} });
    py.setStderr({ batched: () => {} });
    let caught: unknown;
    try {
      await py.runPythonAsync("raise ValueError('boom')");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const out = extractPythonError(caught);
    expect(out.errorType).toBe('ValueError');
    expect(out.errorMessage).toBe('boom');
    // Traceback contains the headline + at least one frame.
    expect(out.traceback).toContain('ValueError: boom');
    expect(out.traceback).toContain('Traceback');
  });

  it('captures stderr separately from stdout for `print(..., file=sys.stderr)`', async () => {
    const outBuf: string[] = [];
    const errBuf: string[] = [];
    py.setStdout({ batched: (s) => outBuf.push(s) });
    py.setStderr({ batched: (s) => errBuf.push(s) });
    await py.runPythonAsync(
      "import sys\nprint('hello')\nprint('warn', file=sys.stderr)",
    );
    // The worker forwards stderr in its `RunResult.stderr` field — the prior
    // OutputBody never rendered it, which is the regression this story fixes.
    expect(outBuf).toEqual(['hello']);
    expect(errBuf).toEqual(['warn']);
  });
});
