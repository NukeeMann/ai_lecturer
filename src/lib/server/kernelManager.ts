// US-197: server-only IPython kernel manager.
//
// Owns one real IPython kernel *per lesson session* (keyed by courseSlug +
// lessonSlug) so the Code/Sandbox widgets execute in a persistent,
// interruptible Python process instead of Pyodide-in-the-browser. Each kernel
// runs inside the US-196 runtime venv (torch / tensorflow / opencv) and is
// driven through a small Python bridge (`scripts/kernel/kernel_bridge.py`),
// spawned with the same `child_process` discipline as `src/lib/server/stt.ts`
// and `regenerateLesson.ts`.
//
// Lifecycle / guarantees:
//   - One kernel per (courseSlug, lessonSlug); reused across executions; idle
//     kernels reaped after `idleTtlMs`.
//   - `execute` / `interrupt` (SIGINT, via jupyter_client) / `restart` /
//     `shutdown`. An execution that overruns `executionTimeoutMs` force-kills
//     the kernel *process group* (the bridge is spawned `detached: true`, the
//     kernel is its child, so a group SIGKILL reaps both — same pattern as
//     `killChildTree` in generation.ts).
//   - Executions are serialized per session via a promise-chain mutex so two
//     runs never interleave on one kernel. `interrupt` deliberately bypasses
//     the mutex (it must land mid-execution).
//   - When the runtime from US-196 is missing, the first spawn attempt throws
//     `KernelRuntimeNotInstalledError` (re-exported here for callers).

import {
  spawn as defaultSpawn,
  type ChildProcess,
  ChildProcess as RealChildProcess,
} from 'node:child_process';
import path from 'node:path';

import { assertSafeSlug } from '@/lib/server/paths';
import {
  requireKernelRuntime,
  KernelRuntimeNotInstalledError,
} from '@/lib/server/kernelRuntime';

export { KernelRuntimeNotInstalledError };

/** Raised when the kernel bridge fails to come up (import error, kernel start
 *  timeout, or the bridge process exits before emitting `ready`). */
export class KernelStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelStartError';
  }
}

/** Raised when a kernel session has gone away (force-killed on timeout, reaped,
 *  or the bridge exited) while an operation was in flight. */
export class KernelDeadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelDeadError';
  }
}

export interface KernelError {
  ename: string;
  evalue: string;
  traceback: string[];
}

export type KernelExecuteStatus = 'ok' | 'error' | 'timeout';

export interface KernelExecuteResult {
  status: KernelExecuteStatus;
  stdout: string;
  stderr: string;
  /** The `text/plain` repr of the cell's last expression, when there is one. */
  result: string | null;
  /** Populated when `status === 'error'`. */
  error: KernelError | null;
  /** Base64 PNG images captured from display_data / execute_result (US-201). */
  images: string[];
}

export interface KernelManagerOptions {
  /** Reap a kernel that has not executed anything for this long. Default 10min. */
  idleTtlMs?: number;
  /** Force-kill the kernel if a single execution exceeds this. Default 30s. */
  executionTimeoutMs?: number;
  /** Time allowed for the kernel + channels to become ready (and to restart).
   *  Default 60s. */
  startupTimeoutMs?: number;
}

export interface KernelManagerDeps {
  spawn?: typeof defaultSpawn;
  /** Resolve the Python interpreter that runs the bridge (and therefore the
   *  kernel). Defaults to the US-196 runtime venv python, throwing
   *  `KernelRuntimeNotInstalledError` when it is missing. Overridable for
   *  integration tests that point at any python with jupyter_client +
   *  ipykernel installed. */
  resolvePython?: () => Promise<string>;
  /** Path to the bridge script. Default: `scripts/kernel/kernel_bridge.py`. */
  bridgeScriptPath?: string;
}

const DEFAULT_IDLE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 30 * 1000;
const DEFAULT_STARTUP_TIMEOUT_MS = 60 * 1000;

export function defaultBridgeScriptPath(): string {
  return path.join(process.cwd(), 'scripts', 'kernel', 'kernel_bridge.py');
}

