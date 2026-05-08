import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { POST as postStt } from '@/app/api/stt/route';
import {
  __setSttDepsForTesting,
  buildWhisperArgs,
  parseWhisperSegments,
  resolveAudioPath,
  whisperBinaryCandidates,
  type SttSpawnDeps,
} from '@/lib/server/stt';

let homeRoot: string;
let coursesRootDir: string;

class FakeChildProcess extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  pid = 9002;
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
      if (stderrText) {
        this.stderr.push(Buffer.from(stderrText, 'utf8'));
      }
      this.stderr.push(null);
      this.emit('exit', exitCode, null);
      setImmediate(() => this.emit('close', exitCode, null));
    });
  }
}

interface SpawnRecording {
  command: string;
  args: string[];
}

function makeSuccessSpawn(opts: {
  recordings: SpawnRecording[];
  transcript: string;
  segmentsJson?: string;
}): SttSpawnDeps {
  const { recordings, transcript, segmentsJson } = opts;
  return {
    spawn: ((command: string, args: string[]) => {
      recordings.push({ command, args: [...args] });
      const child = new FakeChildProcess({
        args,
        onSpawn: async (a) => {
          // Locate `-of <basename>` and write <basename>.txt with the
          // transcript so the route can read it back.
          const idx = a.indexOf('-of');
          if (idx >= 0 && idx + 1 < a.length) {
            const base = a[idx + 1];
            await fs.mkdir(path.dirname(base), { recursive: true });
            await fs.writeFile(`${base}.txt`, transcript, 'utf8');
            if (segmentsJson) {
              await fs.writeFile(`${base}.json`, segmentsJson, 'utf8');
            }
          }
        },
      });
      return child as unknown as ChildProcess;
    }) as unknown as SttSpawnDeps['spawn'],
    binaryExists: async () => true,
    modelExists: async () => true,
  };
}

beforeEach(async () => {
  homeRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-stthome-'));
  coursesRootDir = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-sttcourses-'));
  process.env.AI_LECTURER_HOME_OVERRIDE = homeRoot;
  process.env.COURSES_ROOT_OVERRIDE = coursesRootDir;
});

afterEach(async () => {
  __setSttDepsForTesting(null);
  delete process.env.AI_LECTURER_HOME_OVERRIDE;
  delete process.env.COURSES_ROOT_OVERRIDE;
  await fs.rm(homeRoot, { recursive: true, force: true });
  await fs.rm(coursesRootDir, { recursive: true, force: true });
});

describe('whisperBinaryCandidates / buildWhisperArgs (US-154)', () => {
  it('lists at least one candidate path', () => {
    const candidates = whisperBinaryCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]).toMatch(/whisper\.cpp/);
  });
  it('builds the expected argv shape', () => {
    const args = buildWhisperArgs({
      audioPath: '/abs/clip.wav',
      modelPath: '/abs/model.bin',
      outBase: '/tmp/out',
      language: 'en',
    });
    expect(args).toEqual([
      '-m',
      '/abs/model.bin',
      '-f',
      '/abs/clip.wav',
      '-l',
      'en',
      '-otxt',
      '-oj',
      '-of',
      '/tmp/out',
    ]);
  });
});

describe('parseWhisperSegments (US-154)', () => {
  it('returns segments when whisper json has the expected shape', () => {
    const json = JSON.stringify({
      transcription: [
        { offsets: { from: 0, to: 1500 }, text: ' Hello.' },
        { offsets: { from: 1500, to: 3000 }, text: ' World.' },
      ],
    });
    const result = parseWhisperSegments(json);
    expect(result).toEqual([
      { start: 0, end: 1.5, text: 'Hello.' },
      { start: 1.5, end: 3, text: 'World.' },
    ]);
  });
  it('returns undefined for invalid json', () => {
    expect(parseWhisperSegments('not json')).toBeUndefined();
  });
  it('returns undefined when no segments present', () => {
    expect(parseWhisperSegments('{}')).toBeUndefined();
  });
});

describe('resolveAudioPath (US-154)', () => {
  it('resolves a path under the home root', async () => {
    const fp = path.join(homeRoot, 'tts-cache', 'foo.wav');
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, 'x');
    await expect(
      resolveAudioPath('tts-cache/foo.wav', { home: homeRoot, courses: coursesRootDir }),
    ).resolves.toBe(path.resolve(fp));
  });
  it('resolves an absolute path under the courses root', async () => {
    const courseDir = path.join(coursesRootDir, 'my-course', 'assets', 'audio');
    await fs.mkdir(courseDir, { recursive: true });
    const fp = path.join(courseDir, 'clip.wav');
    await fs.writeFile(fp, 'x');
    await expect(
      resolveAudioPath(fp, { home: homeRoot, courses: coursesRootDir }),
    ).resolves.toBe(path.resolve(fp));
  });
  it('rejects traversal attempts (.. escapes)', async () => {
    await expect(
      resolveAudioPath('../../etc/passwd', {
        home: homeRoot,
        courses: coursesRootDir,
      }),
    ).rejects.toThrow();
  });
  it('rejects an absolute path outside both roots', async () => {
    await expect(
      resolveAudioPath('/etc/passwd', {
        home: homeRoot,
        courses: coursesRootDir,
      }),
    ).rejects.toThrow();
  });
});

