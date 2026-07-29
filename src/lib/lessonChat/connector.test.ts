import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  _resetConnectorCacheForTesting,
  agentSdkConnector,
  assemblePrompt,
  selectConnector,
  subprocessConnector,
  type ChatStreamEvent,
  type Connector,
  type SpawnFn,
} from './connector';

// ---------------------------------------------------------------------------
// Fake child_process.spawn — emits stdout chunks, then a `close` event.
// ---------------------------------------------------------------------------

interface FakeStdin extends EventEmitter {
  end: ReturnType<typeof vi.fn>;
  written: string;
}

interface FakeProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: FakeStdin;
  kill: ReturnType<typeof vi.fn>;
}

interface FakeProcessConfig {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  // If set, the process never closes on its own — caller must clean up via kill.
  hangs?: boolean;
}

function makeFakeProcess(cfg: FakeProcessConfig): FakeProcess {
  const child = new EventEmitter() as FakeProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stdin = new EventEmitter() as FakeStdin;
  stdin.written = '';
  stdin.end = vi.fn((data?: string) => {
    if (typeof data === 'string') stdin.written += data;
    return stdin;
  });
  child.stdin = stdin;
  child.kill = vi.fn(() => {
    // Simulate that SIGTERM closes the process with a non-zero exit.
    if (cfg.hangs) {
      setImmediate(() => child.emit('close', 143));
    }
    return true;
  });

  setImmediate(() => {
    if (cfg.stdout) child.stdout.emit('data', Buffer.from(cfg.stdout));
    if (cfg.stderr) child.stderr.emit('data', Buffer.from(cfg.stderr));
    if (!cfg.hangs) {
      child.emit('close', cfg.exitCode ?? 0);
    }
  });

  return child;
}

function spawnReturning(cfg: FakeProcessConfig): SpawnFn {
  return (() => makeFakeProcess(cfg)) as unknown as SpawnFn;
}

afterEach(() => {
  _resetConnectorCacheForTesting();
  vi.restoreAllMocks();
});

describe('assemblePrompt', () => {
  it('prefixes the user message with the tutor system instruction', () => {
    const out = assemblePrompt('What is gradient descent?');
    expect(out).toContain('You are an AI tutor');
    expect(out).toContain('Answer concisely');
    expect(out).toContain('What is gradient descent?');
    expect(out.endsWith('What is gradient descent?')).toBe(true);
  });

  it('omits the conversation block when history is empty', () => {
    const out = assemblePrompt('Q?', undefined, []);
    expect(out).not.toContain('Previous conversation');
    expect(out.endsWith('Q?')).toBe(true);
  });

  it('embeds prior turns above the user message when history is provided', () => {
    const out = assemblePrompt(
      'And what about the third one?',
      'SYS',
      [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Second answer' },
      ],
    );
    expect(out).toContain('SYS');
    expect(out).toContain('Previous conversation:');
    expect(out).toContain('User: First question');
    expect(out).toContain('Assistant: First answer');
    expect(out).toContain('User: Second question');
    expect(out).toContain('Assistant: Second answer');
    expect(out.endsWith('And what about the third one?')).toBe(true);
    // Order: system → history → new user message.
    expect(out.indexOf('SYS')).toBeLessThan(out.indexOf('Previous conversation:'));
    expect(out.indexOf('Previous conversation:')).toBeLessThan(
      out.indexOf('And what about the third one?'),
    );
  });
});

