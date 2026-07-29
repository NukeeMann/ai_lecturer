// Verifies that `useKernel`'s engine returns RunResult / RunWithTestsResult
// shapes identical to `usePyodide` (US-199), driving a fully mocked transport
// so no real kernel / HTTP is involved. Covers stdout, stderr, image (png),
// error (traceback/errorType/errorMessage), and stop/timeout parity.
import { describe, expect, it, vi } from 'vitest';

import {
  KernelClient,
  KernelStopError,
  KernelRequestError,
  aggregateRunEvents,
  extractHarnessPayload,
  isRuntimeNotInstalled,
  type KernelRunEvent,
  type KernelTransport,
  type KernelSessionKey,
} from './client';
import { KERNEL_TEST_RESULT_MARKER, buildTestHarness } from './kernelPython';

const SESSION: KernelSessionKey = {
  courseSlug: 'c',
  lessonSlug: 'l',
  sectionId: 's',
};

/** Build a transport whose `run` replays a fixed list of events. */
function transportFromEvents(
  events: KernelRunEvent[],
  control?: KernelTransport['control'],
): KernelTransport {
  return {
    async run(_req, onEvent) {
      for (const e of events) onEvent(e);
    },
    control: control ?? (async () => {}),
  };
}

/** Encode an object the way the harness does, for runWithTests fixtures. */
function encodeHarnessOutput(out: unknown): string {
  return `${KERNEL_TEST_RESULT_MARKER}${Buffer.from(
    JSON.stringify(out),
    'utf-8',
  ).toString('base64')}`;
}

describe('aggregateRunEvents', () => {
  it('captures stdout and stderr from stream + final events', () => {
    const agg = aggregateRunEvents([
      { type: 'stream', name: 'stdout', text: 'hello\n' },
      { type: 'stream', name: 'stderr', text: 'warn\n' },
      { type: 'final', stdout: 'hello\n', stderr: 'warn\n', status: 'ok' },
    ]);
    expect(agg.stdout).toBe('hello\n');
    expect(agg.stderr).toBe('warn\n');
    expect(agg.status).toBe('ok');
  });

  it('falls back to streamed buffers when final omits them', () => {
    const agg = aggregateRunEvents([
      { type: 'stream', name: 'stdout', text: 'a' },
      { type: 'stream', name: 'stdout', text: 'b' },
    ]);
    expect(agg.stdout).toBe('ab');
  });

  it('collects display_data and execute_result images', () => {
    const agg = aggregateRunEvents([
      { type: 'display', png: 'AAAA' },
      { type: 'result', png: 'BBBB' },
    ]);
    expect(agg.images).toEqual(['AAAA', 'BBBB']);
  });

  it('surfaces error fields from the final event', () => {
    const agg = aggregateRunEvents([
      {
        type: 'final',
        stdout: '',
        stderr: '',
        traceback: 'Traceback...\nValueError: boom',
        errorType: 'ValueError',
        errorMessage: 'boom',
        status: 'error',
      },
    ]);
    expect(agg.errorType).toBe('ValueError');
    expect(agg.errorMessage).toBe('boom');
    expect(agg.traceback).toContain('ValueError: boom');
  });
});

describe('extractHarnessPayload', () => {
  it('strips the sentinel line and decodes the payload', () => {
    const out = {
      testResults: [
        { name: 't1', passed: true, traceback: null, assertionDetail: null },
      ],
      png: null,
    };
    const stdout = `user line 1\nuser line 2\n${encodeHarnessOutput(out)}`;
    const parsed = extractHarnessPayload(stdout);
    expect(parsed.stdout).toBe('user line 1\nuser line 2\n');
    expect(parsed.payload?.testResults).toHaveLength(1);
    expect(parsed.payload?.testResults[0].passed).toBe(true);
  });

  it('returns null payload when no sentinel is present', () => {
    const parsed = extractHarnessPayload('just output\n');
    expect(parsed.payload).toBeNull();
    expect(parsed.stdout).toBe('just output\n');
  });
});

describe('KernelClient.run', () => {
  it('returns a RunResult mirroring stdout/stderr', async () => {
    const client = new KernelClient(
      SESSION,
      transportFromEvents([
        { type: 'stream', name: 'stdout', text: '42\n' },
        { type: 'final', stdout: '42\n', stderr: '', status: 'ok' },
      ]),
    );
    const result = await client.run('print(42)');
    expect(result).toEqual({ stdout: '42\n', stderr: '' });
    expect(client.getSnapshot()).toBe('ready');
  });

  it('returns traceback/errorType/errorMessage on a Python error', async () => {
    const client = new KernelClient(
      SESSION,
      transportFromEvents([
        {
          type: 'final',
          stdout: '',
          stderr: '',
          traceback: 'Traceback (most recent call last):\nValueError: nope',
          errorType: 'ValueError',
          errorMessage: 'nope',
          status: 'error',
        },
      ]),
    );
    const result = await client.run('raise ValueError("nope")');
    expect(result.errorType).toBe('ValueError');
    expect(result.errorMessage).toBe('nope');
    expect(result.traceback).toContain('ValueError: nope');
  });

  it('streams incremental output through onStream', async () => {
    const client = new KernelClient(
      SESSION,
      transportFromEvents([
        { type: 'stream', name: 'stdout', text: 'a' },
        { type: 'stream', name: 'stdout', text: 'b' },
        { type: 'final', stdout: 'ab', stderr: '', status: 'ok' },
      ]),
    );
    const chunks: string[] = [];
    await client.run('x', undefined, {
      onStream: (c) => chunks.push(c.stdout),
    });
    expect(chunks).toEqual(['a', 'ab']);
  });

  it('moves status idle -> loading -> ready', async () => {
    const seen: string[] = [];
    const client = new KernelClient(
      SESSION,
      transportFromEvents([
        { type: 'final', stdout: '', stderr: '', status: 'ok' },
      ]),
    );
    client.subscribe(() => seen.push(client.getSnapshot()));
    expect(client.getSnapshot()).toBe('idle');
    await client.run('1');
    expect(seen).toContain('loading');
    expect(seen).toContain('ready');
  });
});

