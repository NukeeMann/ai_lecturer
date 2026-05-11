import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  deleteGenerationState,
  generationStateFile,
  GenerationStateSchema,
  readGenerationState,
  writeGenerationState,
  type GenerationState,
} from '@/lib/server/generationState';

let coursesRoot: string;

function makeState(slug: string, overrides: Partial<GenerationState> = {}): GenerationState {
  return {
    schemaVersion: 1,
    slug,
    startedAt: '2026-05-08T10:00:00.000Z',
    lastUpdatedAt: '2026-05-08T10:00:00.000Z',
    research: { status: 'done' },
    design: { status: 'done' },
    lessons: [
      { slug: 'intro', status: 'pending', attempts: 0 },
      { slug: 'outro', status: 'pending', attempts: 0 },
    ],
    config: { lessonMaxRetries: 2, lessonTimeoutMs: 1_800_000 },
    ...overrides,
  };
}

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-genstate-test-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
});

afterEach(async () => {
  delete process.env.COURSES_ROOT_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('generationStateFile', () => {
  it('lives at <courseDir>/.generation-state.json', () => {
    expect(generationStateFile('demo')).toBe(
      path.join(coursesRoot, 'demo', '.generation-state.json'),
    );
  });

  it('rejects unsafe slugs via the shared courseDir helper', () => {
    expect(() => generationStateFile('../etc')).toThrow(/Invalid slug/i);
    expect(() => generationStateFile('a/b')).toThrow(/Invalid slug/i);
  });
});

describe('readGenerationState', () => {
  it('returns null when the file does not exist (ENOENT)', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const result = await readGenerationState('demo');
    expect(result).toBeNull();
  });

  it('returns null + emits exactly one warn on corrupt JSON', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.writeFile(
      generationStateFile('demo'),
      '{not valid json',
      'utf8',
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await readGenerationState('demo');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null + warns once when JSON parses but fails schema validation', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await fs.writeFile(
      generationStateFile('demo'),
      JSON.stringify({ schemaVersion: 1, slug: 'demo' }),
      'utf8',
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await readGenerationState('demo');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('writeGenerationState', () => {
  it('round-trips: write then read returns the same state', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const initial = makeState('demo');
    await writeGenerationState('demo', initial);

    const loaded = await readGenerationState('demo');
    expect(loaded).not.toBeNull();
    expect(loaded?.slug).toBe('demo');
    expect(loaded?.research.status).toBe('done');
    expect(loaded?.design.status).toBe('done');
    expect(loaded?.lessons).toHaveLength(2);
    expect(loaded?.lessons[0]).toMatchObject({ slug: 'intro', status: 'pending', attempts: 0 });
    expect(loaded?.config).toEqual({ lessonMaxRetries: 2, lessonTimeoutMs: 1_800_000 });
  });

  it('updates lastUpdatedAt on every write', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    const initial = makeState('demo', { lastUpdatedAt: '2020-01-01T00:00:00.000Z' });
    const before = Date.now();
    await writeGenerationState('demo', initial);
    const loaded = await readGenerationState('demo');
    expect(loaded).not.toBeNull();
    const stamped = new Date(loaded!.lastUpdatedAt).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(loaded!.lastUpdatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('produces a valid file (passes the exported schema)', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await writeGenerationState('demo', makeState('demo'));
    const raw = await fs.readFile(generationStateFile('demo'), 'utf8');
    const parsed = GenerationStateSchema.safeParse(JSON.parse(raw));
    expect(parsed.success).toBe(true);
  });
});

describe('deleteGenerationState', () => {
  it('removes the file when it exists', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await writeGenerationState('demo', makeState('demo'));
    await deleteGenerationState('demo');
    await expect(fs.access(generationStateFile('demo'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('is a no-op (no throw) when the file is already gone', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    await expect(deleteGenerationState('demo')).resolves.toBeUndefined();
  });
});