describe('subprocessConnector', () => {
  it('parses the result field from JSON stdout', async () => {
    const fakeJson = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Hello from the tutor.',
    });
    const connector = subprocessConnector({
      spawnFn: spawnReturning({ stdout: fakeJson, exitCode: 0 }),
    });
    const text = await connector.chat({ userMessage: 'hi' });
    expect(text).toBe('Hello from the tutor.');
  });

  it('passes -p --output-format json and feeds the prompt via stdin', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const children: FakeProcess[] = [];
    const fakeJson = JSON.stringify({ result: 'ok' });
    const spawnSpy = ((command: string, args: readonly string[]) => {
      calls.push({ command, args });
      const child = makeFakeProcess({ stdout: fakeJson });
      children.push(child);
      return child;
    }) as unknown as SpawnFn;
    const connector = subprocessConnector({ spawnFn: spawnSpy, command: 'claude' });
    await connector.chat({ userMessage: 'why?' });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('claude');
    expect([...calls[0].args]).toEqual(['-p', '--output-format', 'json']);
    expect(children[0].stdin.written).toContain('why?');
    expect(children[0].stdin.end).toHaveBeenCalled();
  });

  it('appends --dangerously-skip-permissions when allowTools is set', async () => {
    const calls: Array<{ args: readonly string[] }> = [];
    const fakeJson = JSON.stringify({ result: 'ok' });
    const spawnSpy = ((_command: string, args: readonly string[]) => {
      calls.push({ args });
      return makeFakeProcess({ stdout: fakeJson });
    }) as unknown as SpawnFn;
    const connector = subprocessConnector({ spawnFn: spawnSpy, command: 'claude' });
    await connector.chat({ userMessage: 'hi', allowTools: true });
    expect([...calls[0].args]).toEqual([
      '-p',
      '--output-format',
      'json',
      '--dangerously-skip-permissions',
    ]);
  });

  it('appends --model <name> when model is set', async () => {
    const calls: Array<{ args: readonly string[] }> = [];
    const fakeJson = JSON.stringify({ result: 'ok' });
    const spawnSpy = ((_command: string, args: readonly string[]) => {
      calls.push({ args });
      return makeFakeProcess({ stdout: fakeJson });
    }) as unknown as SpawnFn;
    const connector = subprocessConnector({ spawnFn: spawnSpy, command: 'claude' });
    await connector.chat({ userMessage: 'hi', model: 'opus' });
    expect([...calls[0].args]).toEqual([
      '-p',
      '--output-format',
      'json',
      '--model',
      'opus',
    ]);
  });

  it('rejects when claude exits non-zero', async () => {
    const connector = subprocessConnector({
      spawnFn: spawnReturning({
        stdout: '',
        stderr: 'authentication failed',
        exitCode: 2,
      }),
    });
    await expect(connector.chat({ userMessage: 'hi' })).rejects.toThrow(
      /claude exited 2.*authentication failed/,
    );
  });

  it('rejects when stdout is not valid JSON', async () => {
    const connector = subprocessConnector({
      spawnFn: spawnReturning({ stdout: 'not json', exitCode: 0 }),
    });
    await expect(connector.chat({ userMessage: 'hi' })).rejects.toThrow(
      /failed to parse claude JSON/,
    );
  });

  it('rejects when JSON is missing the result field', async () => {
    const connector = subprocessConnector({
      spawnFn: spawnReturning({
        stdout: JSON.stringify({ result: null }),
        exitCode: 0,
      }),
    });
    await expect(connector.chat({ userMessage: 'hi' })).rejects.toThrow(
      /missing string 'result'/,
    );
  });

  it('rejects when JSON reports is_error=true', async () => {
    const connector = subprocessConnector({
      spawnFn: spawnReturning({
        stdout: JSON.stringify({ is_error: true, result: 'partial' }),
        exitCode: 0,
      }),
    });
    await expect(connector.chat({ userMessage: 'hi' })).rejects.toThrow(
      /is_error=true/,
    );
  });

  it('kills the process and rejects with timeout when CLI hangs', async () => {
    let killed: NodeJS.Signals | undefined;
    const child = new EventEmitter() as FakeProcess;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn((sig?: NodeJS.Signals) => {
      killed = sig;
      // After SIGTERM, simulate the process actually exits (143 = SIGTERM).
      setImmediate(() => child.emit('close', 143));
      return true;
    });
    const spawnFn = (() => child) as unknown as SpawnFn;

    const connector = subprocessConnector({
      spawnFn,
      timeoutMs: 20,
      killGraceMs: 50,
    });
    await expect(connector.chat({ userMessage: 'hi' })).rejects.toThrow(/timed out/);
    expect(killed).toBe('SIGTERM');
    expect(child.kill).toHaveBeenCalled();
  });

  it('rejects when spawn throws synchronously', async () => {
    const spawnFn = (() => {
      throw new Error('ENOENT');
    }) as unknown as SpawnFn;
    const connector = subprocessConnector({ spawnFn });
    await expect(connector.chat({ userMessage: 'hi' })).rejects.toThrow(
      /spawn failed.*ENOENT/,
    );
  });
});

