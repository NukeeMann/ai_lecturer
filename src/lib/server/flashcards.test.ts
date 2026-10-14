import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess, spawn as SpawnFn } from 'node:child_process';

import {
  apkgDownloadNames,
  ensureCourseApkg,
  flashcardsApkgFile,
  getFlashcardsSummary,
  readModuleFlashcards,
} from './flashcards';
import {
  FlashcardsJobConflictError,
  __resetFlashcardsJobsForTesting,
  getFlashcardsJob,
  startFlashcardsJob,
} from './flashcardsJob';

let root: string;
const SLUG = 'geo';

async function writeJson(rel: string, data: unknown) {
  const file = path.join(root, SLUG, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data));
}

async function seedCourse() {
  await writeJson('course.json', {
    schemaVersion: 1,
    slug: SLUG,
    title: 'Geografia Polski: powtórka',
    description: 'Test',
    accentColor: 'indigo',
    icon: 'map',
    modules: [
      { id: 'm1', title: 'Położenie', summary: '', lessons: [{ slug: 'a', title: 'A', estimatedMinutes: 5 }] },
      { id: 'm2', title: 'Klimat', summary: '', lessons: [{ slug: 'b', title: 'B', estimatedMinutes: 5 }] },
      { id: 'm3', title: 'Bez lekcji', summary: '', lessons: [{ slug: 'missing', title: 'X', estimatedMinutes: 5 }] },
    ],
    createdAt: '2026-10-14T00:00:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
  });
  for (const [slug, moduleId] of [
    ['a', 'm1'],
    ['b', 'm2'],
  ]) {
    await writeJson(`lessons/${slug}.json`, {
      schemaVersion: 1,
      slug,
      courseSlug: SLUG,
      moduleId,
      title: slug,
      eyebrow: 'X',
      description: 'X',
      estimatedMinutes: 5,
      sections: [{ id: 't', title: 'T', type: 'theory', data: { markdown: 'Fakt.' } }],
    });
  }
}

const deck = (moduleId: string, cards: unknown[]) => ({ schemaVersion: 1, courseSlug: SLUG, moduleId, cards });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'ai-flashcards-test-'));
  process.env.COURSES_ROOT_OVERRIDE = root;
  // startFlashcardsJob consults the generation queue — keep it in the tmpdir.
  process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(root, 'generation-queue.json');
  __resetFlashcardsJobsForTesting();
  await seedCourse();
});

afterEach(async () => {
  __resetFlashcardsJobsForTesting();
  delete process.env.COURSES_ROOT_OVERRIDE;
  delete process.env.GENERATION_QUEUE_FILE_OVERRIDE;
  await fs.rm(root, { recursive: true, force: true });
});

