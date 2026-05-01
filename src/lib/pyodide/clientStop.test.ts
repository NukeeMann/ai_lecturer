// Verifies the worker stop / restart / timeout contract added in US-039.
// Uses a mock Worker so the singleton can be exercised in node — the real
// worker is a Web Worker and never instantiates here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockWorker {
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  terminated = false;
  postedMessages: unknown[] = [];
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ||= []).push(fn);
  }
  postMessage(msg: unknown) {
    this.postedMessages.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  fire(type: string, event: unknown) {
    (this.listeners[type] || []).forEach((fn) => fn(event));
  }
}

const created: MockWorker[] = [];

beforeEach(() => {
  created.length = 0;
  // Pretend to be a browser environment: the singleton bails on
  // `typeof window === 'undefined'` and uses window.setTimeout.
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { Worker: unknown }).Worker = function () {
    const w = new MockWorker();
    created.push(w);
    return w as unknown as Worker;
  } as unknown as typeof Worker;
});

afterEach(async () => {
  // Reset module state between tests so each test starts singleton-less.
  const mod = await import('./client');
  mod.__test.reset();
  delete (globalThis as unknown as Record<string, unknown>).Worker;
  delete (globalThis as unknown as Record<string, unknown>).window;
  vi.useRealTimers();
});

describe('PyodideStopError', () => {
  it('reports the user reason', async () => {
    const { PyodideStopError } = await import('./client');
    const e = new PyodideStopError('user');
    expect(e.name).toBe('PyodideStopError');
    expect(e.reason).toBe('user');
    expect(e.message).toMatch(/stopped/i);
  });

  it('reports the timeout reason', async () => {
    const { PyodideStopError } = await import('./client');
    const e = new PyodideStopError('timeout');
    expect(e.reason).toBe('timeout');
    expect(e.message).toMatch(/timed out/i);
    expect(e.message).toMatch(/30s/);
  });
});

describe('stopPyodide', () => {
  it('is a no-op when no worker exists', async () => {
    const { stopPyodide } = await import('./client');
    expect(() => stopPyodide('user')).not.toThrow();
    expect(created).toHaveLength(0);
  });

  it('terminates the active worker and spawns a fresh one', async () => {
    const { __test, stopPyodide } = await import('./client');
    __test.ensureWorker();
    expect(created).toHaveLength(1);
    expect(created[0].terminated).toBe(false);

    stopPyodide('user');

    expect(created[0].terminated).toBe(true);
    expect(created).toHaveLength(2); // fresh worker spawned
    expect(created[1].terminated).toBe(false);
  });

  it("flips status to 'loading' on stop", async () => {
    const { __test, stopPyodide } = await import('./client');
    __test.ensureWorker();
    // Simulate the new worker reaching ready before the stop.
    created[0].fire('message', { data: { type: 'ready' } });
    expect(__test.getStatus()).toBe('ready');

    stopPyodide('user');
    expect(__test.getStatus()).toBe('loading');
  });

  it('rejects pending requests with PyodideStopError(reason="user")', async () => {
    const { __test, stopPyodide, PyodideStopError } = await import('./client');
    __test.ensureWorker();
    created[0].fire('message', { data: { type: 'ready' } });

    const pending = __test.call({ type: 'run', code: 'x = 1' });
    // Let the readyPromise.then fire (microtask) so the message is posted
    // and the pending entry is registered.
    await Promise.resolve();
    await Promise.resolve();

    stopPyodide('user');

    await expect(pending).rejects.toBeInstanceOf(PyodideStopError);
    await pending.catch((err) => {
      expect(err.reason).toBe('user');
    });
  });

  it('rejects pending requests with reason="timeout" when called with timeout', async () => {
    const { __test, stopPyodide, PyodideStopError } = await import('./client');
    __test.ensureWorker();
    created[0].fire('message', { data: { type: 'ready' } });

    const pending = __test.call({ type: 'run', code: 'x = 1' });
    await Promise.resolve();
    await Promise.resolve();

    stopPyodide('timeout');

    await expect(pending).rejects.toBeInstanceOf(PyodideStopError);
    await pending.catch((err) => {
      expect(err.reason).toBe('timeout');
    });
  });

  it('notifies restart subscribers with the reason', async () => {
    const { __test, stopPyodide, subscribePyodideRestart } = await import('./client');
    __test.ensureWorker();
    created[0].fire('message', { data: { type: 'ready' } });

    const reasons: string[] = [];
    const off = subscribePyodideRestart((r) => reasons.push(r));

    stopPyodide('user');
    expect(reasons).toEqual(['user']);

    stopPyodide('timeout');
    expect(reasons).toEqual(['user', 'timeout']);

    off();
    stopPyodide('user');
    expect(reasons).toEqual(['user', 'timeout']); // listener removed
  });
});

describe('execution timeout', () => {
  it('auto-stops after the configured timeout', async () => {
    vi.useFakeTimers();
    const { __test, PyodideStopError } = await import('./client');
    __test.ensureWorker();
    created[0].fire('message', { data: { type: 'ready' } });

    const pending = __test.call({ type: 'run', code: 'while True: pass' }, {
      timeoutMs: 100,
    });
    // Let the readyPromise.then microtask register the pending handler.
    await Promise.resolve();
    await Promise.resolve();

    vi.advanceTimersByTime(101);

    await expect(pending).rejects.toBeInstanceOf(PyodideStopError);
    await pending.catch((err) => {
      expect(err.reason).toBe('timeout');
    });
    expect(created[0].terminated).toBe(true);
    expect(created).toHaveLength(2);
  });

  it('does not fire when no timeout is set', async () => {
    vi.useFakeTimers();
    const { __test } = await import('./client');
    __test.ensureWorker();
    created[0].fire('message', { data: { type: 'ready' } });

    let settled = false;
    const pending = __test
      .call({
        type: 'gaussFilter',
        pixels: new Uint8Array(0),
        width: 0,
        height: 0,
        sigma: 0,
      })
      .then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(created[0].terminated).toBe(false);
    void pending;
  });
});

describe('PYODIDE_EXECUTION_TIMEOUT_MS', () => {
  it('defaults to 30 seconds', async () => {
    const { PYODIDE_EXECUTION_TIMEOUT_MS } = await import('./client');
    expect(PYODIDE_EXECUTION_TIMEOUT_MS).toBe(30_000);
  });
});