describe('subprocessConnector.chatStream', () => {
  it('emits each line of stdout as a token event then a done event', async () => {
    const child = new EventEmitter() as FakeProcess;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('Hello, '));
      child.stdout.emit('data', Buffer.from('world.\nNext line.'));
      child.emit('close', 0);
    });
    const spawnFn = (() => child) as unknown as SpawnFn;
    const connector = subprocessConnector({ spawnFn });
    const events = [] as Array<{ type: string; text?: string; message?: string }>;
    const ac = new AbortController();
    for await (const ev of connector.chatStream({ userMessage: 'hi' }, ac.signal)) {
      events.push(ev);
    }
    expect(events.at(-1)).toEqual({ type: 'done' });
    const tokens = events.filter((e) => e.type === 'token').map((e) => e.text).join('');
    expect(tokens).toContain('Hello, world.');
    expect(tokens).toContain('Next line.');
  });

  it('kills the child and ends without `done` when the abort signal fires', async () => {
    const child = new EventEmitter() as FakeProcess;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
      setImmediate(() => child.emit('close', 143));
      return true;
    });
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('partial '));
      child.stdout.emit('data', Buffer.from('answer'));
    });
    const spawnFn = (() => child) as unknown as SpawnFn;
    const connector = subprocessConnector({ spawnFn });
    const ac = new AbortController();
    const events: ChatStreamEvent[] = [];
    const iter = connector.chatStream({ userMessage: 'hi' }, ac.signal)[Symbol.asyncIterator]();
    // Consume one event then abort.
    await new Promise<void>((r) => setTimeout(r, 5));
    ac.abort();
    while (true) {
      const next = await iter.next();
      if (next.done) break;
      events.push(next.value);
    }
    expect(child.kill).toHaveBeenCalled();
    // Should NOT contain a done event since aborted.
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('emits an error event when the CLI exits non-zero', async () => {
    const child = new EventEmitter() as FakeProcess;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    setImmediate(() => {
      child.stderr.emit('data', Buffer.from('boom'));
      child.emit('close', 2);
    });
    const spawnFn = (() => child) as unknown as SpawnFn;
    const connector = subprocessConnector({ spawnFn });
    const events: ChatStreamEvent[] = [];
    const ac = new AbortController();
    for await (const ev of connector.chatStream({ userMessage: 'hi' }, ac.signal)) {
      events.push(ev);
    }
    const errEv = events.find((e) => e.type === 'error');
    expect(errEv).toBeDefined();
    expect((errEv as { message: string }).message).toMatch(/exited 2.*boom/);
  });
});

