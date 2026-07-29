import { describe, expect, it } from 'vitest';

import {
  buildInputsMountCode,
  stripAnsi,
  toCodeRunFinal,
} from './codeRun';
import type { KernelExecuteResult } from './kernelManager';

function ok(partial: Partial<KernelExecuteResult>): KernelExecuteResult {
  return {
    status: 'ok',
    stdout: '',
    stderr: '',
    result: null,
    error: null,
    images: [],
    ...partial,
  };
}

describe('stripAnsi', () => {
  it('removes SGR color codes', () => {
    expect(stripAnsi('[0;31mValueError[0m: boom')).toBe('ValueError: boom');
  });
});

describe('toCodeRunFinal', () => {
  it('passes stdout/stderr through with an ok status', () => {
    const final = toCodeRunFinal(ok({ stdout: 'hi\n', stderr: 'warn\n' }));
    expect(final).toMatchObject({
      type: 'final',
      stdout: 'hi\n',
      stderr: 'warn\n',
      status: 'ok',
    });
    expect(final.traceback).toBeUndefined();
    expect(final.images).toBeUndefined();
  });

  it('includes images when present', () => {
    const final = toCodeRunFinal(ok({ images: ['AAAA', 'BBBB'] }));
    expect(final.images).toEqual(['AAAA', 'BBBB']);
  });

  it('maps a Python error to traceback/errorType/errorMessage (ANSI-stripped)', () => {
    const final = toCodeRunFinal(
      ok({
        status: 'error',
        error: {
          ename: 'ValueError',
          evalue: 'nope',
          traceback: [
            'Traceback (most recent call last):',
            '[0;31mValueError[0m: nope',
          ],
        },
      }),
    );
    expect(final.status).toBe('error');
    expect(final.errorType).toBe('ValueError');
    expect(final.errorMessage).toBe('nope');
    expect(final.traceback).toContain('ValueError: nope');
    expect(final.traceback).not.toContain('');
  });

  it('propagates a timeout status', () => {
    expect(toCodeRunFinal(ok({ status: 'timeout' })).status).toBe('timeout');
  });
});

describe('buildInputsMountCode', () => {
  it('writes each file under /inputs and is valid-looking python', () => {
    const code = buildInputsMountCode([{ filename: 'x.png', b64: 'QUJD' }]);
    expect(code).toContain("os.makedirs('/inputs', exist_ok=True)");
    expect(code).toContain('"/inputs/x.png"');
    expect(code).toContain('base64.b64decode("QUJD")');
    expect(code).toContain('del __ai_f');
  });

  it('escapes awkward filenames via JSON string literals', () => {
    const code = buildInputsMountCode([{ filename: 'a"b.txt', b64: 'QQ==' }]);
    expect(code).toContain('"/inputs/a\\"b.txt"');
  });
});
