// Unit + integration tests for stdout chunk formatting. The unit suite covers
// the regression directly with hand-crafted chunks; the integration suite
// boots Pyodide in Node and exercises the real `setStdout({ batched })` API to
// verify that consecutive `print()` calls survive into the rendered output as
// separate lines (US-032).
import { beforeAll, describe, expect, it } from 'vitest';

import { formatStdoutChunks } from './stdout';

describe('formatStdoutChunks (unit)', () => {
  it('returns empty string for no chunks', () => {
    expect(formatStdoutChunks([])).toBe('');
  });

  it('joins consecutive print() chunks with newlines (US-032 repro)', () => {
    // Pyodide's batched stdout fires once per line, stripping the trailing \n.
    // Two `print()` calls produce two chunks ['a', 'b']. Naive join('') would
    // collapse to 'ab'; the fix joins with '\n' so the output panel renders
    // 'a' and 'b' on separate lines.
    expect(formatStdoutChunks(['a', 'b'])).toBe('a\nb');
  });

  it('preserves whitespace and indentation inside chunks', () => {
    expect(formatStdoutChunks(['    nested', '        deeper'])).toBe(
      '    nested\n        deeper',
    );
  });

  it('handles a partial trailing chunk (print(end="")) correctly', () => {
    // print('a'); print('partial', end='') → batched gets ['a', 'partial']
    expect(formatStdoutChunks(['a', 'partial'])).toBe('a\npartial');
  });

  it('drops content before \\r on a line so progress updates do not duplicate', () => {
    // 'progress: 0\rprogress: 1' → terminal-style overwrite → 'progress: 1'.
    expect(formatStdoutChunks(['progress: 0\rprogress: 1'])).toBe('progress: 1');
  });

  it('handles \\r-only chunks without inserting visible CR glyph', () => {
    // Each chunk is one batched line; lone leading \r should be dropped.
    expect(formatStdoutChunks(['\rA', '\rB'])).toBe('A\nB');
  });

  it('preserves newlines while stripping CRs across multiple chunks', () => {
    expect(formatStdoutChunks(['foo\rbar', 'baz'])).toBe('bar\nbaz');
  });
});

interface PyodideAPI {
  runPythonAsync: (code: string) => Promise<unknown>;
  setStdout: (opts: { batched?: (s: string) => void }) => void;
  setStderr: (opts: { batched?: (s: string) => void }) => void;
}

let py: PyodideAPI;

function requirePyodideDir(): string {
  const pkgPath = require.resolve('pyodide/package.json');
  return pkgPath.replace(/package\.json$/, '');
}

describe('Pyodide batched stdout integration (US-032)', () => {
  beforeAll(async () => {
    const { loadPyodide } = await import('pyodide');
    py = (await loadPyodide({ indexURL: requirePyodideDir() })) as unknown as PyodideAPI;
  }, 60_000);

  it('renders two consecutive print() calls as two separate lines', async () => {
    const stdoutBuf: string[] = [];
    py.setStdout({ batched: (s) => stdoutBuf.push(s) });
    py.setStderr({ batched: () => {} });
    await py.runPythonAsync("print('a'); print('b')");
    expect(formatStdoutChunks(stdoutBuf)).toBe('a\nb');
  });

  it('preserves traceback indentation through stderr', async () => {
    const stderrBuf: string[] = [];
    py.setStdout({ batched: () => {} });
    py.setStderr({ batched: (s) => stderrBuf.push(s) });
    // Use sys.stderr directly (NOT raise — that would be a JS exception).
    await py.runPythonAsync(
      "import sys\nprint('header', file=sys.stderr)\nprint('  indented', file=sys.stderr)",
    );
    const formatted = formatStdoutChunks(stderrBuf);
    expect(formatted).toContain('header');
    expect(formatted).toContain('  indented');
    // Each line is on its own row — exact match.
    expect(formatted).toBe('header\n  indented');
  });

  it('handles a for-loop of prints — the canonical Sandbox demo', async () => {
    const stdoutBuf: string[] = [];
    py.setStdout({ batched: (s) => stdoutBuf.push(s) });
    py.setStderr({ batched: () => {} });
    await py.runPythonAsync('for i in range(3):\n    print(i)\n');
    expect(formatStdoutChunks(stdoutBuf)).toBe('0\n1\n2');
  });
});