describe('agentSdkConnector', () => {
  it('collects assistant text blocks from the SDK stream', async () => {
    async function* fakeStream() {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Hello, ' },
            { type: 'text', text: 'world.' },
          ],
        },
      };
      yield { type: 'result', is_error: false, result: 'Hello, world.' };
    }
    const connector = await agentSdkConnector({
      sdk: { query: () => fakeStream() },
    });
    expect(connector.name).toBe('agent-sdk');
    const text = await connector.chat({ userMessage: 'hi' });
    expect(text).toBe('Hello, world.');
  });

  it('falls back to the result field when no assistant blocks were yielded', async () => {
    async function* fakeStream() {
      yield { type: 'result', is_error: false, result: 'Just the result.' };
    }
    const connector = await agentSdkConnector({
      sdk: { query: () => fakeStream() },
    });
    expect(await connector.chat({ userMessage: 'hi' })).toBe('Just the result.');
  });

  it('throws when the stream produces no text', async () => {
    async function* fakeStream() {
      yield { type: 'system' };
    }
    const connector = await agentSdkConnector({
      sdk: { query: () => fakeStream() },
    });
    await expect(connector.chat({ userMessage: 'hi' })).rejects.toThrow(
      /no assistant text/,
    );
  });

  it('throws when the SDK reports is_error=true', async () => {
    async function* fakeStream() {
      yield { type: 'result', is_error: true };
    }
    const connector = await agentSdkConnector({
      sdk: { query: () => fakeStream() },
    });
    await expect(connector.chat({ userMessage: 'hi' })).rejects.toThrow(/is_error/);
  });

  it('chatStream yields token events for each text block, then done', async () => {
    async function* fakeStream() {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'A' },
            { type: 'text', text: 'B' },
          ],
        },
      };
      yield { type: 'result', is_error: false, result: 'AB' };
    }
    const connector = await agentSdkConnector({
      sdk: { query: () => fakeStream() },
    });
    const events: ChatStreamEvent[] = [];
    const ac = new AbortController();
    for await (const ev of connector.chatStream({ userMessage: 'hi' }, ac.signal)) {
      events.push(ev);
    }
    expect(events.filter((e) => e.type === 'token').map((e) => (e as { text: string }).text)).toEqual([
      'A',
      'B',
    ]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('chatStream stops mid-stream when abort signal fires', async () => {
    let yielded = 0;
    async function* fakeStream() {
      while (true) {
        yielded++;
        await new Promise((r) => setTimeout(r, 5));
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'tok' }] },
        };
      }
    }
    const connector = await agentSdkConnector({
      sdk: { query: () => fakeStream() },
    });
    const ac = new AbortController();
    const events: ChatStreamEvent[] = [];
    const iter = connector.chatStream({ userMessage: 'hi' }, ac.signal)[Symbol.asyncIterator]();
    // Pull a couple events, then abort.
    events.push((await iter.next()).value as ChatStreamEvent);
    events.push((await iter.next()).value as ChatStreamEvent);
    ac.abort();
    while (true) {
      const next = await iter.next();
      if (next.done) break;
      events.push(next.value);
    }
    expect(yielded).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('throws if loadSdk rejects (mimics package missing)', async () => {
    await expect(
      agentSdkConnector({
        loadSdk: async () => {
          throw new Error('Cannot find module');
        },
      }),
    ).rejects.toThrow(/Cannot find module/);
  });
});

describe('selectConnector', () => {
  it('returns the SDK connector when the SDK loads', async () => {
    const fakeSdkConnector: Connector = {
      name: 'agent-sdk',
      chat: async () => 'ok',
      chatStream: async function* () {
        yield { type: 'token', text: 'ok' };
        yield { type: 'done' };
      },
    };
    const result = await selectConnector({
      forceReselect: true,
      agentSdk: async () => fakeSdkConnector,
      subprocess: () => {
        throw new Error('should not be called');
      },
      probeSubprocess: async () => {
        throw new Error('should not be called');
      },
      log: () => {},
    });
    expect(result).toBe(fakeSdkConnector);
  });

  it('falls back to subprocess when SDK throws and probe succeeds', async () => {
    const fakeSubprocess: Connector = {
      name: 'subprocess',
      chat: async () => 'sub',
      chatStream: async function* () {
        yield { type: 'token', text: 'sub' };
        yield { type: 'done' };
      },
    };
    const result = await selectConnector({
      forceReselect: true,
      agentSdk: async () => {
        throw new Error('Cannot find module @anthropic-ai/claude-agent-sdk');
      },
      probeSubprocess: async () => undefined,
      subprocess: () => fakeSubprocess,
      log: () => {},
    });
    expect(result).toBe(fakeSubprocess);
    expect(result?.name).toBe('subprocess');
  });

  it('returns null when both SDK and subprocess probe fail', async () => {
    const result = await selectConnector({
      forceReselect: true,
      agentSdk: async () => {
        throw new Error('SDK gone');
      },
      probeSubprocess: async () => {
        throw new Error('claude not on PATH');
      },
      subprocess: () => {
        throw new Error('should not be called');
      },
      log: () => {},
    });
    expect(result).toBeNull();
  });

  it('caches the selection across repeat calls', async () => {
    const sdkBuilder = vi.fn(async (): Promise<Connector> => ({
      name: 'agent-sdk',
      chat: async () => 'first',
      chatStream: async function* () {
        yield { type: 'token', text: 'first' };
        yield { type: 'done' };
      },
    }));
    const a = await selectConnector({
      forceReselect: true,
      agentSdk: sdkBuilder,
      log: () => {},
    });
    const b = await selectConnector({
      agentSdk: sdkBuilder,
      log: () => {},
    });
    expect(a).toBe(b);
    expect(sdkBuilder).toHaveBeenCalledTimes(1);
  });
});
