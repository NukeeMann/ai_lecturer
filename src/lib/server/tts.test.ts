import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { POST as postTts } from '@/app/api/tts/route';
import {
  __setTtsDepsForTesting,
  buildTtsArgs,
  contentHash,
  parseWavDurationMs,
  resolveVoiceSpeaker,
  type TtsSpawnDeps,
} from '@/lib/server/tts';
import {
  evictOldestUntilUnderBudget,
  ttsCacheDir,
} from '@/lib/server/tts-cache';

let homeRoot: string;

class FakeChildProcess extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  pid = 9001;
  capturedArgs: string[];
  constructor(opts: {
    args: string[];
    onSpawn?: (args: string[]) => Promise<void> | void;
    exitCode?: number;
    stderrText?: string;
  }) {
    super();
    this.capturedArgs = opts.args;
    const exitCode = opts.exitCode ?? 0;
    const stderrText = opts.stderrText ?? '';

    this.stdin = new Writable({ write: (_c, _e, cb) => cb(), final: (cb) => cb() });
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });

    setImmediate(async () => {
      try {
        await opts.onSpawn?.(opts.args);
      } catch (err) {
        this.emit('error', err);
        return;
      }
      this.stdout.push(null);
      this.stderr.push(stderrText ? Buffer.from(stderrText, 'utf8') : null);
      if (stderrText) this.stderr.push(null);
      this.emit('exit', exitCode, null);
      setImmediate(() => this.emit('close', exitCode, null));
    });
  }
}

/** Build a minimal valid WAV header + N bytes of silence. byteRate is
 *  fixed at 16000 Hz · 1 ch · 16-bit = 32000 B/s, so durationMs = N*1000/32000. */
function fakeWav(dataBytes: number): Buffer {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

interface SpawnRecording {
  command: string;
  args: string[];
}

function makeSuccessSpawn(opts: {
  recordings: SpawnRecording[];
  /** Bytes of silence to write into the produced .wav. */
  audioBytes?: number;
  binaryExists?: boolean;
}): TtsSpawnDeps {
  const { recordings, audioBytes = 32000, binaryExists = true } = opts;
  return {
    spawn: ((command: string, args: string[]) => {
      recordings.push({ command, args: [...args] });
      const child = new FakeChildProcess({
        args,
        onSpawn: async (a) => {
          // Locate --out_path argument and write a fake WAV there.
          const idx = a.indexOf('--out_path');
          if (idx >= 0 && idx + 1 < a.length) {
            const outPath = a[idx + 1];
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, fakeWav(audioBytes));
          }
        },
      });
      return child as unknown as ChildProcess;
    }) as unknown as TtsSpawnDeps['spawn'],
    binaryExists: async () => binaryExists,
  };
}

beforeEach(async () => {
  homeRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-home-'));
  process.env.AI_LECTURER_HOME_OVERRIDE = homeRoot;
});

afterEach(async () => {
  __setTtsDepsForTesting(null);
  delete process.env.AI_LECTURER_HOME_OVERRIDE;
  delete process.env.AI_LECTURER_TTS_VOICE_EN_FEMALE_WARM;
  delete process.env.AI_LECTURER_TTS_VOICE_EN_MALE_NEUTRAL;
  delete process.env.AI_LECTURER_TTS_VOICE_EN_FEMALE_BRIGHT;
  await fs.rm(homeRoot, { recursive: true, force: true });
});

describe('parseWavDurationMs (US-154)', () => {
  it('returns the correct ms duration for a known WAV', () => {
    // 32000 B at 32000 B/s = 1000 ms.
    expect(parseWavDurationMs(fakeWav(32000))).toBe(1000);
    // 16000 B = 500 ms.
    expect(parseWavDurationMs(fakeWav(16000))).toBe(500);
  });
  it('returns 0 for non-WAV buffers', () => {
    expect(parseWavDurationMs(Buffer.from('not a wav'))).toBe(0);
    expect(parseWavDurationMs(Buffer.alloc(10))).toBe(0);
  });
});