describe('KernelClient.runWithTests', () => {
  it('returns RunWithTestsResult with testResults and cleaned stdout', async () => {
    const harnessOut = {
      testResults: [
        { name: 'adds', passed: true, traceback: null, assertionDetail: null },
        {
          name: 'fails',
          passed: false,
          traceback: 'AssertionError',
          assertionDetail: 'expected 2',
        },
      ],
      png: null,
    };
    const client = new KernelClient(
      SESSION,
      transportFromEvents([
        {
          type: 'final',
          stdout: `user output\n${encodeHarnessOutput(harnessOut)}`,
          stderr: '',
          status: 'ok',
        },
      ]),
    );
    const result = await client.runWithTests('code', [
      { name: 'adds', body: 'assert True' },
      { name: 'fails', body: 'assert False' },
    ]);
    expect(result.stdout).toBe('user output\n');
    expect(result.testResults).toHaveLength(2);
    expect(result.testResults[0]).toMatchObject({ name: 'adds', passed: true });
    expect(result.testResults[1]).toMatchObject({
      name: 'fails',
      passed: false,
      assertionDetail: 'expected 2',
    });
    expect(result.png).toBeUndefined();
  });

  it('decodes a captured png into Uint8Array bytes', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const pngB64 = Buffer.from(pngBytes).toString('base64');
    const harnessOut = { testResults: [], png: pngB64 };
    const client = new KernelClient(
      SESSION,
      transportFromEvents([
        {
          type: 'final',
          stdout: encodeHarnessOutput(harnessOut),
          stderr: '',
          status: 'ok',
        },
      ]),
    );
    const result = await client.runWithTests('code', [], {
      captureLiveImage: true,
    });
    expect(result.png).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.png!)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe('stop / timeout parity', () => {
  it('rejects with KernelStopError("user") and fires interrupt on stop', async () => {
    const control = vi.fn(async () => {});
    let started!: () => void;
    const startedP = new Promise<void>((r) => (started = r));
    const transport: KernelTransport = {
      run(_req, _onEvent, signal) {
        started();
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        });
      },
      control,
    };
    const client = new KernelClient(SESSION, transport);
    const runP = client.run('while True: pass');
    await startedP;
    client.stop('user');
    await expect(runP).rejects.toBeInstanceOf(KernelStopError);
    await expect(runP).rejects.toMatchObject({ reason: 'user' });
    expect(control).toHaveBeenCalledWith('interrupt', SESSION);
  });

  it('rejects with KernelStopError("timeout") on a server timeout event', async () => {
    const client = new KernelClient(
      SESSION,
      transportFromEvents([
        { type: 'final', stdout: '', stderr: '', status: 'timeout' },
      ]),
    );
    await expect(client.run('sleep')).rejects.toMatchObject({
      reason: 'timeout',
    });
  });

  it('KernelStopError mirrors PyodideStopError reason union', () => {
    expect(new KernelStopError('user').reason).toBe('user');
    expect(new KernelStopError('timeout').reason).toBe('timeout');
    expect(new KernelStopError('user').name).toBe('KernelStopError');
  });
});

describe('runtime-not-installed error', () => {
  it('flags 503 as runtime-not-installed and sets status error', async () => {
    const transport: KernelTransport = {
      async run() {
        throw new KernelRequestError(503, 'runtime missing', 'kernel_runtime_not_installed');
      },
      async control() {},
    };
    const client = new KernelClient(SESSION, transport);
    await expect(client.run('x')).rejects.toBeInstanceOf(KernelRequestError);
    expect(client.getSnapshot()).toBe('error');
  });

  it('isRuntimeNotInstalled discriminates by status / code', () => {
    expect(isRuntimeNotInstalled(new KernelRequestError(503, 'x'))).toBe(true);
    expect(
      isRuntimeNotInstalled(new KernelRequestError(400, 'x', 'kernel_runtime_not_installed')),
    ).toBe(true);
    expect(isRuntimeNotInstalled(new KernelRequestError(400, 'x'))).toBe(false);
    expect(isRuntimeNotInstalled(new Error('x'))).toBe(false);
  });
});

describe('reset', () => {
  it('issues a reset control to the session by default', async () => {
    const control = vi.fn(async () => {});
    const client = new KernelClient(SESSION, { async run() {}, control });
    await client.reset();
    expect(control).toHaveBeenCalledWith('reset', SESSION);
  });

  it('resets an overridden session key', async () => {
    const control = vi.fn(async () => {});
    const client = new KernelClient(SESSION, { async run() {}, control });
    const other = { courseSlug: 'c2', lessonSlug: 'l2', sectionId: 's2' };
    await client.reset(other);
    expect(control).toHaveBeenCalledWith('reset', other);
  });
});

describe('buildTestHarness', () => {
  it('embeds code/tests as base64 and prints the sentinel', () => {
    const harness = buildTestHarness('print(1)', [
      { name: 't', body: 'assert True' },
    ]);
    expect(harness).toContain(KERNEL_TEST_RESULT_MARKER);
    expect(harness).toContain('b64decode');
    // No raw user code leaks into the harness (it's base64-encoded).
    expect(harness).not.toContain('print(1)');
  });
});
