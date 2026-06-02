import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';

import {
  KernelSessionManager,
  KernelRuntimeNotInstalledError,
  type KernelManagerDeps,
} from '@/lib/server/kernelManager';
import { __setKernelRuntimeDepsForTesting } from '@/lib/server/kernelRuntime';

const BRIDGE = path.join(process.cwd(), 'scripts', 'kernel', 'kernel_bridge.py');

// ---------------------------------------------------------------------------
// Find a python with jupyter_client + ipykernel for the integration tests. The
// US-196 runtime venv may not be provisioned in CI, so we fall back to any
// python on PATH that has the deps. If none is found, the integration block is
// skipped (the fast unit tests below still run everywhere).
// ---------------------------------------------------------------------------
function findKernelPython(): string | null {
  const candidates = [
    process.env.AI_LECTURER_TEST_PYTHON,
    path.join(
      process.env.AI_LECTURER_PY_RUNTIME ?? '',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    ),
    'python3',
    'python',
  ].filter((c): c is string => !!c && c !== 'bin/python' && c !== 'Scripts/python.exe');
  for (const cand of candidates) {
    try {
      const res = spawnSync(cand, ['-c', 'import jupyter_client, ipykernel'], {
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

const KERNEL_PYTHON = findKernelPython();

// ===========================================================================
// Unit tests — no real kernel. Drive a scripted fake bridge so the manager's
// serialization / lifecycle logic is exercised deterministically and fast.
// ===========================================================================

/** A fake bridge child: a plain EventEmitter (so the manager's `instanceof
 *  RealChildProcess` force-kill guard never signals a real pgid). It emits
 *  `ready` on the next tick and answers execute/restart/shutdown with the
 *  matching reply. */
class FakeBridge extends EventEmitter {
  pid = 4242;
  stdin: { write: (s: string) => boolean; destroyed: boolean; end: () => void };
  stdout = new EventEmitter() as EventEmitter & { setEncoding: (e: string) => void };
  stderr = new EventEmitter();
  /** Order in which execute commands were received — proves serialization. */
  executeOrder: number[] = [];
  /** execute ids whose reply has already been emitted. */
  repliedIds: number[] = [];
  killed = false;

  constructor(
    private readonly behavior: {
      onExecute?: (cmd: { id: number; code: string }) => void;
      autoReady?: boolean;
      /** Never reply to execute → simulates a hung cell (timeout path). */
      hangExecute?: boolean;
    } = {},
  ) {
    super();
    this.stdout.setEncoding = () => {};
    this.stdin = {
      destroyed: false,
      end: () => {},
      write: (s: string) => {
        for (const line of s.split('\n')) {
          if (line.trim()) this.handle(JSON.parse(line));
        }
        return true;
      },
    };
    if (behavior.autoReady !== false) {
      setImmediate(() => this.emitLine({ type: 'ready' }));
    }
  }

  emitLine(obj: unknown): void {
    this.stdout.emit('data', JSON.stringify(obj) + '\n');
  }

  private handle(cmd: { type: string; id?: number; code?: string }): void {
    if (cmd.type === 'execute') {
      this.executeOrder.push(cmd.id!);
      this.behavior.onExecute?.({ id: cmd.id!, code: cmd.code ?? '' });
      if (this.behavior.hangExecute) return; // never replies → hung cell
      // Default: echo a deterministic reply on the next tick.
      setImmediate(() => {
        this.repliedIds.push(cmd.id!);
        this.emitLine({
          type: 'execute_reply',
          id: cmd.id,
          status: 'ok',
          stdout: `ran:${cmd.code}`,
          stderr: '',
          result: null,
          error: null,
        });
      });
    } else if (cmd.type === 'restart') {
      setImmediate(() => this.emitLine({ type: 'restart_reply', id: cmd.id }));
    } else if (cmd.type === 'shutdown') {
      setImmediate(() => {
        this.emitLine({ type: 'shutdown_reply', id: cmd.id });
      });
    } else if (cmd.type === 'interrupt') {
      this.emit('__interrupt__');
    }
  }

  kill(): boolean {
    this.killed = true;
    setImmediate(() => this.emit('close', null, 'SIGKILL'));
    return true;
  }
}

function fakeSpawnReturning(bridges: FakeBridge[]): KernelManagerDeps['spawn'] {
  let i = 0;
  return (() => {
    const b = bridges[Math.min(i, bridges.length - 1)];
    i += 1;
    return b as unknown as ReturnType<NonNullable<KernelManagerDeps['spawn']>>;
  }) as unknown as KernelManagerDeps['spawn'];
}

/** Construct a fresh FakeBridge at spawn time (so its `ready` fires *after* the
 *  session has subscribed to its stdout). */
function fakeSpawnFactory(
  makers: (() => FakeBridge)[],
): KernelManagerDeps['spawn'] {
  let i = 0;
  return (() => {
    const make = makers[Math.min(i, makers.length - 1)];
    i += 1;
    return make() as unknown as ReturnType<NonNullable<KernelManagerDeps['spawn']>>;
  }) as unknown as KernelManagerDeps['spawn'];
}

describe('KernelSessionManager — unit (scripted fake bridge)', () => {
  afterEach(() => {
    __setKernelRuntimeDepsForTesting(null);
  });

  it('spawns one kernel per (course, lesson), reused across executions', async () => {
    const bridge = new FakeBridge();
    const mgr = new KernelSessionManager(
      {},
      { spawn: fakeSpawnReturning([bridge]), resolvePython: async () => 'py' },
    );
    const r1 = await mgr.execute('course-a', 'lesson-1', 'print(1)');
    const r2 = await mgr.execute('course-a', 'lesson-1', 'print(2)');
    expect(r1.status).toBe('ok');
    expect(r1.stdout).toBe('ran:print(1)');
    expect(r2.stdout).toBe('ran:print(2)');
    expect(mgr.sessionCount).toBe(1);
  });

  it('keys distinct sessions by course + lesson', async () => {
    const mgr = new KernelSessionManager(
      {},
      {
        spawn: fakeSpawnFactory([() => new FakeBridge(), () => new FakeBridge()]),
        resolvePython: async () => 'py',
      },
    );
    await mgr.execute('course-a', 'lesson-1', 'x');
    await mgr.execute('course-a', 'lesson-2', 'y');
    expect(mgr.sessionCount).toBe(2);
    expect(mgr.hasSession('course-a', 'lesson-1')).toBe(true);
    expect(mgr.hasSession('course-a', 'lesson-2')).toBe(true);
  });

  it('serializes concurrent executions on one session (no interleaving)', async () => {
    // The manager must not send execute #2 until #1's reply has come back. The
    // onExecute hook asserts that invariant at the moment each command lands.
    const bridge = new FakeBridge({
      onExecute: (cmd) => {
        if (cmd.id === 2) {
          // #2 only arrives after #1 already replied.
          expect(bridge.repliedIds).toContain(1);
        }
      },
    });
    const mgr = new KernelSessionManager(
      {},
      { spawn: fakeSpawnReturning([bridge]), resolvePython: async () => 'py' },
    );
    const p1 = mgr.execute('c', 'l', 'one');
    const p2 = mgr.execute('c', 'l', 'two');
    await Promise.all([p1, p2]);
    expect(bridge.executeOrder).toEqual([1, 2]);
  });

  it('propagates KernelRuntimeNotInstalledError when the runtime is missing', async () => {
    // Default resolvePython → requireKernelRuntime(); force pythonExists=false.
    __setKernelRuntimeDepsForTesting({
      pythonExists: async () => false,
      cudaMarkerExists: async () => false,
    });
    const mgr = new KernelSessionManager(); // default deps → real requireKernelRuntime
    await expect(mgr.execute('c', 'l', 'print(1)')).rejects.toBeInstanceOf(
      KernelRuntimeNotInstalledError,
    );
    expect(mgr.sessionCount).toBe(0);
  });

  it('force-kills and reports timeout when an execution overruns', async () => {
    // A bridge that never replies to execute → manager hits executionTimeoutMs.
    const bridge = new FakeBridge({ hangExecute: true });
    const mgr = new KernelSessionManager(
      { executionTimeoutMs: 80 },
      { spawn: fakeSpawnReturning([bridge]), resolvePython: async () => 'py' },
    );
    const res = await mgr.execute('c', 'l', 'while True: pass');
    expect(res.status).toBe('timeout');
    expect(bridge.killed).toBe(true);
    // session was torn down → next execute would spawn anew
    expect(mgr.sessionCount).toBe(0);
  });
});

// ===========================================================================
// Integration tests — a REAL lightweight IPython kernel. Verifies the full
// execute / interrupt / restart / reap cycle (the core US-197 AC). Skipped
// only when no python with jupyter_client + ipykernel is available.
// ===========================================================================

const itk = KERNEL_PYTHON ? it : it.skip;

describe('KernelSessionManager — integration (real IPython kernel)', () => {
  let mgr: KernelSessionManager;

  beforeEach(() => {
    // Long idle TTL so slow real-kernel ops between steps don't get reaped; the
    // reap test below uses its own short-TTL manager.
    mgr = new KernelSessionManager(
      { idleTtlMs: 60000, executionTimeoutMs: 4000, startupTimeoutMs: 60000 },
      {
        resolvePython: async () => KERNEL_PYTHON as string,
        bridgeScriptPath: BRIDGE,
      },
    );
  });

  afterEach(async () => {
    await mgr.shutdownAll();
  });

  itk(
    'executes code, captures stdout + result, and persists the namespace',
    async () => {
      const r1 = await mgr.execute('intg', 'lesson', 'a = 19 + 2\nprint("hi", a)\na');
      expect(r1.status).toBe('ok');
      expect(r1.stdout).toContain('hi 21');
      expect(r1.result).toBe('21');
      // namespace persists across executions on the SAME session
      const r2 = await mgr.execute('intg', 'lesson', 'print(a + 100)');
      expect(r2.stdout).toContain('121');
      expect(mgr.sessionCount).toBe(1);
    },
    90000,
  );

  itk(
    'surfaces Python errors with ename/evalue',
    async () => {
      const r = await mgr.execute('intg', 'lesson', 'raise ValueError("boom")');
      expect(r.status).toBe('error');
      expect(r.error?.ename).toBe('ValueError');
      expect(r.error?.evalue).toBe('boom');
    },
    90000,
  );

  itk(
    'interrupt (SIGINT) stops a long-running cell with KeyboardInterrupt',
    async () => {
      // Warm the kernel up first so the interrupt below is timed against a
      // running cell, not against (slow, under-load) kernel startup.
      await mgr.execute('intg', 'lesson', 'import time');
      const pending = mgr.execute(
        'intg',
        'lesson',
        'while True:\n    time.sleep(0.05)',
      );
      // The kernel is warm; give the loop a beat to start, then interrupt.
      await new Promise((r) => setTimeout(r, 500));
      await mgr.interrupt('intg', 'lesson');
      const r = await pending;
      expect(r.status).toBe('error');
      expect(r.error?.ename).toBe('KeyboardInterrupt');
      // Kernel survives an interrupt — still usable afterwards.
      const after = await mgr.execute('intg', 'lesson', 'print(2 + 2)');
      expect(after.stdout).toContain('4');
    },
    90000,
  );

  itk(
    'restart wipes the kernel namespace',
    async () => {
      await mgr.execute('intg', 'lesson', 'secret = 12345');
      await mgr.restart('intg', 'lesson');
      const r = await mgr.execute(
        'intg',
        'lesson',
        'print("secret" in dir())',
      );
      expect(r.stdout).toContain('False');
      // Same session object is reused after restart.
      expect(mgr.sessionCount).toBe(1);
    },
    90000,
  );

  itk(
    'reaps an idle kernel after the TTL elapses',
    async () => {
      const reapMgr = new KernelSessionManager(
        { idleTtlMs: 600, startupTimeoutMs: 60000 },
        {
          resolvePython: async () => KERNEL_PYTHON as string,
          bridgeScriptPath: BRIDGE,
        },
      );
      try {
        await reapMgr.execute('intg', 'reap', '1 + 1');
        expect(reapMgr.sessionCount).toBe(1);
        // idleTtlMs is 600ms; wait past it and the kernel should be reaped.
        await new Promise((r) => setTimeout(r, 2500));
        expect(reapMgr.sessionCount).toBe(0);
      } finally {
        await reapMgr.shutdownAll();
      }
    },
    90000,
  );

  itk(
    'force-kills a kernel whose execution exceeds the timeout',
    async () => {
      // executionTimeoutMs is 4000ms; an infinite loop must be force-killed.
      const r = await mgr.execute(
        'intg',
        'lesson',
        'while True:\n    pass',
      );
      expect(r.status).toBe('timeout');
      expect(mgr.sessionCount).toBe(0);
    },
    90000,
  );
});
