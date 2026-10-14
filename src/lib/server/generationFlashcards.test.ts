/**
 * Final "flashcards" stage of the generation pipeline: one generate_flashcards
 * spawn per module with lessons, skip modules whose flashcards file already
 * validates, rebuild flashcards/deck.apkg, never fail the course.
 *
 * Same FakeChildProcess / scripted-spawn harness as generationQuizOnly.test.ts
 * (quiz-only courses keep the scripted sequence short: design → lessons →
 * flashcards, no research / coherence spawns).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import {
  __resetForTesting,
  __setCoherencePassDisabledByDefault,
  __setFlashcardsDisabledByDefault,
  __setSourceUrlCheckDisabledByDefault,
  __setSpawnDepsForTesting,
  startGeneration,
  type SpawnDeps,
} from '@/lib/server/generation';

let coursesRoot: string;

class FakeChildProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  exitCode: number | null = null;
  pid = 34567;
  command = '';
  args: readonly string[] = [];
  constructor() {
    super();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
  kill(signal?: NodeJS.Signals | number) {
    const sig = (typeof signal === 'string' ? signal : 'SIGTERM') as NodeJS.Signals;
    this.finishWithExit(sig === 'SIGKILL' ? 137 : 143);
    return true;
  }
  finishWithExit(code: number) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.stdout.push(null);
    this.stderr.push(null);
    this.emit('exit', code, null);
    setImmediate(() => this.emit('close', code, null));
  }
}

function makeScriptedSpawn() {
  const children: FakeChildProcess[] = [];
  const waiters: Array<(c: FakeChildProcess) => void> = [];
  let consumed = 0;
  const spawn = ((command: string, args: readonly string[] = []) => {
    const child = new FakeChildProcess();
    child.command = command;
    child.args = [...args];
    children.push(child);
    const waiter = waiters.shift();
    if (waiter) waiter(child);
    return child as unknown as ChildProcess;
  }) as unknown as SpawnDeps['spawn'];
  return {
    spawn,
    children,
    nextChild(): Promise<FakeChildProcess> {
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
  for (let i = 0; i < 400 && !run.finished; i++) {
    await new Promise((r) => setTimeout(r, 2));
  }
  await new Promise((r) => setTimeout(r, 25));
}

const SLUG = 'flashdemo';

async function writeQuizSpec() {
  const dir = path.join(coursesRoot, SLUG);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'course-spec.json'),
    JSON.stringify({
      topic: 'Geo',
      durationTarget: 'short',
      tags: ['quiz'],
      draftStructure: {
        courseTitle: 'Geo',
        courseDescription: 'Geo',
        modules: [{ title: 'M1', lessons: [{ title: 'Intro', summary: '', estimatedMinutes: 10 }] }],
      },
      createdAt: '2026-10-14T00:00:00.000Z',
    }),
  );
}

async function writeCourse(modules: { id: string; lessons: string[] }[]) {
  await fs.writeFile(
    path.join(coursesRoot, SLUG, 'course.json'),
    JSON.stringify({
      schemaVersion: 1,
      slug: SLUG,
      title: 'Geografia Polski',
      description: 'Test',
      accentColor: 'indigo',
      icon: 'map',
      tags: ['quiz'],
      modules: modules.map((m) => ({
        id: m.id,
        title: `Temat ${m.id}`,
        summary: '',
        lessons: m.lessons.map((s) => ({ slug: s, title: s, estimatedMinutes: 5 })),
      })),
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
    }),
  );
}

async function writeLesson(lessonSlug: string, moduleId: string) {
  const dir = path.join(coursesRoot, SLUG, 'lessons');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${lessonSlug}.json`),
    JSON.stringify({
      schemaVersion: 1,
      slug: lessonSlug,
      courseSlug: SLUG,
      moduleId,
      title: lessonSlug,
      eyebrow: 'QUIZ',
      description: 'Stub',
      estimatedMinutes: 5,
      sections: [
        {
          id: 'q1',
          title: 'Q',
          type: 'quiz',
          data: { question: '2+2?', options: ['3', '4'], correct: [1], explanation: '4.', multiSelect: false },
        },
      ],
    }),
  );
}

async function writeFlashcards(moduleId: string) {
  const dir = path.join(coursesRoot, SLUG, 'flashcards');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${moduleId}.json`),
    JSON.stringify({
      schemaVersion: 1,
      courseSlug: SLUG,
      moduleId,
      cards: [{ id: 'fact', kind: 'cloze', text: 'Stolica: {{c1::Warszawa}}' }],
    }),
  );
}

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-gen-flash-test-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
  process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(coursesRoot, 'generation-queue.json');
  __resetForTesting();
  __setCoherencePassDisabledByDefault(true);
  __setFlashcardsDisabledByDefault(true);
  __setSourceUrlCheckDisabledByDefault(true);
});

afterEach(async () => {
  __resetForTesting();
  __setSpawnDepsForTesting(null);
  __setCoherencePassDisabledByDefault(false);
  __setFlashcardsDisabledByDefault(false);
  __setSourceUrlCheckDisabledByDefault(false);
  delete process.env.COURSES_ROOT_OVERRIDE;
  delete process.env.GENERATION_QUEUE_FILE_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
});

describe('flashcards stage', () => {
  it('spawns one agent per module after the lessons and writes deck.apkg', async () => {
    await writeQuizSpec();
    const scripted = makeScriptedSpawn();
    const calls: { moduleId: string; reason?: string; quiz?: boolean }[] = [];
    const run = await startGeneration(SLUG, {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      disableFlashcards: false,
      flashcardsCommand: (_slug, moduleId, reason, quiz) => {
        calls.push({ moduleId, reason, quiz });
        return { command: 'fake-claude', args: ['-p', `flashcards ${moduleId}`] };
      },
    });

    const design = await scripted.nextChild();
    await writeCourse([
      { id: 'm1', lessons: ['a'] },
      { id: 'm2', lessons: ['b'] },
    ]);
    design.finishWithExit(0);
    const a = await scripted.nextChild();
    await writeLesson('a', 'm1');
    a.finishWithExit(0);
    const b = await scripted.nextChild();
    await writeLesson('b', 'm2');
    b.finishWithExit(0);

    const f1 = await scripted.nextChild();
    expect(f1.args.join(' ')).toContain('flashcards m1');
    await writeFlashcards('m1');
    f1.finishWithExit(0);
    const f2 = await scripted.nextChild();
    expect(f2.args.join(' ')).toContain('flashcards m2');
    await writeFlashcards('m2');
    f2.finishWithExit(0);

    await waitForFinish(run);

    expect(calls).toEqual([
      { moduleId: 'm1', reason: undefined, quiz: true },
      { moduleId: 'm2', reason: undefined, quiz: true },
    ]);
    const stages = run.events.filter((e) => e.type === 'stage').map((e) => `${(e as { name: string }).name}:${(e as { status: string }).status}`);
    expect(stages.slice(-2)).toEqual(['flashcards:started', 'flashcards:done']);
    expect(run.events.at(-1)).toMatchObject({ type: 'done', failedLessons: [] });
    expect(await exists(path.join(coursesRoot, SLUG, 'flashcards', 'deck.apkg'))).toBe(true);
    expect(await exists(path.join(coursesRoot, SLUG, 'logs', 'flashcards.log'))).toBe(true);
  });

  it('skips modules that already have valid flashcards', async () => {
    await writeQuizSpec();
    const scripted = makeScriptedSpawn();
    const run = await startGeneration(SLUG, {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      disableFlashcards: false,
      flashcardsCommand: () => ({ command: 'fake-claude', args: ['-p', 'flashcards'] }),
    });
    const design = await scripted.nextChild();
    await writeCourse([{ id: 'm1', lessons: ['a'] }]);
    await writeFlashcards('m1');
    design.finishWithExit(0);
    const a = await scripted.nextChild();
    await writeLesson('a', 'm1');
    a.finishWithExit(0);

    await waitForFinish(run);

    expect(scripted.children).toHaveLength(2); // design + lesson, no flashcards spawn
    expect(run.events.at(-1)).toMatchObject({ type: 'done' });
    expect(await exists(path.join(coursesRoot, SLUG, 'flashcards', 'deck.apkg'))).toBe(true);
  });

  it('retries once with the validation error, then gives up without failing the course', async () => {
    await writeQuizSpec();
    const scripted = makeScriptedSpawn();
    const reasons: (string | undefined)[] = [];
    const run = await startGeneration(SLUG, {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      disableFlashcards: false,
      flashcardsCommand: (_s, _m, reason) => {
        reasons.push(reason);
        return { command: 'fake-claude', args: ['-p', 'flashcards'] };
      },
    });
    const design = await scripted.nextChild();
    await writeCourse([{ id: 'm1', lessons: ['a'] }]);
    design.finishWithExit(0);
    const a = await scripted.nextChild();
    await writeLesson('a', 'm1');
    a.finishWithExit(0);

    // Both attempts exit 0 without writing the file.
    (await scripted.nextChild()).finishWithExit(0);
    (await scripted.nextChild()).finishWithExit(0);

    await waitForFinish(run);

    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toBeUndefined();
    expect(reasons[1]).toMatch(/was not written/);
    const stages = run.events.filter((e) => e.type === 'stage').map((e) => `${(e as { name: string }).name}:${(e as { status: string }).status}`);
    expect(stages.slice(-2)).toEqual(['flashcards:started', 'flashcards:error']);
    expect(run.events.at(-1)).toMatchObject({ type: 'done', failedLessons: [] });
    expect(await exists(path.join(coursesRoot, SLUG, 'flashcards', 'deck.apkg'))).toBe(false);
  });

  it('pause during the flashcards stage ends the run as paused', async () => {
    await writeQuizSpec();
    const scripted = makeScriptedSpawn();
    const run = await startGeneration(SLUG, {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      disableFlashcards: false,
      sigkillGraceMs: 10,
      flashcardsCommand: () => ({ command: 'fake-claude', args: ['-p', 'flashcards'] }),
    });
    const design = await scripted.nextChild();
    await writeCourse([{ id: 'm1', lessons: ['a'] }]);
    design.finishWithExit(0);
    const a = await scripted.nextChild();
    await writeLesson('a', 'm1');
    a.finishWithExit(0);

    await scripted.nextChild(); // flashcards agent in flight
    await run.pause();
    await waitForFinish(run);

    expect(run.events.at(-1)).toMatchObject({ type: 'paused', slug: SLUG });
    expect(scripted.children).toHaveLength(3);
  });
});
