import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import {
  __resetForTesting,
  __setSpawnDepsForTesting,
  ClaudeUnavailableError,
  GenerationConflictError,
  getActiveRun,
  getRunById,
  sseEncode,
  startGeneration,
  type GenerationEvent,
  type SpawnDeps,
} from '@/lib/server/generation';

import { POST as postGenerate, DELETE as deleteGenerate } from '@/app/api/courses/generate/route';
import { GET as streamGenerate } from '@/app/api/courses/generate/stream/[id]/route';

let coursesRoot: string;

class FakeChildProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  exitCode: number | null = null;
  killed = false;
  killSignals: NodeJS.Signals[] = [];
  pid = 12345;
  constructor() {
    super();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
  emitStdout(text: string) {
    this.stdout.push(Buffer.from(text, 'utf8'));
  }
  emitStderr(text: string) {
    this.stderr.push(Buffer.from(text, 'utf8'));
  }
  kill(signal?: NodeJS.Signals | number) {
    const sig = (typeof signal === 'string' ? signal : 'SIGTERM') as NodeJS.Signals;
    this.killSignals.push(sig);
    this.killed = true;
    if (sig === 'SIGKILL') {
      // Simulate the OS finally tearing it down.
      this.finishWithExit(137);
    }
    return true;
  }
  finishWithExit(code: number) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    // signal end-of-stream so any 'data' events for buffered chunks flush
    this.stdout.push(null);
    this.stderr.push(null);
    this.emit('exit', code, null);
    // Defer 'close' so pending 'data' events (delivered on a later tick) flush
    // before any teardown listener (the wrapper waits on 'close', not 'exit').
    setImmediate(() => {
      this.emit('close', code, null);
    });
  }
}

interface ScriptedSpawn {
  spawn: SpawnDeps['spawn'];
  children: FakeChildProcess[];
  /** Resolves once the next spawn happens. */
  nextChild: () => Promise<FakeChildProcess>;
}

function makeScriptedSpawn(): ScriptedSpawn {
  const children: FakeChildProcess[] = [];
  const waiters: Array<(c: FakeChildProcess) => void> = [];
  let consumed = 0;
  const spawn = (() => {
    const child = new FakeChildProcess();
    children.push(child);
    const waiter = waiters.shift();
    if (waiter) waiter(child);
    return child as unknown as ChildProcess;
  }) as unknown as SpawnDeps['spawn'];
  return {
    spawn,
    children,
    nextChild() {
      return new Promise((resolve) => {
        if (consumed < children.length) {
          resolve(children[consumed++]);
          return;
        }
        waiters.push((c) => {
          consumed++;
          resolve(c);
        });
      });
    },
  };
}

async function waitForFinish(run: { finished: boolean }) {
  for (let i = 0; i < 50 && !run.finished; i++) {
    await new Promise((r) => setImmediate(r));
  }
  // One more tick so the WriteStream's underlying fs write has a chance to land.
  await new Promise((r) => setTimeout(r, 25));
}

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-gen-test-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
  __resetForTesting();
});

