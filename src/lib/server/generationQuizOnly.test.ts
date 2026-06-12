/**
 * US-192 — Quiz-only generation pipeline tests.
 *
 * Coverage:
 *  (a) when course-spec.json carries `tags: ['quiz']`, the pipeline does NOT
 *      spawn `claude -p` for the research_course stage;
 *  (b) it does NOT spawn the coherence_pass stage either (even when the
 *      vitest setup's default-disable is overridden);
 *  (c) each per-lesson spawn flows through the `generate_quiz_lesson` skill
 *      (asserted via the prompt content emitted by the default factory);
 *  (d) regression guard: when the `quiz` tag is absent, the full-course
 *      pipeline still runs all four stages (research → design → per-lesson
 *      → coherence-pass).
 *
 * Built on the same FakeChildProcess / scripted-spawn harness as
 * generation.test.ts. Sharing the harness keeps the assertion idiom uniform
 * across the two suites without forcing a refactor of the existing 4k-line
 * file.
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
  __setSourceUrlCheckDisabledByDefault,
  __setSpawnDepsForTesting,
  defaultLessonCommand,
  defaultDesignCourseCommand,
  startGeneration,
  type SpawnDeps,
} from '@/lib/server/generation';

let coursesRoot: string;

class FakeChildProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  exitCode: number | null = null;
  killed = false;
  killSignals: NodeJS.Signals[] = [];
  pid = 23456;
  command = '';
  args: readonly string[] = [];
  constructor() {
    super();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
  kill(signal?: NodeJS.Signals | number) {
    const sig = (typeof signal === 'string' ? signal : 'SIGTERM') as NodeJS.Signals;
    this.killSignals.push(sig);
    this.killed = true;
    if (sig === 'SIGKILL') this.finishWithExit(137);
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

interface ScriptedSpawn {
  spawn: SpawnDeps['spawn'];
  children: FakeChildProcess[];
  nextChild: () => Promise<FakeChildProcess>;
}

function makeScriptedSpawn(): ScriptedSpawn {
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
  for (let i = 0; i < 200 && !run.finished; i++) {
    await new Promise((r) => setImmediate(r));
  }
  await new Promise((r) => setTimeout(r, 25));
}

async function writeStubCourse(slug: string, lessonSlugs: string[]) {
  const dir = path.join(coursesRoot, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'course.json'),
    JSON.stringify({
      schemaVersion: 1,
      slug,
      title: 'Stub',
      description: 'Stub course for tests',
      accentColor: 'indigo',
      icon: 'sigma',
      modules: [
        {
          id: 'm1',
          title: 'Module 1',
          summary: 'Stub module',
          lessons: lessonSlugs.map((s) => ({ slug: s, title: s, estimatedMinutes: 5 })),
        },
      ],
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z',
    }),
    'utf8',
  );
}

async function writeStubResearchArtefacts(slug: string) {
  const dir = path.join(coursesRoot, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'research.md'), '# Research: stub\n', 'utf8');
  await fs.writeFile(path.join(dir, 'sources.md'), '# Sources: stub\n', 'utf8');
}

async function writeStubLesson(slug: string, lessonSlug: string) {
  const dir = path.join(coursesRoot, slug, 'lessons');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${lessonSlug}.json`),
    JSON.stringify({
      schemaVersion: 1,
      slug: lessonSlug,
      courseSlug: slug,
      moduleId: 'm1',
      title: lessonSlug,
      eyebrow: 'STUB',
      description: 'Stub lesson',
      estimatedMinutes: 5,
      sections: [
        {
          id: 's1',
          title: 'Read',
          type: 'theory',
          data: { markdown: 'Stub.' },
        },
      ],
    }),
    'utf8',
  );
}

async function writeCourseSpec(
  slug: string,
  tags: string[] | undefined,
): Promise<void> {
  const dir = path.join(coursesRoot, slug);
  await fs.mkdir(dir, { recursive: true });
  const spec: Record<string, unknown> = {
    topic: 'Quiz on Linear Algebra',
    durationTarget: 'short',
    draftStructure: {
      courseTitle: 'Quiz: LinAlg basics',
      courseDescription: 'Quick recall checks for vectors / spans / bases.',
      modules: [
        {
          title: 'Module 1',
          lessons: [{ title: 'Intro', summary: '', estimatedMinutes: 10 }],
        },
      ],
    },
    createdAt: '2026-05-25T00:00:00.000Z',
  };
  if (tags && tags.length > 0) spec.tags = tags;
  await fs.writeFile(path.join(dir, 'course-spec.json'), JSON.stringify(spec));
}

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-gen-quiz-test-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
  process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(coursesRoot, 'generation-queue.json');
  __resetForTesting();
  // Match the rest of the pipeline suite — disable coherence-pass globally
  // unless an individual test opts back in. The "all four stages still run"
  // regression test opts back in via `disableCoherencePass: false`.
  __setCoherencePassDisabledByDefault(true);
  __setSourceUrlCheckDisabledByDefault(true);
});

afterEach(async () => {
  __resetForTesting();
  __setSpawnDepsForTesting(null);
  __setCoherencePassDisabledByDefault(false);
  __setSourceUrlCheckDisabledByDefault(false);
  delete process.env.COURSES_ROOT_OVERRIDE;
  delete process.env.GENERATION_QUEUE_FILE_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
});

describe('US-192 — quiz-only pipeline branch', () => {
  it('skips research_course and coherence_pass when course-spec.json carries tags:["quiz"]', async () => {
    await writeCourseSpec('quizdemo', ['quiz']);

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('quizdemo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      // Opt the coherence-pass back ON for this test: even with it enabled,
      // the quiz branch must NOT spawn it.
      disableCoherencePass: false,
    });

    // FIRST child is the design_course spawn — research_course was skipped.
    const design = await scripted.nextChild();
    await writeStubCourse('quizdemo', ['intro', 'outro']);
    design.finishWithExit(0);

    // Children #2 and #3 are the per-lesson spawns. We don't bother
    // re-asserting prompt contents here — that's covered by the dedicated
    // "lessonCommand sees isQuizOnly" assertion below.
    const intro = await scripted.nextChild();
    await writeStubLesson('quizdemo', 'intro');
    intro.finishWithExit(0);

    const outro = await scripted.nextChild();
    await writeStubLesson('quizdemo', 'outro');
    outro.finishWithExit(0);

    await waitForFinish(run);

    // (a) No research_course spawn was recorded. Spawn args carry the
    //     prompt body (default factory) OR the mock-script path (mock
    //     factory) — neither path should ever name `research_course` for a
    //     quiz-only run.
    for (const child of scripted.children) {
      const all = [child.command, ...child.args].join(' ');
      expect(all).not.toMatch(/research_course/);
    }

    // (b) No coherence_pass spawn was recorded — same probe across all
    //     spawned children. (`coherence_pass` is the skill / log filename;
    //     `coherence-pass` is the SSE stage name — block both.)
    for (const child of scripted.children) {
      const all = [child.command, ...child.args].join(' ');
      expect(all).not.toMatch(/coherence[-_]pass/);
    }

    // (c) Stage events never emit research_course or coherence-pass.
    const stageEvents = run.events.filter((e) => e.type === 'stage');
    const stageNames = stageEvents.map((e) => (e as { name: string }).name);
    expect(stageNames).not.toContain('research_course');
    expect(stageNames).not.toContain('coherence-pass');

    // (d) Sanity — design_course + both per-lesson stages did fire.
    expect(stageEvents).toEqual([
      { type: 'stage', name: 'design_course', status: 'started' },
      { type: 'stage', name: 'design_course', status: 'done' },
      { type: 'stage', name: 'lesson:intro', status: 'started' },
      { type: 'stage', name: 'lesson:intro', status: 'done' },
      { type: 'stage', name: 'lesson:outro', status: 'started' },
      { type: 'stage', name: 'lesson:outro', status: 'done' },
    ]);

    // (e) The `done` event landed cleanly — no failedLessons, no coherence
    //     report path (the stage was skipped).
    const done = run.events.find((e) => e.type === 'done') as
      | { type: 'done'; coherenceReportPath?: string; failedLessons: unknown[] }
      | undefined;
    expect(done).toBeDefined();
    expect(done?.failedLessons).toEqual([]);
    expect(done?.coherenceReportPath).toBeUndefined();
  });

  it('per-lesson factory receives isQuizOnly=true when the spec carries the tag', async () => {
    await writeCourseSpec('quizdemo', ['quiz']);

    const scripted = makeScriptedSpawn();
    const lessonInvocations: Array<{
      slug: string;
      lessonSlug: string;
      previousAttemptReason: string | undefined;
      isQuizOnly: boolean | undefined;
    }> = [];

    const run = await startGeneration('quizdemo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      lessonCommand: (slug, lessonSlug, previousAttemptReason, isQuizOnly) => {
        lessonInvocations.push({
          slug,
          lessonSlug,
          previousAttemptReason,
          isQuizOnly,
        });
        return {
          command: 'fake-claude',
          args: [
            '-p',
            `slug=${slug} lesson=${lessonSlug} quizOnly=${isQuizOnly}`,
            '--dangerously-skip-permissions',
          ],
        };
      },
    });

    const design = await scripted.nextChild();
    await writeStubCourse('quizdemo', ['quiz-a', 'quiz-b']);
    design.finishWithExit(0);

    const a = await scripted.nextChild();
    await writeStubLesson('quizdemo', 'quiz-a');
    a.finishWithExit(0);

    const b = await scripted.nextChild();
    await writeStubLesson('quizdemo', 'quiz-b');
    b.finishWithExit(0);

    await waitForFinish(run);

    expect(lessonInvocations).toEqual([
      {
        slug: 'quizdemo',
        lessonSlug: 'quiz-a',
        previousAttemptReason: undefined,
        isQuizOnly: true,
      },
      {
        slug: 'quizdemo',
        lessonSlug: 'quiz-b',
        previousAttemptReason: undefined,
        isQuizOnly: true,
      },
    ]);
  });

  it('design_course factory receives isQuizOnly=true when the spec carries the tag', async () => {
    await writeCourseSpec('quizdemo', ['quiz']);

    const scripted = makeScriptedSpawn();
    const designInvocations: Array<{ slug: string; isQuizOnly: boolean | undefined }> = [];

    const run = await startGeneration('quizdemo', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      designCourseCommand: (slug, isQuizOnly) => {
        designInvocations.push({ slug, isQuizOnly });
        return {
          command: 'fake-claude',
          args: ['-p', `design slug=${slug} quizOnly=${isQuizOnly}`],
        };
      },
    });

    const design = await scripted.nextChild();
    await writeStubCourse('quizdemo', ['intro']);
    design.finishWithExit(0);

    const intro = await scripted.nextChild();
    await writeStubLesson('quizdemo', 'intro');
    intro.finishWithExit(0);

    await waitForFinish(run);

    expect(designInvocations).toEqual([{ slug: 'quizdemo', isQuizOnly: true }]);
  });

  it('quiz-only lessons run on Sonnet, full lessons run on Opus', () => {
    const quiz = defaultLessonCommand('quizdemo', 'intro', undefined, true);
    const modelIdx = quiz.args.indexOf('--model');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(quiz.args[modelIdx + 1]).toBe('sonnet');

    const full = defaultLessonCommand('demo', 'intro', undefined, false);
    const fullModelIdx = full.args.indexOf('--model');
    expect(fullModelIdx).toBeGreaterThan(-1);
    expect(full.args[fullModelIdx + 1]).toBe('opus');
  });

  it('quiz-only design runs on Sonnet, full design runs on Opus', () => {
    const quiz = defaultDesignCourseCommand('quizdemo', true);
    const quizIdx = quiz.args.indexOf('--model');
    expect(quizIdx).toBeGreaterThan(-1);
    expect(quiz.args[quizIdx + 1]).toBe('sonnet');

    const full = defaultDesignCourseCommand('demo', false);
    const fullIdx = full.args.indexOf('--model');
    expect(fullIdx).toBeGreaterThan(-1);
    expect(full.args[fullIdx + 1]).toBe('opus');
  });

  it('default lesson command emits the generate_quiz_lesson skill prompt when isQuizOnly=true', () => {
    const spec = defaultLessonCommand('quizdemo', 'intro', undefined, true);
    expect(spec.command).toBe('claude');
    const prompt = spec.args[1];
    expect(prompt).toContain('generate_quiz_lesson');
    expect(prompt).toContain(
      'scripts/ralph/skills/generate_quiz_lesson/SKILL.md',
    );
    // Crucial: the brief does NOT ask the agent to consume research.md /
    // sources.md as inputs (the only mention is the explicit "do NOT try to
    // Read them" guard). Verify the input list never contains them.
    expect(prompt).not.toMatch(/end-to-end against[^.]*research\.md/);
    expect(prompt).not.toMatch(/end-to-end against[^.]*sources\.md/);
    // But it DOES explicitly mark them as absent so the agent doesn't try to
    // probe for them.
    expect(prompt).toMatch(/do NOT try to Read them/);
    // Same regression guard as the non-quiz default — skill name carried in
    // prose, never as a literal slash command.
    expect(prompt).not.toMatch(/^\s*\/generate_quiz_lesson\b/);
  });

  it('default lesson command emits the generate_lesson skill prompt when isQuizOnly=false (regression guard)', () => {
    const spec = defaultLessonCommand('demo', 'intro', undefined, false);
    expect(spec.command).toBe('claude');
    const prompt = spec.args[1];
    expect(prompt).toContain('generate_lesson');
    expect(prompt).not.toContain('generate_quiz_lesson');
    expect(prompt).toContain('research.md');
    expect(prompt).toContain('sources.md');
  });

  it('default design command prompt carries the quiz-only sentence when isQuizOnly=true', () => {
    const spec = defaultDesignCourseCommand('quizdemo', true);
    const prompt = spec.args[1];
    expect(prompt).toContain(
      "course-spec.tags contains 'quiz'",
    );
    expect(prompt).toContain("tags:['quiz']");
    expect(prompt).not.toContain('research.md (the prior research_course');
  });

  it('default design command prompt is unchanged when isQuizOnly is omitted', () => {
    const spec = defaultDesignCourseCommand('demo');
    const prompt = spec.args[1];
    expect(prompt).not.toContain("course-spec.tags contains 'quiz'");
    // Existing full-course brief still names research.md / sources.md.
    expect(prompt).toContain('research.md');
    expect(prompt).toContain('sources.md');
  });

  it('regression: pipeline runs all four stages (research + design + lesson + coherence) when the tag is absent', async () => {
    await writeCourseSpec('regular', undefined);

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('regular', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
      disableCoherencePass: false,
    });

    // Child #1: research_course — write artefacts, exit 0.
    const research = await scripted.nextChild();
    await writeStubResearchArtefacts('regular');
    research.finishWithExit(0);

    // Child #2: design_course — write course.json, exit 0.
    const design = await scripted.nextChild();
    await writeStubCourse('regular', ['intro']);
    design.finishWithExit(0);

    // Child #3: per-lesson generate_lesson.
    const lesson = await scripted.nextChild();
    await writeStubLesson('regular', 'intro');
    lesson.finishWithExit(0);

    // Child #4: coherence_pass — print a stub report on stdout, exit 0.
    const coherence = await scripted.nextChild();
    coherence.stdout.push(
      Buffer.from(
        '## Prerequisite Order\n\nAll good.\n\n## Redundancy\n\nNone.\n\n## Notation Consistency\n\nClean.\n',
        'utf8',
      ),
    );
    coherence.finishWithExit(0);

    await waitForFinish(run);

    const stageNames = run.events
      .filter((e) => e.type === 'stage')
      .map((e) => (e as { name: string; status: string }).name + ':' + (e as { status: string }).status);
    expect(stageNames).toEqual([
      'research_course:started',
      'research_course:done',
      'design_course:started',
      'design_course:done',
      'lesson:intro:started',
      'lesson:intro:done',
      'coherence-pass:started',
      'coherence-pass:done',
    ]);
  });

  it('regression: an empty tags array does NOT trigger the quiz branch', async () => {
    await writeCourseSpec('regular', []);

    const scripted = makeScriptedSpawn();
    const run = await startGeneration('regular', {
      spawn: scripted.spawn,
      isExecutableInPath: () => true,
    });

    // Research stage runs first because tags: [] is NOT quiz-only.
    const research = await scripted.nextChild();
    await writeStubResearchArtefacts('regular');
    research.finishWithExit(0);

    const design = await scripted.nextChild();
    await writeStubCourse('regular', ['intro']);
    design.finishWithExit(0);

    const lesson = await scripted.nextChild();
    await writeStubLesson('regular', 'intro');
    lesson.finishWithExit(0);

    await waitForFinish(run);

    const stageNames = run.events
      .filter((e) => e.type === 'stage')
      .map((e) => (e as { name: string }).name);
    expect(stageNames).toContain('research_course');
  });
});