/** Session key — both slugs are validated (path-traversal safe, so neither can
 *  contain `/`) then joined on `/` so distinct (course, lesson) pairs never
 *  collide. */
function sessionKey(courseSlug: string, lessonSlug: string): string {
  assertSafeSlug(courseSlug);
  assertSafeSlug(lessonSlug);
  return `${courseSlug}/${lessonSlug}`;
}

interface BridgeMessage {
  type: string;
  id?: number | null;
  error?: string;
  status?: KernelExecuteStatus;
  stdout?: string;
  stderr?: string;
  result?: string | null;
  images?: string[];
}

/** Sentinel thrown internally when a `sendAndWait` exceeds its deadline. */
class PendingTimeout extends Error {}

/**
 * A single live kernel: the bridge child process plus the bookkeeping needed to
 * serialize commands, match replies, and reap on idle. Not exported — callers
 * go through `KernelSessionManager`.
 */
class KernelSession {
  private child: ChildProcess;
  private stdoutBuf = '';
  private cmdSeq = 0;
  private pending: ((msg: BridgeMessage) => void) | null = null;
  /** Promise chain implementing the per-session execution mutex. */
  private tail: Promise<unknown> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private exited = false;

  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    child: ChildProcess,
    private readonly opts: Required<KernelManagerOptions>,
    private readonly onDead: () => void,
  ) {
    this.child = child;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    if (!child.stdin || !child.stdout) {
      this.fail(new KernelStartError('kernel bridge stdio is not piped'));
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    // stderr carries only diagnostics (e.g. debugger banners); drain it so the
    // pipe never fills and blocks the child.
    child.stderr?.on('data', () => {});
    child.on('error', (err) =>
      this.fail(new KernelStartError(`kernel bridge spawn error: ${err.message}`)),
    );
    child.on('close', () => this.onExit());

    this.readyTimer = setTimeout(() => {
      this.fail(
        new KernelStartError(
          `kernel did not become ready within ${this.opts.startupTimeoutMs}ms`,
        ),
      );
    }, this.opts.startupTimeoutMs);
  }

  private clearReadyTimer(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf('\n')) >= 0) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let msg: BridgeMessage;
      try {
        msg = JSON.parse(line) as BridgeMessage;
      } catch {
        continue; // ignore non-JSON noise
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: BridgeMessage): void {
    if (msg.type === 'ready') {
      this.clearReadyTimer();
      this.resolveReady();
      return;
    }
    if (msg.type === 'fatal') {
      this.fail(new KernelStartError(msg.error ?? 'kernel bridge reported fatal error'));
      return;
    }
    // execute_reply / restart_reply / shutdown_reply — hand to the waiter.
    const waiter = this.pending;
    if (waiter) {
      this.pending = null;
      waiter(msg);
    }
  }

  private onExit(): void {
    if (this.exited) return;
    this.exited = true;
    this.clearReadyTimer();
    this.clearIdleTimer();
    // Unblock anyone waiting on startup or a reply.
    this.rejectReady(new KernelDeadError('kernel exited'));
    const waiter = this.pending;
    if (waiter) {
      this.pending = null;
      waiter({ type: '__dead__' });
    }
    this.onDead();
  }

  /** Abort startup with `err`, then tear the process down. */
  private fail(err: Error): void {
    this.clearReadyTimer();
    this.rejectReady(err);
    this.forceKill();
  }

  private write(obj: unknown): boolean {
    if (this.exited || !this.child.stdin || this.child.stdin.destroyed) return false;
    try {
      return this.child.stdin.write(JSON.stringify(obj) + '\n');
    } catch {
      return false;
    }
  }

  /** Send a command and resolve with the bridge's next reply. Rejects with
   *  `PendingTimeout` if `timeoutMs` elapses, or `KernelDeadError` if the
   *  bridge dies first. */
  private sendAndWait(obj: unknown, timeoutMs: number): Promise<BridgeMessage> {
    return new Promise<BridgeMessage>((resolve, reject) => {
      if (this.exited) {
        reject(new KernelDeadError('kernel is not running'));
        return;
      }
      let timer: ReturnType<typeof setTimeout> | null = null;
      this.pending = (msg) => {
        if (timer) clearTimeout(timer);
        if (msg.type === '__dead__') {
          reject(new KernelDeadError('kernel exited mid-execution'));
        } else {
          resolve(msg);
        }
      };
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending = null;
          reject(new PendingTimeout());
        }, timeoutMs);
      }
      if (!this.write(obj)) {
        if (timer) clearTimeout(timer);
        this.pending = null;
        reject(new KernelDeadError('failed to write to kernel stdin'));
      }
    });
  }

  /** Run `fn` after every previously-queued operation on this session has
   *  settled — the per-session serialization guarantee. */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.opts.idleTtlMs > 0) {
      this.idleTimer = setTimeout(() => {
        void this.reap();
      }, this.opts.idleTtlMs);
      // Don't let an idle kernel keep the process alive.
      this.idleTimer.unref?.();
    }
  }

  async execute(code: string): Promise<KernelExecuteResult> {
    return this.runExclusive(async () => {
      await this.ready;
      this.resetIdleTimer();
      const id = ++this.cmdSeq;
      let reply: BridgeMessage;
      try {
        reply = await this.sendAndWait(
          { type: 'execute', id, code },
          this.opts.executionTimeoutMs,
        );
      } catch (err) {
        if (err instanceof PendingTimeout) {
          // Force-kill the whole kernel group; the session is now dead.
          this.forceKill();
          return {
            status: 'timeout',
            stdout: '',
            stderr: '',
            result: null,
            error: null,
            images: [],
          };
        }
        throw err;
      }
      this.resetIdleTimer();
      return {
        status: reply.status ?? 'ok',
        stdout: reply.stdout ?? '',
        stderr: reply.stderr ?? '',
        result: reply.result ?? null,
        error: (reply as { error?: KernelError | null }).error ?? null,
        images: reply.images ?? [],
      };
    });
  }

  /** Interrupt the running cell (jupyter_client → SIGINT). Fire-and-forget and
   *  intentionally NOT serialized — it must reach the bridge while an execute
   *  holds the mutex. */
  interrupt(): void {
    if (this.exited) return;
    this.resetIdleTimer();
    this.write({ type: 'interrupt' });
  }

  async restart(): Promise<void> {
    return this.runExclusive(async () => {
      await this.ready;
      const id = ++this.cmdSeq;
      await this.sendAndWait({ type: 'restart', id }, this.opts.startupTimeoutMs);
      this.resetIdleTimer();
    });
  }

  /** Clear the kernel's user namespace in place (no restart). */
  async reset(): Promise<void> {
    return this.runExclusive(async () => {
      await this.ready;
      const id = ++this.cmdSeq;
      await this.sendAndWait({ type: 'reset', id }, this.opts.executionTimeoutMs);
      this.resetIdleTimer();
    });
  }

  /** Graceful shutdown: ask the bridge to stop the kernel, then ensure the
   *  process is gone. */
  async shutdown(): Promise<void> {
    if (this.exited) return;
    this.clearIdleTimer();
    try {
      await this.runExclusive(async () => {
        if (this.exited) return;
        await this.sendAndWait({ type: 'shutdown', id: ++this.cmdSeq }, 5000);
      });
    } catch {
      // best-effort; fall through to force-kill
    }
    this.forceKill();
  }

  /** Idle-reap path: same as a graceful shutdown. */
  private async reap(): Promise<void> {
    await this.shutdown();
  }

  /**
   * SIGKILL the kernel process group. The bridge is launched `detached: true`,
   * so its pid is the process-group id and the kernel (its child) is in the
   * same group — `process.kill(-pid)` reaps both. The `instanceof
   * RealChildProcess` gate keeps test mocks (plain EventEmitters) from
   * signalling a real pgid on the test runner — mirrors `killChildTree` in
   * generation.ts.
   */
  forceKill(): void {
    this.clearReadyTimer();
    this.clearIdleTimer();
    const pid = this.child.pid;
    if (this.child instanceof RealChildProcess && typeof pid === 'number') {
      try {
        process.kill(-pid, 'SIGKILL');
        this.onExit();
        return;
      } catch {
        /* group kill failed (already gone / non-POSIX) — fall through */
      }
    }
    try {
      this.child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    this.onExit();
  }

  get isAlive(): boolean {
    return !this.exited;
  }
}

