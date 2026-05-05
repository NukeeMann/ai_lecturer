/**
 * LessonChat connector — bridges the API route to a backing Claude implementation.
 *
 * Two implementations are tried in order at first use, then cached for the lifetime
 * of the server process:
 *   1. Agent SDK (`@anthropic-ai/claude-agent-sdk`) — uses the user's local Claude
 *      Code subscription. No API key.
 *   2. Subprocess — spawns `claude -p "<prompt>" --output-format json` and parses
 *      the resulting JSON.
 *
 * If neither works, `selectConnector()` returns `null` and the API surfaces a 503.
 *
 * Prompt assembly is intentionally minimal — full lesson-context wiring is US-054.
 */
import { spawn, type ChildProcess } from 'node:child_process';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConnectorRequest {
  /** System prompt — instructions for the assistant. Optional. */
  systemPrompt?: string;
  /** User-facing message body (typically lesson context + question). */
  userMessage: string;
  history?: ChatMessage[];
  /** Per-call override for the subprocess timeout (ms). Falls back to the
   *  connector's factory default when omitted. */
  timeoutMs?: number;
}

export type ConnectorName = 'agent-sdk' | 'subprocess';

export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface Connector {
  readonly name: ConnectorName;
  chat(req: ConnectorRequest): Promise<string>;
  /**
   * Streaming variant of `chat`. Yields per-token chunks until the underlying
   * connector finishes or the abort signal fires. Always finishes with a
   * single `done` event (or `error` on failure). Aborting via `signal` is
   * the canonical way to cancel — the implementation kills the subprocess
   * or breaks out of the SDK iterator.
   */
  chatStream(req: ConnectorRequest, signal: AbortSignal): AsyncIterable<ChatStreamEvent>;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are an AI tutor for an interactive course. Answer concisely.';

export function assemblePrompt(
  userMessage: string,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
): string {
  return `${systemPrompt}\n\n${userMessage}`;
}

// ---------------------------------------------------------------------------
// Subprocess connector
// ---------------------------------------------------------------------------

const SUBPROCESS_TIMEOUT_MS = 60_000;
const SUBPROCESS_KILL_GRACE_MS = 5_000;

export type SpawnFn = typeof spawn;

export interface SubprocessConnectorOptions {
  command?: string;
  spawnFn?: SpawnFn;
  timeoutMs?: number;
  killGraceMs?: number;
}

export function subprocessConnector(
  opts: SubprocessConnectorOptions = {},
): Connector {
  const command = opts.command ?? 'claude';
  const spawnFn = opts.spawnFn ?? spawn;
  const timeoutMs = opts.timeoutMs ?? SUBPROCESS_TIMEOUT_MS;
  const killGraceMs = opts.killGraceMs ?? SUBPROCESS_KILL_GRACE_MS;

  return {
    name: 'subprocess',
    chat(req) {
      const prompt = assemblePrompt(req.userMessage, req.systemPrompt);
      return runClaudeCli(spawnFn, command, prompt, req.timeoutMs ?? timeoutMs, killGraceMs);
    },
    chatStream(req, signal) {
      const prompt = assemblePrompt(req.userMessage, req.systemPrompt);
      return streamClaudeCli(spawnFn, command, prompt, signal, killGraceMs);
    },
  };
}

function runClaudeCli(
  spawnFn: SpawnFn,
  command: string,
  prompt: string,
  timeoutMs: number,
  killGraceMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnFn(command, ['-p', prompt, '--output-format', 'json']);
    } catch (err) {
      reject(new Error(`claude spawn failed: ${(err as Error).message}`));
      return;
    }

    let stdoutBuf = '';
    let stderrBuf = '';
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | null = null;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (killTimer !== null) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      fn();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore — handled by close/error below
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, killGraceMs);
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutBuf += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrBuf += chunk.toString();
    });
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      settle(() => reject(new Error(`claude spawn failed: ${err.message}`)));
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (timedOut) {
        settle(() =>
          reject(new Error(`claude CLI timed out after ${timeoutMs}ms`)),
        );
        return;
      }
      if (code !== 0) {
        const msg = stderrBuf.trim() || stdoutBuf.trim() || `exit code ${code}`;
        settle(() =>
          reject(new Error(`claude exited ${code}: ${msg}`)),
        );
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdoutBuf);
      } catch (err) {
        settle(() =>
          reject(
            new Error(
              `failed to parse claude JSON output: ${(err as Error).message}`,
            ),
          ),
        );
        return;
      }
      if (!parsed || typeof parsed !== 'object') {
        settle(() => reject(new Error('claude JSON output not an object')));
        return;
      }
      const obj = parsed as { result?: unknown; is_error?: unknown };
      if (obj.is_error === true) {
        settle(() =>
          reject(new Error(`claude returned is_error=true: ${stdoutBuf}`)),
        );
        return;
      }
      if (typeof obj.result !== 'string') {
        settle(() =>
          reject(new Error("claude JSON output missing string 'result' field")),
        );
        return;
      }
      settle(() => resolve(obj.result as string));
    });
  });
}

