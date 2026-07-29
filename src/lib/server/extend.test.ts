import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { POST as postExtend } from '@/app/api/courses/[slug]/extend/route';
import {
  __setExtendSpawnForTesting,
  defaultExtendCommand,
  type ExtendSpawnDeps,
} from '@/lib/server/extend';
import {
  __resetForTesting as __resetGenerationForTesting,
  __setActiveRunForTesting,
} from '@/lib/server/generation';

let coursesRoot: string;

class FakeChildProcess extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  pid = 4242;
  /** Captured bytes the route piped into stdin. */
  capturedStdin = '';
  constructor(opts: { stdoutText?: string; stderrText?: string; exitCode?: number }) {
    super();
    const exitCode = opts.exitCode ?? 0;
    const stdoutText = opts.stdoutText ?? '';
    const stderrText = opts.stderrText ?? '';

    const captured: Buffer[] = [];
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _enc, cb) => {
        captured.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
      final: (cb) => {
        this.capturedStdin = Buffer.concat(captured).toString('utf8');
        // Defer streaming output + close until after stdin is closed so the
        // route's stdin.end() resolves before we finalize the child.
        setImmediate(() => {
          this.stdout.push(Buffer.from(stdoutText, 'utf8'));
          this.stdout.push(null);
          this.stderr.push(Buffer.from(stderrText, 'utf8'));
          this.stderr.push(null);
          this.emit('exit', exitCode, null);
          setImmediate(() => this.emit('close', exitCode, null));
        });
        cb();
      },
    });

    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
}

function makeFixedSpawn(opts: {
  stdoutText?: string;
  stderrText?: string;
  exitCode?: number;
}): { spawn: ExtendSpawnDeps['spawn']; lastChild: () => FakeChildProcess | null } {
  let last: FakeChildProcess | null = null;
  const spawn = ((_command: string, _args: readonly string[] = []) => {
    const child = new FakeChildProcess(opts);
    last = child;
    return child as unknown as ChildProcess;
  }) as unknown as ExtendSpawnDeps['spawn'];
  return { spawn, lastChild: () => last };
}

const sampleCourse = (slug: string) => ({
  schemaVersion: 1,
  slug,
  title: 'Edge Detection Basics',
  description: 'How edge detectors find boundaries in images.',
  accentColor: 'indigo' as const,
  icon: 'scan-line',
  modules: [
    {
      id: 'm1',
      title: 'Gradients in images',
      summary: 'What it means to take a derivative of an image.',
      lessons: [
        {
          slug: 'what-is-an-image-gradient',
          title: 'What is an image gradient?',
          estimatedMinutes: 10,
        },
      ],
    },
  ],
  createdAt: '2026-04-15T10:05:00.000Z',
  updatedAt: '2026-04-15T10:05:00.000Z',
});

const sampleLesson = (courseSlug: string, slug: string, description: string) => ({
  schemaVersion: 1,
  slug,
  courseSlug,
  moduleId: 'm1',
  title: 'What is an image gradient?',
  eyebrow: 'INTRO',
  description,
  estimatedMinutes: 10,
  sections: [
    { id: 's1', title: 'Read', type: 'theory' as const, data: { markdown: '# hi' } },
  ],
});

async function seedCourse(slug: string) {
  const dir = path.join(coursesRoot, slug);
  await fs.mkdir(path.join(dir, 'lessons'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'course.json'),
    JSON.stringify(sampleCourse(slug)),
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'lessons', 'what-is-an-image-gradient.json'),
    JSON.stringify(
      sampleLesson(slug, 'what-is-an-image-gradient', 'Discrete derivatives in 2D.'),
    ),
    'utf8',
  );
}

const validAgentResponse = (slug: string) =>
  JSON.stringify({
    proposedSchema: {
      ...sampleCourse(slug),
      modules: [
        sampleCourse(slug).modules[0],
        {
          id: 'm2',
          title: 'From gradients to edges',
          summary: 'Turning a gradient map into a clean edge map.',
          lessons: [
            {
              slug: 'the-canny-edge-detector',
              title: 'The Canny edge detector',
              estimatedMinutes: 15,
            },
          ],
        },
      ],
      updatedAt: '2026-05-08T12:00:00.000Z',
    },
    additions: {
      newModuleIds: ['m2'],
      newLessonIds: [
        {
          moduleId: 'm2',
          lessonSlug: 'the-canny-edge-detector',
          lessonTitle: 'The Canny edge detector',
          lessonDescription: 'Putting it all together: blur → gradient → NMS → hysteresis.',
        },
      ],
      rationale: 'The instruction asked for a Canny module.',
    },
  });

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-extend-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
  process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(coursesRoot, 'generation-queue.json');
  __resetGenerationForTesting();
});