describe('contentHash + buildTtsArgs (US-154)', () => {
  it('hashes the same input to the same value (and different input differs)', () => {
    const a = contentHash('hello world', 'en-female-warm');
    const b = contentHash('hello world', 'en-female-warm');
    const c = contentHash('hello world', 'en-male-neutral');
    const d = contentHash('hello world!', 'en-female-warm');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
  it('emits the expected argv shape', () => {
    const args = buildTtsArgs({
      text: 'hi',
      voice: 'en-female-warm',
      outPath: '/tmp/x.wav',
    });
    expect(args).toContain('--text');
    expect(args).toContain('hi');
    expect(args).toContain('--model_name');
    expect(args).toContain('tts_models/multilingual/multi-dataset/xtts_v2');
    expect(args).toContain('--language_idx');
    expect(args).toContain('en');
    expect(args).toContain('--out_path');
    expect(args).toContain('/tmp/x.wav');
  });
  it('honours env-var voice overrides for each of the three voices', () => {
    process.env.AI_LECTURER_TTS_VOICE_EN_FEMALE_WARM = 'CustomWarm';
    process.env.AI_LECTURER_TTS_VOICE_EN_MALE_NEUTRAL = 'CustomNeutral';
    process.env.AI_LECTURER_TTS_VOICE_EN_FEMALE_BRIGHT = 'CustomBright';
    expect(resolveVoiceSpeaker('en-female-warm')).toBe('CustomWarm');
    expect(resolveVoiceSpeaker('en-male-neutral')).toBe('CustomNeutral');
    expect(resolveVoiceSpeaker('en-female-bright')).toBe('CustomBright');
  });
});

describe('POST /api/tts (US-154)', () => {
  it('returns 200 with audioPath, durationMs, cached:false on first call', async () => {
    const recordings: SpawnRecording[] = [];
    __setTtsDepsForTesting(makeSuccessSpawn({ recordings }));

    const res = await postTts(
      new Request('http://x/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello, world!', voice: 'en-female-warm' }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cached).toBe(false);
    expect(json.audioPath).toMatch(/^tts-cache\/[A-Za-z0-9_-]+\.wav$/);
    expect(json.durationMs).toBe(1000);
    expect(recordings).toHaveLength(1);
    expect(recordings[0].command).toMatch(/tts$/);
    expect(recordings[0].args).toContain('Hello, world!');
    // Cache file actually exists.
    const expected = path.join(ttsCacheDir(), `${contentHash('Hello, world!', 'en-female-warm')}.wav`);
    await expect(fs.stat(expected)).resolves.toBeTruthy();
  });

  it('returns cached:true on the second identical call (no second spawn)', async () => {
    const recordings: SpawnRecording[] = [];
    __setTtsDepsForTesting(makeSuccessSpawn({ recordings }));

    const body = JSON.stringify({ text: 'Cache me.', voice: 'en-female-warm' });
    const first = await postTts(
      new Request('http://x/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );
    expect(first.status).toBe(200);
    expect((await first.json()).cached).toBe(false);

    const second = await postTts(
      new Request('http://x/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );
    expect(second.status).toBe(200);
    const json = await second.json();
    expect(json.cached).toBe(true);
    expect(json.durationMs).toBe(1000);
    expect(recordings).toHaveLength(1); // no second spawn
  });

  it('returns 503 when the Coqui binary is not installed', async () => {
    __setTtsDepsForTesting({
      spawn: (() => {
        throw new Error('should not spawn');
      }) as unknown as TtsSpawnDeps['spawn'],
      binaryExists: async () => false,
    });
    const res = await postTts(
      new Request('http://x/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hi' }),
      }),
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('tts-not-installed');
    expect(json.message).toContain('setup-tts.sh');
  });

  it('returns 400 on missing text', async () => {
    const res = await postTts(
      new Request('http://x/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on too-long text', async () => {
    const res = await postTts(
      new Request('http://x/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(2001) }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on bad voice value', async () => {
    const res = await postTts(
      new Request('http://x/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'ok', voice: 'pt-female' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on unparseable JSON', async () => {
    const res = await postTts(
      new Request('http://x/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{nope',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 500 when the Coqui CLI exits non-zero', async () => {
    __setTtsDepsForTesting({
      spawn: ((_command: string, args: string[]) => {
        const child = new FakeChildProcess({ args, exitCode: 2, stderrText: 'boom' });
        return child as unknown as ChildProcess;
      }) as unknown as TtsSpawnDeps['spawn'],
      binaryExists: async () => true,
    });
    const res = await postTts(
      new Request('http://x/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'ok' }),
      }),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('tts-spawn-failed');
  });

  it('uses an explicit outputBaseName when provided', async () => {
    const recordings: SpawnRecording[] = [];
    __setTtsDepsForTesting(makeSuccessSpawn({ recordings }));
    const res = await postTts(
      new Request('http://x/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'custom name', outputBaseName: 'my_clip' }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.audioPath).toBe('tts-cache/my_clip.wav');
  });

  it('rejects an outputBaseName containing path separators', async () => {
    const res = await postTts(
      new Request('http://x/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hi', outputBaseName: '../etc/passwd' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('evictOldestUntilUnderBudget (US-154)', () => {
  it('removes the oldest files when total exceeds the budget', async () => {
    const dir = path.join(homeRoot, 'cache');
    await fs.mkdir(dir, { recursive: true });
    // Three 100-byte files with monotonically increasing mtimes.
    const a = path.join(dir, 'a.wav');
    const b = path.join(dir, 'b.wav');
    const c = path.join(dir, 'c.wav');
    await fs.writeFile(a, Buffer.alloc(100));
    await fs.writeFile(b, Buffer.alloc(100));
    await fs.writeFile(c, Buffer.alloc(100));
    const baseTime = Date.now();
    await fs.utimes(a, new Date(baseTime - 30000), new Date(baseTime - 30000));
    await fs.utimes(b, new Date(baseTime - 20000), new Date(baseTime - 20000));
    await fs.utimes(c, new Date(baseTime - 10000), new Date(baseTime - 10000));

    // Budget that fits one file → expect a + b removed.
    const removed = await evictOldestUntilUnderBudget({ dir, budgetBytes: 100 });
    expect(removed.sort()).toEqual(['a.wav', 'b.wav']);
    await expect(fs.access(a)).rejects.toBeTruthy();
    await expect(fs.access(b)).rejects.toBeTruthy();
    await expect(fs.access(c)).resolves.toBeUndefined();
  });

  it('does nothing when total is under budget', async () => {
    const dir = path.join(homeRoot, 'cache');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'a.wav'), Buffer.alloc(50));
    const removed = await evictOldestUntilUnderBudget({ dir, budgetBytes: 1000 });
    expect(removed).toEqual([]);
  });
});
