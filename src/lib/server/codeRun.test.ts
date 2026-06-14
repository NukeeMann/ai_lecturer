import { describe, expect, it } from 'vitest';

import {
  buildInputsMountCode,
  resolveInputsDir,
  rewriteInputsPath,
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
  it('writes each file under the default /inputs root and is valid-looking python', () => {
    const code = buildInputsMountCode([{ filename: 'x.png', b64: 'QUJD' }]);
    expect(code).toContain('os.makedirs("/inputs", exist_ok=True)');
    expect(code).toContain('"/inputs/x.png"');
    expect(code).toContain('base64.b64decode("QUJD")');
    expect(code).toContain('del __ai_f');
  });

  it('writes into a supplied real mount directory', () => {
    const code = buildInputsMountCode([{ filename: 'x.png', b64: 'QUJD' }], '/tmp/ai/inputs');
    expect(code).toContain('os.makedirs("/tmp/ai/inputs", exist_ok=True)');
    expect(code).toContain('"/tmp/ai/inputs/x.png"');
  });

  it('escapes awkward filenames via JSON string literals', () => {
    const code = buildInputsMountCode([{ filename: 'a"b.txt', b64: 'QQ==' }]);
    expect(code).toContain('"/inputs/a\\"b.txt"');
  });
});

describe('resolveInputsDir', () => {
  it('maps the virtual root to a real per-lesson dir ending in /inputs', () => {
    const dir = resolveInputsDir('course-a', 'lesson-1');
    expect(dir.endsWith('/inputs')).toBe(true);
    expect(dir).not.toBe('/inputs');
  });

  it('is stable per course+lesson and distinct across lessons', () => {
    expect(resolveInputsDir('c', 'l1')).toBe(resolveInputsDir('c', 'l1'));
    expect(resolveInputsDir('c', 'l1')).not.toBe(resolveInputsDir('c', 'l2'));
  });

  it('honours KERNEL_INPUTS_DIR override', () => {
    const prev = process.env.KERNEL_INPUTS_DIR;
    process.env.KERNEL_INPUTS_DIR = '/custom/base';
    try {
      expect(resolveInputsDir('c', 'l').startsWith('/custom/base/')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.KERNEL_INPUTS_DIR;
      else process.env.KERNEL_INPUTS_DIR = prev;
    }
  });
});

describe('rewriteInputsPath', () => {
  const dir = '/tmp/ai/inputs';

  it('rewrites quoted /inputs references to the real dir', () => {
    expect(rewriteInputsPath("cv2.imread('/inputs/x.png')", dir)).toBe(
      "cv2.imread('/tmp/ai/inputs/x.png')",
    );
    expect(rewriteInputsPath('os.listdir("/inputs")', dir)).toBe('os.listdir("/tmp/ai/inputs")');
  });

  it('rewrites every occurrence', () => {
    const out = rewriteInputsPath("a='/inputs/a.png'\nb='/inputs/b.png'", dir);
    expect(out).toBe("a='/tmp/ai/inputs/a.png'\nb='/tmp/ai/inputs/b.png'");
  });

  it('leaves identifiers and unrelated paths that only contain the segment alone', () => {
    expect(rewriteInputsPath("open('/inputs2/x')", dir)).toBe("open('/inputs2/x')");
    expect(rewriteInputsPath("open('/home/u/inputs/x')", dir)).toBe("open('/home/u/inputs/x')");
  });

  it('is a no-op when the mount dir is the virtual root', () => {
    const code = "cv2.imread('/inputs/x.png')";
    expect(rewriteInputsPath(code, '/inputs')).toBe(code);
  });
});