describe('POST /api/stt (US-154)', () => {
  it('returns 200 with transcript when whisper produces output', async () => {
    const fp = path.join(homeRoot, 'tts-cache', 'foo.wav');
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, Buffer.alloc(64));

    const recordings: SpawnRecording[] = [];
    __setSttDepsForTesting(
      makeSuccessSpawn({ recordings, transcript: 'hello world' }),
    );

    const res = await postStt(
      new Request('http://x/api/stt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioPath: 'tts-cache/foo.wav' }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.transcript).toBe('hello world');
    expect(typeof json.durationMs).toBe('number');
    expect(json.segments).toBeUndefined();
    expect(recordings).toHaveLength(1);
    // Check command shape — args should contain -m, -f, -of, -otxt
    expect(recordings[0].args).toContain('-otxt');
    expect(recordings[0].args).toContain('-f');
    expect(recordings[0].args).toContain(path.resolve(fp));
  });

  it('returns 400 on path traversal', async () => {
    __setSttDepsForTesting(
      makeSuccessSpawn({ recordings: [], transcript: 'should not run' }),
    );
    const res = await postStt(
      new Request('http://x/api/stt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioPath: '/etc/passwd' }),
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid-audio-path');
  });

  it('returns 503 when whisper.cpp is not installed', async () => {
    const fp = path.join(homeRoot, 'tts-cache', 'foo.wav');
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, Buffer.alloc(64));
    __setSttDepsForTesting({
      spawn: (() => {
        throw new Error('should not spawn');
      }) as unknown as SttSpawnDeps['spawn'],
      binaryExists: async () => false,
      modelExists: async () => false,
    });
    const res = await postStt(
      new Request('http://x/api/stt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioPath: 'tts-cache/foo.wav' }),
      }),
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('stt-not-installed');
  });

  it('returns 503 when the model file is missing even if the binary exists', async () => {
    const fp = path.join(homeRoot, 'tts-cache', 'foo.wav');
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, Buffer.alloc(64));
    __setSttDepsForTesting({
      spawn: (() => {
        throw new Error('should not spawn');
      }) as unknown as SttSpawnDeps['spawn'],
      binaryExists: async () => true,
      modelExists: async () => false,
    });
    const res = await postStt(
      new Request('http://x/api/stt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioPath: 'tts-cache/foo.wav' }),
      }),
    );
    expect(res.status).toBe(503);
  });

  it('returns 400 on missing audioPath', async () => {
    const res = await postStt(
      new Request('http://x/api/stt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on unparseable JSON', async () => {
    const res = await postStt(
      new Request('http://x/api/stt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{nope',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 500 when whisper exits non-zero', async () => {
    const fp = path.join(homeRoot, 'tts-cache', 'foo.wav');
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, Buffer.alloc(64));
    __setSttDepsForTesting({
      spawn: ((_command: string, args: string[]) => {
        const child = new FakeChildProcess({
          args,
          exitCode: 1,
          stderrText: 'whisper boom',
        });
        return child as unknown as ChildProcess;
      }) as unknown as SttSpawnDeps['spawn'],
      binaryExists: async () => true,
      modelExists: async () => true,
    });
    const res = await postStt(
      new Request('http://x/api/stt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioPath: 'tts-cache/foo.wav' }),
      }),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('stt-spawn-failed');
  });

  it('returns segments when whisper writes a json file', async () => {
    const fp = path.join(homeRoot, 'tts-cache', 'foo.wav');
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, Buffer.alloc(64));
    __setSttDepsForTesting(
      makeSuccessSpawn({
        recordings: [],
        transcript: 'Hello world',
        segmentsJson: JSON.stringify({
          transcription: [{ offsets: { from: 0, to: 2000 }, text: ' Hello world' }],
        }),
      }),
    );
    const res = await postStt(
      new Request('http://x/api/stt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioPath: 'tts-cache/foo.wav' }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.segments).toEqual([{ start: 0, end: 2, text: 'Hello world' }]);
  });
});