afterEach(async () => {
  __setExtendSpawnForTesting(null);
  __resetGenerationForTesting();
  delete process.env.COURSES_ROOT_OVERRIDE;
  delete process.env.GENERATION_QUEUE_FILE_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
});

describe('POST /api/courses/[slug]/extend (US-143)', () => {
  it('returns 200 with the parsed agent response on the happy path', async () => {
    await seedCourse('edge-detection-basics');
    const { spawn, lastChild } = makeFixedSpawn({
      stdoutText: validAgentResponse('edge-detection-basics'),
      exitCode: 0,
    });
    __setExtendSpawnForTesting({ spawn });

    const res = await postExtend(
      new Request('http://x/api/courses/edge-detection-basics/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'Add a Canny module.' }),
      }),
      { params: Promise.resolve({ slug: 'edge-detection-basics' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.additions.newModuleIds).toEqual(['m2']);
    expect(json.additions.newLessonIds[0]).toMatchObject({
      moduleId: 'm2',
      lessonSlug: 'the-canny-edge-detector',
    });
    expect(json.proposedSchema.modules).toHaveLength(2);

    // Confirm the route piped the right input to stdin.
    const child = lastChild();
    expect(child).not.toBeNull();
    const stdinJson = JSON.parse(child!.capturedStdin);
    expect(stdinJson.instruction).toBe('Add a Canny module.');
    // Existing lesson description was loaded from the lesson JSON and passed
    // to the agent so it has the context it needs.
    expect(stdinJson.currentSchema.modules[0].lessons[0].description).toBe(
      'Discrete derivatives in 2D.',
    );
  });

  it('returns 400 on a missing instruction', async () => {
    await seedCourse('edge-detection-basics');
    __setExtendSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse('edge-detection-basics') }).spawn,
    });
    const res = await postExtend(
      new Request('http://x/api/courses/edge-detection-basics/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ slug: 'edge-detection-basics' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on a too-long instruction', async () => {
    await seedCourse('edge-detection-basics');
    __setExtendSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse('edge-detection-basics') }).spawn,
    });
    const res = await postExtend(
      new Request('http://x/api/courses/edge-detection-basics/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'x'.repeat(2001) }),
      }),
      { params: Promise.resolve({ slug: 'edge-detection-basics' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on more than 10 refinements', async () => {
    await seedCourse('edge-detection-basics');
    __setExtendSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse('edge-detection-basics') }).spawn,
    });
    const refinements = Array.from({ length: 11 }, () => ({
      role: 'user' as const,
      content: 'tweak',
    }));
    const res = await postExtend(
      new Request('http://x/api/courses/edge-detection-basics/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'add stuff', refinements }),
      }),
      { params: Promise.resolve({ slug: 'edge-detection-basics' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when the course does not exist', async () => {
    __setExtendSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: '{}' }).spawn,
    });
    const res = await postExtend(
      new Request('http://x/api/courses/nope/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'add stuff' }),
      }),
      { params: Promise.resolve({ slug: 'nope' }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns 422 with truncated raw output when the agent emits non-JSON', async () => {
    await seedCourse('edge-detection-basics');
    __setExtendSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: 'not json at all' }).spawn,
    });
    const res = await postExtend(
      new Request('http://x/api/courses/edge-detection-basics/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'add stuff' }),
      }),
      { params: Promise.resolve({ slug: 'edge-detection-basics' }) },
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('agent-output-invalid');
    expect(json.rawOutput).toContain('not json at all');
  });

  it('returns 422 when the agent emits JSON that fails the schema', async () => {
    await seedCourse('edge-detection-basics');
    // Valid JSON, wrong shape — additions block missing.
    const badShape = JSON.stringify({
      proposedSchema: sampleCourse('edge-detection-basics'),
      // additions intentionally omitted
    });
    __setExtendSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: badShape }).spawn,
    });
    const res = await postExtend(
      new Request('http://x/api/courses/edge-detection-basics/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'add stuff' }),
      }),
      { params: Promise.resolve({ slug: 'edge-detection-basics' }) },
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('agent-output-invalid');
  });

  it('truncates the rawOutput field at ~2KB', async () => {
    await seedCourse('edge-detection-basics');
    const huge = 'A'.repeat(5000);
    __setExtendSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: huge }).spawn,
    });
    const res = await postExtend(
      new Request('http://x/api/courses/edge-detection-basics/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'add stuff' }),
      }),
      { params: Promise.resolve({ slug: 'edge-detection-basics' }) },
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.rawOutput.length).toBeLessThanOrEqual(2200);
    expect(json.rawOutput).toContain('truncated');
  });

  it('returns 500 when the agent exits non-zero', async () => {
    await seedCourse('edge-detection-basics');
    __setExtendSpawnForTesting({
      spawn: makeFixedSpawn({
        stdoutText: '',
        stderrText: 'boom',
        exitCode: 1,
      }).spawn,
    });
    const res = await postExtend(
      new Request('http://x/api/courses/edge-detection-basics/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'add stuff' }),
      }),
      { params: Promise.resolve({ slug: 'edge-detection-basics' }) },
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('agent-spawn-failed');
  });

  it('returns 400 on an unparseable JSON body', async () => {
    await seedCourse('edge-detection-basics');
    const res = await postExtend(
      new Request('http://x/api/courses/edge-detection-basics/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not-json',
      }),
      { params: Promise.resolve({ slug: 'edge-detection-basics' }) },
    );
    expect(res.status).toBe(400);
  });

  it('passes refinements through to the agent stdin', async () => {
    await seedCourse('edge-detection-basics');
    const { spawn, lastChild } = makeFixedSpawn({
      stdoutText: validAgentResponse('edge-detection-basics'),
    });
    __setExtendSpawnForTesting({ spawn });
    const res = await postExtend(
      new Request('http://x/api/courses/edge-detection-basics/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instruction: 'add a Canny module',
          refinements: [
            { role: 'user', content: 'actually call it Canny pipeline' },
          ],
        }),
      }),
      { params: Promise.resolve({ slug: 'edge-detection-basics' }) },
    );
    expect(res.status).toBe(200);
    const stdinJson = JSON.parse(lastChild()!.capturedStdin);
    expect(stdinJson.refinements).toEqual([
      { role: 'user', content: 'actually call it Canny pipeline' },
    ]);
  });

  it('returns 409 busy when a generation is active for this slug', async () => {
    const slug = 'edge-detection-basics';
    await seedCourse(slug);
    // Simulate a genuinely-supervised, in-memory generation run for the slug.
    // A bare `.generating.json` marker no longer counts as active — it's
    // reconciled away as an orphan (see computeActiveRunSummary).
    __setActiveRunForTesting(slug);
    __setExtendSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse(slug) }).spawn,
    });
    const res = await postExtend(
      new Request(`http://x/api/courses/${slug}/extend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'add stuff' }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('busy');
  });

  it('does not modify any files on disk', async () => {
    await seedCourse('edge-detection-basics');
    const before = await fs.readFile(
      path.join(coursesRoot, 'edge-detection-basics', 'course.json'),
      'utf8',
    );
    const beforeLesson = await fs.readFile(
      path.join(
        coursesRoot,
        'edge-detection-basics',
        'lessons',
        'what-is-an-image-gradient.json',
      ),
      'utf8',
    );
    __setExtendSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse('edge-detection-basics') }).spawn,
    });
    const res = await postExtend(
      new Request('http://x/api/courses/edge-detection-basics/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'add a Canny module' }),
      }),
      { params: Promise.resolve({ slug: 'edge-detection-basics' }) },
    );
    expect(res.status).toBe(200);
    const after = await fs.readFile(
      path.join(coursesRoot, 'edge-detection-basics', 'course.json'),
      'utf8',
    );
    const afterLesson = await fs.readFile(
      path.join(
        coursesRoot,
        'edge-detection-basics',
        'lessons',
        'what-is-an-image-gradient.json',
      ),
      'utf8',
    );
    expect(after).toBe(before);
    expect(afterLesson).toBe(beforeLesson);
  });
});

describe('readLessonDescriptions / buildAgentInputCourse (US-143)', () => {
  it('falls back to empty string when a lesson file is missing', async () => {
    const slug = 'partial-course';
    const dir = path.join(coursesRoot, slug);
    await fs.mkdir(path.join(dir, 'lessons'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'course.json'),
      JSON.stringify(sampleCourse(slug)),
      'utf8',
    );
    // Note: no lesson JSON written.
    __setExtendSpawnForTesting({
      spawn: makeFixedSpawn({ stdoutText: validAgentResponse(slug) }).spawn,
    });
    const res = await postExtend(
      new Request(`http://x/api/courses/${slug}/extend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'add stuff' }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(res.status).toBe(200);
  });
});

// ── Model pin (course-aware spawn spec) ──────────────────────────────────────

describe('defaultExtendCommand model pin', () => {
  it('pins --model opus for normal courses (and by default)', () => {
    const { args } = defaultExtendCommand();
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
  });

  it('pins --model sonnet for quiz-only courses', () => {
    const { args } = defaultExtendCommand({ isQuizOnly: true });
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
  });
});