describe('flashcards storage', () => {
  it('validates module files, including the courseSlug/moduleId echo', async () => {
    expect(await readModuleFlashcards(SLUG, 'm1')).toMatchObject({ ok: false, missing: true });
    await writeJson('flashcards/m1.json', { ...deck('m2', [{ id: 'a', kind: 'basic', front: 'q', back: 'a' }]) });
    const res = await readModuleFlashcards(SLUG, 'm1');
    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.reason).toMatch(/expected "geo" \/ "m1"/);
  });

  it('summarises Anki card counts and modules still missing flashcards', async () => {
    await writeJson(
      'flashcards/m1.json',
      deck('m1', [
        { id: 'a', kind: 'basic', front: 'q', back: 'a', reverse: true },
        { id: 'b', kind: 'cloze', text: '{{c1::x}} {{c2::y}} {{c1::z}}' },
      ]),
    );
    const summary = await getFlashcardsSummary(SLUG);
    expect(summary).toMatchObject({
      available: true,
      totalCards: 4,
      missingModules: 1, // m2 has a lesson but no flashcards; m3 has no lesson on disk
      modules: [
        { moduleId: 'm1', cards: 4 },
        { moduleId: 'm2', cards: 0 },
        { moduleId: 'm3', cards: 0 },
      ],
    });
  });

  it('builds deck.apkg on demand and rebuilds it when a module file changes', async () => {
    expect(await ensureCourseApkg(SLUG)).toBeNull();
    await writeJson('flashcards/m1.json', deck('m1', [{ id: 'a', kind: 'basic', front: 'q', back: 'a' }]));
    const file = await ensureCourseApkg(SLUG);
    expect(file).toBe(flashcardsApkgFile(SLUG));
    const first = (await fs.stat(file!)).mtimeMs;

    expect(await ensureCourseApkg(SLUG)).toBe(file);
    expect((await fs.stat(file!)).mtimeMs).toBe(first); // cached

    await new Promise((r) => setTimeout(r, 20));
    await writeJson('flashcards/m2.json', deck('m2', [{ id: 'b', kind: 'basic', front: 'q', back: 'a' }]));
    await ensureCourseApkg(SLUG);
    expect((await fs.stat(file!)).mtimeMs).toBeGreaterThan(first);
  });

  it('derives safe download names', () => {
    expect(apkgDownloadNames('Geografia Polski: powtórka / test')).toEqual({
      utf8: 'Geografia Polski powtórka test.apkg',
      ascii: 'Geografia Polski powtorka test.apkg',
    });
    expect(apkgDownloadNames('Łódź — „fiszki”').ascii).toBe('Lodz fiszki.apkg');
  });
});

class FakeChild extends EventEmitter {
  stdout = new Readable({ read() {} });
  stderr = new Readable({ read() {} });
  pid = undefined;
  finish(code: number) {
    this.stdout.push(null);
    this.stderr.push(null);
    setImmediate(() => this.emit('close', code));
  }
  kill() {
    this.finish(143);
    return true;
  }
}

describe('on-demand flashcards job', () => {
  it('generates only the missing modules, then writes the deck', async () => {
    await writeJson('flashcards/m1.json', deck('m1', [{ id: 'a', kind: 'basic', front: 'q', back: 'a' }]));
    const spawned: string[] = [];
    const spawn = ((_cmd: string, args: string[]) => {
      const moduleId = args[1];
      spawned.push(moduleId);
      const child = new FakeChild();
      void writeJson(`flashcards/${moduleId}.json`, deck(moduleId, [{ id: 'x', kind: 'cloze', text: '{{c1::x}}' }])).then(() =>
        child.finish(0),
      );
      return child as unknown as ChildProcess;
    }) as unknown as typeof SpawnFn;

    const status = await startFlashcardsJob(SLUG, {}, {
      spawn,
      command: (_slug, moduleId) => ({ command: 'fake', args: ['-p', moduleId] }),
    });
    expect(status).toMatchObject({ state: 'running', current: 0, total: 1 });
    await expect(startFlashcardsJob(SLUG)).rejects.toBeInstanceOf(FlashcardsJobConflictError);

    for (let i = 0; i < 200 && getFlashcardsJob(SLUG)?.state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(spawned).toEqual(['m2']);
    expect(getFlashcardsJob(SLUG)).toMatchObject({ state: 'done', current: 1, total: 1, failedModules: [] });
    expect((await getFlashcardsSummary(SLUG))?.missingModules).toBe(0);
    await expect(fs.access(flashcardsApkgFile(SLUG))).resolves.toBeUndefined();
  });

  it('reports modules whose agent never wrote a valid file', async () => {
    const spawn = (() => {
      const child = new FakeChild();
      child.finish(0);
      return child as unknown as ChildProcess;
    }) as unknown as typeof SpawnFn;
    await startFlashcardsJob(SLUG, {}, { spawn, command: () => ({ command: 'fake', args: [] }), maxAttempts: 2 });
    for (let i = 0; i < 200 && getFlashcardsJob(SLUG)?.state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(getFlashcardsJob(SLUG)).toMatchObject({ state: 'error', current: 2, total: 2, failedModules: ['m1', 'm2'] });
  });
});
