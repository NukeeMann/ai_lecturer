// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import Stage3Cascade, {
  type Draft,
  type StructureDraft,
} from './Stage3Cascade';

afterEach(() => {
  cleanup();
});

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

function makeDraft(quizOnly: boolean): Draft {
  return {
    topic: 'Linear algebra',
    description: '',
    level: quizOnly ? null : 'beginner',
    durationTarget: 'short',
    theoryPracticeRatio: 50,
    quizOnly,
    clarificationQuestions: undefined,
    clarification: undefined,
    structure,
  };
}

describe('Stage3Cascade — US-191 quiz-only mode', () => {
  it('does not render the level control nor the ratio slider when quizOnly=true', () => {
    const { container } = render(
      <Stage3Cascade
        draft={makeDraft(true)}
        setDraft={() => {}}
        onNext={() => {}}
        onBack={() => {}}
      />,
    );
    // Level + ratio test ids are owned by Stage 2 (Refine); they must NOT
    // surface inside the Stage 3 (Cascade) subtree under any condition, and
    // explicitly not when the learner has opted into quiz-only mode.
    expect(
      container.querySelector('[data-testid="stage2-level-group"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="stage2-level-beginner"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="stage2-level-intermediate"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="stage2-level-advanced"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="stage2-ratio-slider"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="stage2-ratio-label"]'),
    ).toBeNull();
  });
});
