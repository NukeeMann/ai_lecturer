import { describe, expect, it } from 'vitest';
import {
  buildPromptContext,
  CONTEXT_CHAR_LIMIT,
  SYSTEM_PROMPT,
} from './context';
import type { Lesson } from '@/lib/schemas/lesson';

function baseLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    schemaVersion: 1,
    slug: 'l',
    courseSlug: 'c',
    moduleId: 'm1',
    title: 'Lesson Title',
    eyebrow: 'Module 1 · Lesson 1',
    description: 'A short description.',
    estimatedMinutes: 12,
    sections: [],
    ...overrides,
  } as Lesson;
}

describe('buildPromptContext', () => {
  it('returns the spec-mandated systemPrompt verbatim', () => {
    const result = buildPromptContext({ lesson: baseLesson() });
    expect(result.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(result.systemPrompt).toContain('AI tutor for an interactive online course');
    expect(result.systemPrompt).toContain('≤200 words');
  });

  describe('SYSTEM_PROMPT obeys explicit learner intent (US-062)', () => {
    it('does NOT contain blanket "do not reveal" / "never give direct solutions" instructions', () => {
      const lower = SYSTEM_PROMPT.toLowerCase();
      const forbidden = [
        'do not reveal',
        "don't reveal",
        'never reveal',
        'never give the answer',
        'never give direct',
        'never provide the answer',
        'do not give the answer',
        "don't give the answer",
        'do not share the answer',
        "don't share the answer",
      ];
      for (const phrase of forbidden) {
        expect(lower).not.toContain(phrase);
      }
    });

    it('instructs the tutor to give the direct answer when the learner explicitly asks for it', () => {
      // Fixture: representative explicit-ask user messages.
      const explicitAsks = [
        'just give me the answer',
        'tell me the solution',
        'show me the correct code',
        "what's the right option",
        'stop hinting, answer it',
      ];
      for (const ask of explicitAsks) {
        expect(SYSTEM_PROMPT).toContain(ask);
      }
      const lower = SYSTEM_PROMPT.toLowerCase();
      expect(lower).toContain('give the direct answer immediately');
      expect(lower).toContain("learner's explicit request always wins");
    });

    it('keeps Socratic/guiding style as the default branch when the learner has not explicitly asked', () => {
      const lower = SYSTEM_PROMPT.toLowerCase();
      expect(lower).toContain('default');
      expect(lower).toContain('socratic');
      expect(lower).toContain('hint');
      // Default branch must mention guiding without forbidding the reveal,
      // so that the OVERRIDE branch can win.
      expect(lower).toContain('guiding');
    });

    it('declares the override branch dominates the default branch', () => {
      // Both branches must be present, and the override must explicitly take
      // priority — otherwise the model could read the rules in either order
      // and silently default to deflection.
      expect(SYSTEM_PROMPT).toContain('DEFAULT');
      expect(SYSTEM_PROMPT).toContain('OVERRIDE');
      const overrideIndex = SYSTEM_PROMPT.indexOf('OVERRIDE');
      const winsIndex = SYSTEM_PROMPT.indexOf("explicit request always wins");
      expect(overrideIndex).toBeGreaterThan(-1);
      expect(winsIndex).toBeGreaterThan(overrideIndex);
    });
  });

  it('includes lesson metadata in the contextBlock', () => {
    const lesson = baseLesson({
      title: 'Filtr Gaussa',
      eyebrow: 'Moduł 1',
      description: 'Wprowadzenie do filtrowania.',
      estimatedMinutes: 18,
    });
    const { contextBlock } = buildPromptContext({ lesson });
    expect(contextBlock).toContain('Lesson title: Filtr Gaussa');
    expect(contextBlock).toContain('Eyebrow: Moduł 1');
    expect(contextBlock).toContain('Description: Wprowadzenie do filtrowania.');
    expect(contextBlock).toContain('Estimated minutes: 18');
  });

  it('renders the theory section markdown and tags it active when its id matches', () => {
    const lesson = baseLesson({
      sections: [
        {
          id: 's1',
          title: 'Intro',
          type: 'theory',
          data: { markdown: 'Convolution is a weighted sum.' },
        },
      ],
    });
    const { contextBlock } = buildPromptContext({
      lesson,
      currentSectionId: 's1',
    });
    expect(contextBlock).toContain('Section 1 [theory]: Intro [ACTIVE');
    expect(contextBlock).toContain('Convolution is a weighted sum.');
  });

  it('renders the quiz section question and options', () => {
    const lesson = baseLesson({
      sections: [
        {
          id: 'q1',
          title: 'Quiz 1',
          type: 'quiz',
          data: {
            question: 'What is a kernel?',
            options: ['A pixel', 'A weight matrix', 'A function'],
            correct: [1],
            explanation: 'A kernel is a small matrix.',
            multiSelect: false,
          },
        },
      ],
    });
    const { contextBlock } = buildPromptContext({
      lesson,
      currentSectionId: 'q1',
    });
    expect(contextBlock).toContain('Section 1 [quiz]: Quiz 1 [ACTIVE');
    expect(contextBlock).toContain('Question: What is a kernel?');
    expect(contextBlock).toContain('1. A pixel');
    expect(contextBlock).toContain('2. A weight matrix');
    expect(contextBlock).toContain('3. A function');
  });

  it('renders the code section task and starter code', () => {
    const lesson = baseLesson({
      sections: [
        {
          id: 'c1',
          title: 'Implement blur',
          type: 'code',
          data: {
            taskMarkdown: 'Write a function `blur(img)`.',
            starterCode: 'def blur(img):\n    pass\n',
            tests: [{ name: 't', body: 'assert True', hidden: true }],
          },
        },
      ],
    });
    const { contextBlock } = buildPromptContext({
      lesson,
      currentSectionId: 'c1',
    });
    expect(contextBlock).toContain('Section 1 [code]: Implement blur [ACTIVE');
    expect(contextBlock).toContain('Task:\nWrite a function `blur(img)`.');
    expect(contextBlock).toContain('Starter code:');
    expect(contextBlock).toContain('def blur(img):');
  });

  it('renders all sections with full bodies and marks the one matching currentSectionId as active', () => {
    const lesson = baseLesson({
      sections: [
        {
          id: 's1',
          title: 'Theory section',
          type: 'theory',
          data: { markdown: 'Theory body text.' },
        },
        {
          id: 'q1',
          title: 'Quiz section',
          type: 'quiz',
          data: {
            question: 'What?',
            options: ['a', 'b'],
            correct: [0],
            explanation: 'e',
            multiSelect: false,
          },
        },
      ],
    });
    const { contextBlock } = buildPromptContext({
      lesson,
      currentSectionId: 'q1',
    });
    expect(contextBlock).toContain('Lesson sections (full page content):');
    expect(contextBlock).toContain('Section 1 [theory]: Theory section');
    expect(contextBlock).not.toContain('Section 1 [theory]: Theory section [ACTIVE');
    expect(contextBlock).toContain('Theory body text.');
    expect(contextBlock).toContain('Section 2 [quiz]: Quiz section [ACTIVE');
    expect(contextBlock).toContain('Question: What?');
  });

  it('renders all sections with full bodies (no active marker) when currentSectionId is omitted', () => {
    const lesson = baseLesson({
      sections: [
        {
          id: 's1',
          title: 'Theory section',
          type: 'theory',
          data: { markdown: 'Theory body text.' },
        },
        {
          id: 'q1',
          title: 'Quiz section',
          type: 'quiz',
          data: {
            question: 'What?',
            options: ['a', 'b'],
            correct: [0],
            explanation: 'e',
            multiSelect: false,
          },
        },
      ],
    });
    const { contextBlock } = buildPromptContext({ lesson });
    expect(contextBlock).toContain('Lesson sections (full page content):');
    expect(contextBlock).toContain('Section 1 [theory]: Theory section');
    expect(contextBlock).toContain('Theory body text.');
    expect(contextBlock).toContain('Section 2 [quiz]: Quiz section');
    expect(contextBlock).toContain('Question: What?');
    expect(contextBlock).not.toContain('[ACTIVE');
  });

  it('still renders all sections with no active marker when the sectionId is unknown', () => {
    const lesson = baseLesson({
      sections: [
        {
          id: 's1',
          title: 'Only',
          type: 'theory',
          data: { markdown: 'x' },
        },
      ],
    });
    const { contextBlock } = buildPromptContext({
      lesson,
      currentSectionId: 'does-not-exist',
    });
    expect(contextBlock).toContain('Section 1 [theory]: Only');
    expect(contextBlock).not.toContain('[ACTIVE');
  });

  it('truncates the body and appends [truncated] when total exceeds the cap', () => {
    const huge = 'x'.repeat(CONTEXT_CHAR_LIMIT * 2);
    const lesson = baseLesson({
      sections: [
        {
          id: 's1',
          title: 'Big',
          type: 'theory',
          data: { markdown: huge },
        },
      ],
    });
    const { contextBlock } = buildPromptContext({
      lesson,
      currentSectionId: 's1',
    });
    expect(contextBlock.length).toBeLessThanOrEqual(CONTEXT_CHAR_LIMIT);
    expect(contextBlock.endsWith('… [truncated]')).toBe(true);
    // Header still preserved at the top.
    expect(contextBlock).toContain('Lesson title: Lesson Title');
  });
});