/**
 * Streaming variant: spawns `claude -p "<prompt>"` (NO --output-format) so
 * the assistant text streams to stdout in real time. Reads stdout line by
 * line and emits each line as a `token` event, then a final `done`.
 *
 * Cancellation: when the abort signal fires we kill the child with
 * SIGTERM, then SIGKILL after `killGraceMs`. The async generator returns
 * cleanly without yielding a `done` event so the caller knows the stream
 * was aborted (the route adapter swallows that distinction — it always
 * sends a final `done` to the client after closing the stream).
 */
async function* streamClaudeCli(
  spawnFn: SpawnFn,
  command: string,
  prompt: string,
  signal: AbortSignal,
  killGraceMs: number,
): AsyncGenerator<ChatStreamEvent> {
  let child: ChildProcess;
  try {
    child = spawnFn(command, ['-p', prompt]);
  } catch (err) {
    yield { type: 'error', message: `claude spawn failed: ${(err as Error).message}` };
    return;
  }

  const queue: ChatStreamEvent[] = [];
  let resolveWaiter: (() => void) | null = null;
  let finished = false;
  let aborted = false;
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let killTimer: NodeJS.Timeout | null = null;

  const wake = () => {
    if (resolveWaiter) {
      const r = resolveWaiter;
      resolveWaiter = null;
      r();
    }
  };

  const flushLines = (chunk: string, forceTail: boolean) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split('\n');
    // Keep the trailing partial fragment (no newline yet) in the buffer
    // unless the stream is closing, in which case flush it.
    stdoutBuffer = forceTail ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      if (line.length > 0) {
        queue.push({ type: 'token', text: line + '\n' });
      } else {
        queue.push({ type: 'token', text: '\n' });
      }
    }
    if (forceTail && lines.length === 0 && chunk.length > 0 && !chunk.endsWith('\n')) {
      // chunk had no newlines AND we're forcing tail flush
      queue.push({ type: 'token', text: chunk });
    }
    wake();
  };

  child.stdout?.on('data', (chunk: Buffer | string) => {
    flushLines(chunk.toString(), false);
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderrBuffer += chunk.toString();
  });
  child.on('error', (err: Error) => {
    queue.push({ type: 'error', message: `claude spawn failed: ${err.message}` });
    finished = true;
    wake();
  });
  child.on('close', (code: number | null) => {
    // Flush any trailing partial line.
    if (stdoutBuffer.length > 0) {
      queue.push({ type: 'token', text: stdoutBuffer });
      stdoutBuffer = '';
    }
    if (aborted) {
      // Caller-driven cancel: don't emit `done`, just end.
      finished = true;
      wake();
      return;
    }
    if (code !== 0) {
      const msg = stderrBuffer.trim() || `exit code ${code}`;
      queue.push({ type: 'error', message: `claude exited ${code}: ${msg}` });
    } else {
      queue.push({ type: 'done' });
    }
    finished = true;
    wake();
  });

  const onAbort = () => {
    if (aborted || finished) return;
    aborted = true;
    try {
      child.kill('SIGTERM');
    } catch {
      // already dead
    }
    killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, killGraceMs);
    wake();
  };

  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    while (true) {
      while (queue.length > 0) {
        const ev = queue.shift()!;
        yield ev;
      }
      if (finished) return;
      await new Promise<void>((resolve) => {
        resolveWaiter = resolve;
      });
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (killTimer !== null) {
      clearTimeout(killTimer);
      killTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Agent SDK connector
// ---------------------------------------------------------------------------

interface AgentSdkLike {
  query: (args: { prompt: string }) => AsyncIterable<unknown>;
}

export interface AgentSdkConnectorOptions {
  // Allow tests to inject a fake SDK; production path leaves it undefined and
  // the connector dynamically imports the real package.
  sdk?: AgentSdkLike;
  loadSdk?: () => Promise<AgentSdkLike>;
}

export async function agentSdkConnector(
  opts: AgentSdkConnectorOptions = {},
): Promise<Connector> {
  let sdk: AgentSdkLike;
  if (opts.sdk) {
    sdk = opts.sdk;
  } else {
    const loader =
      opts.loadSdk ??
      (async () => {
        // Dynamic import so a missing package raises here and the caller can
        // fall back to subprocess. The string literal is hidden behind a
        // variable to discourage Next/webpack from trying to bundle it
        // statically.
        const mod = '@anthropic-ai/claude-agent-sdk';
        return (await import(/* webpackIgnore: true */ mod)) as AgentSdkLike;
      });
    sdk = await loader();
  }

  if (typeof sdk.query !== 'function') {
    throw new Error('Agent SDK has unexpected shape: query() not found');
  }

  return {
    name: 'agent-sdk',
    async chat(req) {
      const prompt = assemblePrompt(req.userMessage, req.systemPrompt);
      let assistantText = '';
      let resultFallback = '';
      const stream = sdk.query({ prompt });
      for await (const raw of stream) {
        if (!raw || typeof raw !== 'object') continue;
        const msg = raw as {
          type?: string;
          message?: { content?: Array<{ type?: string; text?: string }> };
          result?: string;
          is_error?: boolean;
        };
        if (msg.type === 'assistant') {
          for (const block of msg.message?.content ?? []) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              assistantText += block.text;
            }
          }
        } else if (msg.type === 'result') {
          if (msg.is_error) {
            throw new Error('Agent SDK returned is_error=true');
          }
          if (typeof msg.result === 'string') {
            resultFallback = msg.result;
          }
        }
      }
      const text = assistantText || resultFallback;
      if (!text) {
        throw new Error('Agent SDK stream produced no assistant text');
      }
      return text;
    },
    async *chatStream(req, signal) {
      const prompt = assemblePrompt(req.userMessage, req.systemPrompt);
      const stream = sdk.query({ prompt });
      const iter = stream[Symbol.asyncIterator]();
      let yieldedAny = false;
      let resultFallback = '';
      try {
        while (true) {
          if (signal.aborted) return;
          const next = await iter.next();
          if (next.done) break;
          const raw = next.value;
          if (!raw || typeof raw !== 'object') continue;
          const msg = raw as {
            type?: string;
            message?: { content?: Array<{ type?: string; text?: string }> };
            result?: string;
            is_error?: boolean;
          };
          if (msg.type === 'assistant') {
            for (const block of msg.message?.content ?? []) {
              if (block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
                yield { type: 'token', text: block.text };
                yieldedAny = true;
              }
            }
          } else if (msg.type === 'result') {
            if (msg.is_error) {
              yield { type: 'error', message: 'Agent SDK returned is_error=true' };
              return;
            }
            if (typeof msg.result === 'string') {
              resultFallback = msg.result;
            }
          }
        }
      } catch (err) {
        if (signal.aborted) return;
        yield { type: 'error', message: (err as Error).message };
        return;
      }
      if (!yieldedAny && resultFallback.length > 0) {
        yield { type: 'token', text: resultFallback };
        yieldedAny = true;
      }
      if (!yieldedAny) {
        yield { type: 'error', message: 'Agent SDK stream produced no assistant text' };
        return;
      }
      yield { type: 'done' };
    },
  };
}

