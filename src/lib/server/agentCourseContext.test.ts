import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  agentModel,
  readCourseAgentContext,
  workingMemoryBrief,
} from '@/lib/server/agentCourseContext';

let coursesRoot: string;

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-agent-ctx-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
});

afterEach(async () => {
  delete process.env.COURSES_ROOT_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
});

describe('agentModel', () => {
  it('maps quiz-only to sonnet and everything else to opus (US-192 split)', () => {
    expect(agentModel({ isQuizOnly: true })).toBe('sonnet');
    expect(agentModel({ isQuizOnly: false })).toBe('opus');
  });
});

describe('readCourseAgentContext', () => {
  it('defaults to non-quiz with no working memory when the course dir is empty', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    expect(readCourseAgentContext('demo')).toEqual({
      courseSlug: 'demo',
      isQuizOnly: false,
      researchExists: false,
      sourcesExists: false,
    });
  });

  it('reads the quiz tag from course.json and detects research/sources on disk', async () => {
    const dir = path.join(coursesRoot, 'demo');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'course.json'),
      JSON.stringify({ tags: ['quiz'] }),
      'utf8',
    );
    await fs.writeFile(path.join(dir, 'research.md'), '# R\n', 'utf8');
    await fs.writeFile(path.join(dir, 'sources.md'), '# S\n', 'utf8');
    expect(readCourseAgentContext('demo')).toEqual({
      courseSlug: 'demo',
      isQuizOnly: true,
      researchExists: true,
      sourcesExists: true,
    });
  });

  it('honours knownIsQuizOnly without reading course.json', async () => {
    await fs.mkdir(path.join(coursesRoot, 'demo'), { recursive: true });
    // course.json deliberately absent — the caller already parsed the schema.
    expect(readCourseAgentContext('demo', { knownIsQuizOnly: true }).isQuizOnly).toBe(
      true,
    );
  });

  it('degrades a corrupt course.json to non-quiz defaults', async () => {
    const dir = path.join(coursesRoot, 'demo');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'course.json'), '{not json', 'utf8');
    expect(readCourseAgentContext('demo').isQuizOnly).toBe(false);
  });

  it('degrades an unsafe slug to safe defaults instead of throwing', () => {
    expect(readCourseAgentContext('../escape')).toEqual({
      courseSlug: '../escape',
      isQuizOnly: false,
      researchExists: false,
      sourcesExists: false,
    });
  });
});

describe('workingMemoryBrief', () => {
  it('names only the files that exist', () => {
    const both = workingMemoryBrief({
      courseSlug: 'demo',
      isQuizOnly: false,
      researchExists: true,
      sourcesExists: true,
    });
    expect(both).toContain('/courses/demo/research.md');
    expect(both).toContain('/courses/demo/sources.md');
    expect(both).toContain('do NOT modify them');

    const onlyResearch = workingMemoryBrief({
      courseSlug: 'demo',
      isQuizOnly: false,
      researchExists: true,
      sourcesExists: false,
    });
    expect(onlyResearch).toContain('/courses/demo/research.md');
    expect(onlyResearch).not.toContain('sources.md');
  });

  it('is empty when neither file exists', () => {
    expect(
      workingMemoryBrief({
        courseSlug: 'demo',
        isQuizOnly: true,
        researchExists: false,
        sourcesExists: false,
      }),
    ).toBe('');
  });
});
