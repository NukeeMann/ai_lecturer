import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  _resetConnectorCacheForTesting,
  agentSdkConnector,
  assemblePrompt,
  selectConnector,
  subprocessConnector,
  type Connector,
  type SpawnFn,
} from './connector';

// ---------------------------------------------------------------------------
// Fake child_process.spawn — emits stdout chunks, then a `close` event.
// ---------------------------------------------------------------------------

interface FakeProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
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
    const text = await connector.chat({ message: 'hi' });
    expect(text).toBe('Hello from the tutor.');
  });

  it('passes -p <prompt> --output-format json to the CLI', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const fakeJson = JSON.stringify({ result: 'ok' });
    const spawnSpy = ((command: string, args: readonly string[]) => {
      calls.push({ command, args });
      return makeFakeProcess({ stdout: fakeJson });
    }) as unknown as SpawnFn;
    const connector = subprocessConnector({ spawnFn: spawnSpy, command: 'claude' });
    await connector.chat({ message: 'why?' });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('claude');
    expect(calls[0].args[0]).toBe('-p');
    expect(calls[0].args[1]).toContain('why?');
    expect(calls[0].args.slice(2)).toEqual(['--output-format', 'json']);
  });

  it('rejects when claude exits non-zero', async () => {
    const connector = subprocessConnector({
      spawnFn: spawnReturning({
        stdout: '',
        stderr: 'authentication failed',
        exitCode: 2,
      }),
    });
    await expect(connector.chat({ message: 'hi' })).rejects.toThrow(
      /claude exited 2.*authentication failed/,
    );
  });

  it('rejects when stdout is not valid JSON', async () => {
    const connector = subprocessConnector({
      spawnFn: spawnReturning({ stdout: 'not json', exitCode: 0 }),
    });
    await expect(connector.chat({ message: 'hi' })).rejects.toThrow(
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
    await expect(connector.chat({ message: 'hi' })).rejects.toThrow(
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
    await expect(connector.chat({ message: 'hi' })).rejects.toThrow(
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
    await expect(connector.chat({ message: 'hi' })).rejects.toThrow(/timed out/);
    expect(killed).toBe('SIGTERM');
    expect(child.kill).toHaveBeenCalled();
  });

  it('rejects when spawn throws synchronously', async () => {
    const spawnFn = (() => {
      throw new Error('ENOENT');
    }) as unknown as SpawnFn;
    const connector = subprocessConnector({ spawnFn });
    await expect(connector.chat({ message: 'hi' })).rejects.toThrow(
      /spawn failed.*ENOENT/,
    );
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
    const text = await connector.chat({ message: 'hi' });
    expect(text).toBe('Hello, world.');
  });

  it('falls back to the result field when no assistant blocks were yielded', async () => {
    async function* fakeStream() {
      yield { type: 'result', is_error: false, result: 'Just the result.' };
    }
    const connector = await agentSdkConnector({
      sdk: { query: () => fakeStream() },
    });
    expect(await connector.chat({ message: 'hi' })).toBe('Just the result.');
  });

  it('throws when the stream produces no text', async () => {
    async function* fakeStream() {
      yield { type: 'system' };
    }
    const connector = await agentSdkConnector({
      sdk: { query: () => fakeStream() },
    });
    await expect(connector.chat({ message: 'hi' })).rejects.toThrow(
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
    await expect(connector.chat({ message: 'hi' })).rejects.toThrow(/is_error/);
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