// ---------------------------------------------------------------------------
// Selection — try SDK first, fall back to subprocess. Cached per process.
// ---------------------------------------------------------------------------

interface SelectConnectorOptions {
  forceReselect?: boolean;
  agentSdk?: () => Promise<Connector>;
  subprocess?: () => Connector;
  probeSubprocess?: () => Promise<void>;
  log?: (line: string) => void;
}

let cachedConnector: Connector | null | undefined;

export async function selectConnector(
  opts: SelectConnectorOptions = {},
): Promise<Connector | null> {
  if (!opts.forceReselect && cachedConnector !== undefined) {
    return cachedConnector;
  }

  const log = opts.log ?? ((line: string) => console.log(line));
  const buildAgentSdk = opts.agentSdk ?? (() => agentSdkConnector());
  const buildSubprocess = opts.subprocess ?? (() => subprocessConnector());
  const probe = opts.probeSubprocess ?? probeClaudeCli;

  try {
    cachedConnector = await buildAgentSdk();
    log('[lesson-chat] using Agent SDK connector');
    return cachedConnector;
  } catch (err) {
    log(
      `[lesson-chat] Agent SDK unavailable, trying subprocess: ${
        (err as Error).message
      }`,
    );
  }

  try {
    await probe();
    cachedConnector = buildSubprocess();
    log('[lesson-chat] using subprocess connector');
    return cachedConnector;
  } catch (err) {
    log(
      `[lesson-chat] subprocess unavailable: ${(err as Error).message}`,
    );
    cachedConnector = null;
    return null;
  }
}

function probeClaudeCli(): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn('claude', ['--version']);
    } catch (err) {
      reject(err as Error);
      return;
    }
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      settle(() => reject(new Error('claude --version timed out')));
    }, 5_000);
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      settle(() => reject(err));
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) settle(() => resolve());
      else settle(() => reject(new Error(`claude --version exited ${code}`)));
    });
  });
}

export function _resetConnectorCacheForTesting(): void {
  cachedConnector = undefined;
}