/**
 * Manages the pool of per-session kernels. A single long-lived instance
 * (`kernelManager`) is exported for app use; tests can construct their own with
 * injected `deps` / shorter timeouts.
 */
export class KernelSessionManager {
  private readonly sessions = new Map<string, KernelSession>();
  /** In-flight spawns, so concurrent `execute`s for one key share a kernel
   *  instead of racing into two. */
  private readonly creating = new Map<string, Promise<KernelSession>>();
  private readonly opts: Required<KernelManagerOptions>;
  private readonly spawnFn: typeof defaultSpawn;
  private readonly resolvePython: () => Promise<string>;
  private readonly bridgeScriptPath: string;

  constructor(options: KernelManagerOptions = {}, deps: KernelManagerDeps = {}) {
    this.opts = {
      idleTtlMs: options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS,
      executionTimeoutMs: options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
      startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    };
    this.spawnFn = deps.spawn ?? defaultSpawn;
    this.resolvePython =
      deps.resolvePython ?? (async () => (await requireKernelRuntime()).pythonPath);
    this.bridgeScriptPath = deps.bridgeScriptPath ?? defaultBridgeScriptPath();
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  hasSession(courseSlug: string, lessonSlug: string): boolean {
    return this.sessions.has(sessionKey(courseSlug, lessonSlug));
  }

  /** Spawn the bridge for `key` (throws `KernelRuntimeNotInstalledError` when
   *  the runtime is missing) and register the session. */
  private async createSession(key: string): Promise<KernelSession> {
    const python = await this.resolvePython();
    const child = this.spawnFn(python, [this.bridgeScriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Own process group so a timeout/force-kill can reap the kernel child too.
      detached: true,
      env: {
        ...process.env,
        AI_LECTURER_KERNEL_READY_TIMEOUT: String(
          Math.ceil(this.opts.startupTimeoutMs / 1000),
        ),
      },
    });
    const session = new KernelSession(child, this.opts, () => {
      // Only forget this session if it's still the registered one (a restart
      // never swaps the object, but a race with a fresh create might).
      if (this.sessions.get(key) === session) this.sessions.delete(key);
    });
    this.sessions.set(key, session);
    return session;
  }

  private async getOrCreate(
    courseSlug: string,
    lessonSlug: string,
  ): Promise<KernelSession> {
    const key = sessionKey(courseSlug, lessonSlug);
    const existing = this.sessions.get(key);
    if (existing && existing.isAlive) return existing;
    const inflight = this.creating.get(key);
    if (inflight) return inflight;
    const p = this.createSession(key).finally(() => this.creating.delete(key));
    this.creating.set(key, p);
    return p;
  }

  async execute(
    courseSlug: string,
    lessonSlug: string,
    code: string,
  ): Promise<KernelExecuteResult> {
    const session = await this.getOrCreate(courseSlug, lessonSlug);
    return session.execute(code);
  }

  async interrupt(courseSlug: string, lessonSlug: string): Promise<void> {
    const session = this.sessions.get(sessionKey(courseSlug, lessonSlug));
    session?.interrupt();
  }

  async restart(courseSlug: string, lessonSlug: string): Promise<void> {
    const session = await this.getOrCreate(courseSlug, lessonSlug);
    return session.restart();
  }

  /** Clear the namespace of an existing session (no-op if none is running). */
  async reset(courseSlug: string, lessonSlug: string): Promise<void> {
    const session = this.sessions.get(sessionKey(courseSlug, lessonSlug));
    if (!session || !session.isAlive) return;
    return session.reset();
  }

  async shutdown(courseSlug: string, lessonSlug: string): Promise<void> {
    const key = sessionKey(courseSlug, lessonSlug);
    const session = this.sessions.get(key);
    if (!session) return;
    await session.shutdown();
    this.sessions.delete(key);
  }

  async shutdownAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((s) => s.shutdown()));
  }
}

/** Process-wide default manager used by the Code/Sandbox execution endpoints. */
export const kernelManager = new KernelSessionManager();