afterEach(async () => {
  __resetForTesting();
  __setSpawnDepsForTesting(null);
  delete process.env.COURSES_ROOT_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('sseEncode', () => {
  it('emits event lines with type and JSON data', () => {
    const out = sseEncode({ type: 'log', line: 'hello' });
    const text = new TextDecoder().decode(out);
    expect(text).toBe('event: log\ndata: {"type":"log","line":"hello"}\n\n');
  });
  it('encodes done with courseSlug', () => {
    const text = new TextDecoder().decode(sseEncode({ type: 'done', courseSlug: 'foo' }));
    expect(text).toContain('event: done\n');
    expect(text).toContain('"courseSlug":"foo"');
  });
  it('encodes progress with current/total', () => {
    const text = new TextDecoder().decode(
      sseEncode({ type: 'progress', current: 2, total: 5 }),
    );
    expect(text).toContain('event: progress\n');
    expect(text).toContain('"current":2');
    expect(text).toContain('"total":5');
  });
  it('encodes stage with name and status', () => {
    const text = new TextDecoder().decode(
      sseEncode({ type: 'stage', name: 'init_course', status: 'started' }),
    );
    expect(text).toContain('event: stage\n');
    expect(text).toContain('"name":"init_course"');
    expect(text).toContain('"status":"started"');
  });
  it('encodes error with message', () => {
    const text = new TextDecoder().decode(sseEncode({ type: 'error', message: 'boom' }));
    expect(text).toContain('event: error\n');
    expect(text).toContain('"message":"boom"');
  });
});

describe('startGeneration spawn wrapper', () => {
  it('throws ClaudeUnavailableError when claude is not on PATH', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await expect(
      startGeneration('demo', {
        isExecutableInPath: () => false,
      }),
    ).rejects.toBeInstanceOf(ClaudeUnavailableError);
  });

  it('runs claude then ralph and emits stage/log/done events', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();

    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    // First child is claude
    const claude = await scripted.nextChild();
    claude.emitStdout('claude says hi\n');
    claude.finishWithExit(0);

    // Second child is ralph
    const ralph = await scripted.nextChild();
    ralph.emitStdout('Lesson 1/2\n');
    ralph.emitStdout('Lesson 2/2\n');
    ralph.finishWithExit(0);

    await waitForFinish(run);
    const events: GenerationEvent[] = run.events;

    const stageEvents = events.filter((e) => e.type === 'stage');
    expect(stageEvents).toEqual([
      { type: 'stage', name: 'init_course', status: 'started' },
      { type: 'stage', name: 'init_course', status: 'done' },
      { type: 'stage', name: 'ralph', status: 'started' },
      { type: 'stage', name: 'ralph', status: 'done' },
    ]);

    const logLines = events.filter((e) => e.type === 'log').map((e) => (e as { line: string }).line);
    expect(logLines).toContain('claude says hi');
    expect(logLines).toContain('Lesson 1/2');
    expect(logLines).toContain('Lesson 2/2');

    const progress = events.filter((e) => e.type === 'progress');
    expect(progress).toEqual([
      { type: 'progress', current: 1, total: 2 },
      { type: 'progress', current: 2, total: 2 },
    ]);

    const done = events.find((e) => e.type === 'done');
    expect(done).toEqual({ type: 'done', courseSlug: 'demo' });

    expect(run.finished).toBe(true);
    expect(getActiveRun()).toBeNull();
  });

  it('captures stdout AND stderr to /courses/<slug>/.generation.log', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const claude = await scripted.nextChild();
    claude.emitStdout('claude-stdout-line\n');
    claude.emitStderr('claude-stderr-line\n');
    claude.finishWithExit(0);
    const ralph = await scripted.nextChild();
    ralph.emitStdout('ralph-stdout-line\n');
    ralph.emitStderr('ralph-stderr-line\n');
    ralph.finishWithExit(0);

    await waitForFinish(run);
    // Sanity check: the events ARE being emitted in-memory.
    const lines = run.events
      .filter((e) => e.type === 'log')
      .map((e) => (e as { line: string }).line);
    expect(lines).toEqual(
      expect.arrayContaining([
        'claude-stdout-line',
        'claude-stderr-line',
        'ralph-stdout-line',
        'ralph-stderr-line',
      ]),
    );
    // And land in the disk log file.
    const log = await fs.readFile(path.join(coursesRoot, 'demo', '.generation.log'), 'utf8');
    expect(log).toContain('claude-stdout-line');
    expect(log).toContain('claude-stderr-line');
    expect(log).toContain('ralph-stdout-line');
    expect(log).toContain('ralph-stderr-line');
  });

  it('rejects a second concurrent run with GenerationConflictError', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const scripted = makeScriptedSpawn();
    const run = await startGeneration('demo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });
    void run;
    await scripted.nextChild(); // claude is now running but not exited

    await expect(
      startGeneration('demo', {
        spawn: scripted.spawn,
        isExecutableInPath: () => true,
      }),
    ).rejects.toBeInstanceOf(GenerationConflictError);
  });

  it('SIGTERMs the active child on cancel and SIGKILLs after the grace window', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    vi.useFakeTimers();
    try {
      const scripted = makeScriptedSpawn();
      const run = await startGeneration('demo', {
        spawn: scripted.spawn,
        isExecutableInPath: () => true,
        sigkillGraceMs: 5000,
      });
      const claude = await scripted.nextChild();
      claude.emitStdout('still alive\n');

      await run.cancel();
      expect(claude.killSignals).toContain('SIGTERM');
      expect(claude.killSignals).not.toContain('SIGKILL');

      // Grace window passes — the timer fires and we SIGKILL.
      vi.advanceTimersByTime(5001);
      expect(claude.killSignals).toContain('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /api/courses/generate (route)', () => {
  it('returns 400 for an unsafe slug', async () => {
    const req = new Request('http://localhost/api/courses/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: '../etc' }),
    });
    const res = await postGenerate(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 if course-spec.json is missing', async () => {
    const req = new Request('http://localhost/api/courses/generate', {
      method: 'POST',
      body: JSON.stringify({ slug: 'no-spec' }),
    });
    const res = await postGenerate(req);
    expect(res.status).toBe(404);
  });

  it('returns 503 when claude is not on PATH', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'demo', 'course-spec.json'),
      JSON.stringify({ stub: true }),
      'utf8',
    );
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => false,
    });
    const req = new Request('http://localhost/api/courses/generate', {
      method: 'POST',
      body: JSON.stringify({ slug: 'demo' }),
    });
    const res = await postGenerate(req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Install Claude Code CLI|sign in/i);
  });

  it('returns 202 + id on success and 409 on a second concurrent attempt', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'demo', 'course-spec.json'),
      JSON.stringify({ stub: true }),
      'utf8',
    );
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const ok = await postGenerate(
      new Request('http://localhost/api/courses/generate', {
        method: 'POST',
        body: JSON.stringify({ slug: 'demo' }),
      }),
    );
    expect(ok.status).toBe(202);
    const okBody = (await ok.json()) as { id: string; slug: string };
    expect(okBody.id).toMatch(/^gen-/);
    expect(okBody.slug).toBe('demo');

    // Hold the first child open so the slot stays busy.
    await scripted.nextChild();

    const conflict = await postGenerate(
      new Request('http://localhost/api/courses/generate', {
        method: 'POST',
        body: JSON.stringify({ slug: 'demo' }),
      }),
    );
    expect(conflict.status).toBe(409);
  });

  it('DELETE cancels the active run', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'demo', 'course-spec.json'),
      JSON.stringify({ stub: true }),
      'utf8',
    );
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const ok = await postGenerate(
      new Request('http://localhost/api/courses/generate', {
        method: 'POST',
        body: JSON.stringify({ slug: 'demo' }),
      }),
    );
    const { id } = (await ok.json()) as { id: string };
    const child = await scripted.nextChild();

    const del = await deleteGenerate(
      new Request(`http://localhost/api/courses/generate?id=${id}`, { method: 'DELETE' }),
    );
    expect(del.status).toBe(200);
    expect(child.killSignals).toContain('SIGTERM');
  });

  it('GET stream replays buffered events and emits SSE frames', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.writeFile(
      path.join(coursesRoot, 'demo', 'course-spec.json'),
      JSON.stringify({ stub: true }),
      'utf8',
    );
    const scripted = makeScriptedSpawn();
    __setSpawnDepsForTesting({
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    const ok = await postGenerate(
      new Request('http://localhost/api/courses/generate', {
        method: 'POST',
        body: JSON.stringify({ slug: 'demo' }),
      }),
    );
    const { id } = (await ok.json()) as { id: string };

    const claude = await scripted.nextChild();
    claude.emitStdout('hello-world\n');
    claude.finishWithExit(0);
    const ralph = await scripted.nextChild();
    ralph.emitStdout('Lesson 1/1\n');
    ralph.finishWithExit(0);

    const run = getRunById(id);
    if (!run) throw new Error('run not found');
    await waitForFinish(run);

    expect(getRunById(id)?.finished).toBe(true);
    const res = await streamGenerate(new Request(`http://localhost/stream/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    const text = await res.text();
    expect(text).toContain('event: stage');
    expect(text).toContain('event: log');
    expect(text).toContain('event: progress');
    expect(text).toContain('event: done');
    expect(text).toContain('"courseSlug":"demo"');
  });

  it('GET stream returns 404 for unknown id', async () => {
    const res = await streamGenerate(new Request('http://localhost/stream/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });
});
