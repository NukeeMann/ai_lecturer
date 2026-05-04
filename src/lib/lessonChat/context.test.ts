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

  it('renders the active theory section markdown when sectionId is given', () => {
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
    expect(contextBlock).toContain('Active section (theory): Intro');
    expect(contextBlock).toContain('Convolution is a weighted sum.');
  });

  it('renders the active quiz section question and options', () => {
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
    expect(contextBlock).toContain('Active section (quiz): Quiz 1');
    expect(contextBlock).toContain('Question: What is a kernel?');
    expect(contextBlock).toContain('1. A pixel');
    expect(contextBlock).toContain('2. A weight matrix');
    expect(contextBlock).toContain('3. A function');
  });

  it('renders the active code section task and starter code', () => {
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
    expect(contextBlock).toContain('Active section (code): Implement blur');
    expect(contextBlock).toContain('Task:\nWrite a function `blur(img)`.');
    expect(contextBlock).toContain('Starter code:');
    expect(contextBlock).toContain('def blur(img):');
  });

  it('falls back to a brief outline when currentSectionId is omitted', () => {
    const lesson = baseLesson({
      sections: [
        {
          id: 's1',
          title: 'Theory section',
          type: 'theory',
          data: { markdown: 'm' },
        },
        {
          id: 'q1',
          title: 'Quiz section',
          type: 'quiz',
          data: {
            question: 'q',
            options: ['a', 'b'],
            correct: [0],
            explanation: 'e',
            multiSelect: false,
          },
        },
      ],
    });
    const { contextBlock } = buildPromptContext({ lesson });
    expect(contextBlock).toContain('Lesson outline:');
    expect(contextBlock).toContain('- [theory] Theory section');
    expect(contextBlock).toContain('- [quiz] Quiz section');
    // Must not include the full theory body in outline mode.
    expect(contextBlock).not.toContain('Active section');
  });

  it('also falls back to outline when the sectionId is unknown', () => {
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
    expect(contextBlock).toContain('Lesson outline:');
    expect(contextBlock).toContain('- [theory] Only');
  });

  it('truncates the active section body when total exceeds the cap and appends [truncated]', () => {
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
