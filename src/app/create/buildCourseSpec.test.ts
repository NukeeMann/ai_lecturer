import { describe, expect, it } from 'vitest';

import { buildCourseSpec } from './buildCourseSpec';
import type { Draft, StructureDraft } from './Stage3Cascade';

function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    topic: 'Linear algebra',
    description: '',
    level: 'beginner',
    durationTarget: 'short',
    theoryPracticeRatio: 50,
    quizOnly: false,
    clarificationQuestions: undefined,
    clarification: undefined,
    structure: null,
    ...overrides,
  };
}

const structure: StructureDraft = {
  courseTitle: 'LA 101',
  courseDescription: 'Intro',
  modules: [
    {
      id: 'm-1',
      title: 'Vectors',
      lessons: [
        {
          id: 'l-1',
          title: 'What is a vector?',
          summary: 'Short summary',
          estimatedMinutes: 10,
        },
      ],
    },
  ],
};

describe('buildCourseSpec — US-191 quiz-only mode', () => {
  it('emits `tags: ["quiz"]` and omits level + theoryPracticeRatio when quizOnly=true', () => {
    const draft = makeDraft({ quizOnly: true, level: null });
    const spec = buildCourseSpec(draft, structure);
    expect(spec.tags).toEqual(['quiz']);
    expect('level' in spec).toBe(false);
    expect('theoryPracticeRatio' in spec).toBe(false);
  });

  it('includes level + theoryPracticeRatio and omits `tags` when quizOnly=false (default)', () => {
    const draft = makeDraft({ quizOnly: false });
    const spec = buildCourseSpec(draft, structure);
    expect(spec.level).toBe('beginner');
    expect(spec.theoryPracticeRatio).toBe(0.5);
    expect('tags' in spec).toBe(false);
  });

  it('still carries durationTarget through in quiz-only mode', () => {
    const draft = makeDraft({ quizOnly: true, level: null, durationTarget: 'comprehensive' });
    const spec = buildCourseSpec(draft, structure);
    expect(spec.durationTarget).toBe('comprehensive');
  });
});
