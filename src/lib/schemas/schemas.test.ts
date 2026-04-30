import { describe, expect, it } from 'vitest';

import { CourseSchema } from '@/lib/schemas/course';
import { LessonSchema, SectionSchema } from '@/lib/schemas/lesson';
import { ProgressSchema } from '@/lib/schemas/progress';
import { CourseSpecSchema } from '@/lib/schemas/courseSpec';
import { TheoryDataSchema } from '@/widgets/Theory/schema';
import { QuizDataSchema } from '@/widgets/Quiz/schema';
import { CodeDataSchema } from '@/widgets/Code/schema';
import { DemoDataSchema } from '@/widgets/Demo/schema';
import { SandboxDataSchema } from '@/widgets/Sandbox/schema';

describe('CourseSchema', () => {
  const minimal = {
    slug: 'algebra',
    title: 'Algebra',
    description: 'Intro to algebra',
    accentColor: 'indigo',
    icon: 'sigma',
    modules: [],
    createdAt: '2026-04-30T00:00:00Z',
    updatedAt: '2026-04-30T00:00:00Z',
  };

  it('parses a minimal valid course', () => {
    expect(() => CourseSchema.parse(minimal)).not.toThrow();
  });

  it('rejects an unknown accentColor', () => {
    expect(() => CourseSchema.parse({ ...minimal, accentColor: 'magenta' })).toThrow();
  });

  it('throws on missing required field (slug)', () => {
    const broken: Partial<typeof minimal> = { ...minimal };
    delete broken.slug;
    expect(() => CourseSchema.parse(broken)).toThrow();
  });
});

describe('LessonSchema + SectionSchema', () => {
  const lesson = {
    slug: 'lesson-1',
    courseSlug: 'algebra',
    moduleId: 'm1',
    title: 'First lesson',
    eyebrow: 'INTRO',
    description: 'A first lesson',
    estimatedMinutes: 10,
    sections: [
      { id: 's1', title: 'Read', type: 'theory', data: { markdown: '# hi' } },
    ],
  };

  it('parses a minimal valid lesson', () => {
    expect(() => LessonSchema.parse(lesson)).not.toThrow();
  });

  it('throws on missing required field (title)', () => {
    const broken: Partial<typeof lesson> = { ...lesson };
    delete broken.title;
    expect(() => LessonSchema.parse(broken)).toThrow();
  });

  it('discriminated union accepts each known widget type', () => {
    const cases = [
      { id: 's1', title: 't', type: 'theory', data: { markdown: 'x' } },
      {
        id: 's2',
        title: 't',
        type: 'quiz',
        data: {
          question: 'q',
          options: ['a', 'b'],
          correct: [0],
          explanation: 'e',
          multiSelect: false,
        },
      },
      {
        id: 's3',
        title: 't',
        type: 'code',
        data: {
          taskMarkdown: 'do x',
          starterCode: 'pass',
          tests: [{ name: 't1', body: 'assert True' }],
        },
      },
      {
        id: 's4',
        title: 't',
        type: 'demo',
        data: {
          demoType: 'gauss',
          imageSrc: '/x.png',
          params: { sigmaMin: 0, sigmaMax: 5, sigmaDefault: 1 },
        },
      },
      {
        id: 's5',
        title: 't',
        type: 'sandbox',
        data: { starterCode: 'x = 1', encouragement: 'play' },
      },
      {
        id: 's6',
        title: 't',
        type: 'custom',
        data: { whatever: 1 },
      },
    ];
    for (const section of cases) {
      expect(() => SectionSchema.parse(section)).not.toThrow();
    }
  });

  it('discriminated union rejects an unknown widget type', () => {
    expect(() =>
      SectionSchema.parse({ id: 's', title: 't', type: 'mystery', data: {} }),
    ).toThrow();
  });
});

describe('Per-widget data schemas', () => {
  it('TheoryData: parses minimal, rejects missing markdown', () => {
    expect(() => TheoryDataSchema.parse({ markdown: 'hi' })).not.toThrow();
    expect(() => TheoryDataSchema.parse({})).toThrow();
  });

  it('QuizData: parses minimal, rejects missing question', () => {
    const ok = {
      question: 'q?',
      options: ['a', 'b'],
      correct: [0],
      explanation: 'because',
      multiSelect: false,
    };
    expect(() => QuizDataSchema.parse(ok)).not.toThrow();
    const broken: Partial<typeof ok> = { ...ok };
    delete broken.question;
    expect(() => QuizDataSchema.parse(broken)).toThrow();
  });

  it('CodeData: defaults test.hidden to true when omitted', () => {
    const parsed = CodeDataSchema.parse({
      taskMarkdown: 'do x',
      starterCode: '',
      tests: [{ name: 't1', body: 'pass' }],
    });
    expect(parsed.tests[0].hidden).toBe(true);
  });

  it('CodeData: rejects missing tests', () => {
    expect(() =>
      CodeDataSchema.parse({ taskMarkdown: 'm', starterCode: '' }),
    ).toThrow();
  });

  it('DemoData: parses minimal, rejects missing imageSrc', () => {
    const ok = {
      demoType: 'gauss',
      imageSrc: '/x.png',
      params: { sigmaMin: 0, sigmaMax: 5, sigmaDefault: 1 },
    };
    expect(() => DemoDataSchema.parse(ok)).not.toThrow();
    const broken: Partial<typeof ok> = { ...ok };
    delete broken.imageSrc;
    expect(() => DemoDataSchema.parse(broken)).toThrow();
  });

  it('SandboxData: parses minimal, rejects missing encouragement', () => {
    expect(() =>
      SandboxDataSchema.parse({ starterCode: 'x', encouragement: 'go' }),
    ).not.toThrow();
    expect(() => SandboxDataSchema.parse({ starterCode: 'x' })).toThrow();
  });
});

describe('ProgressSchema', () => {
  const minimal = { courses: {} };

  it('parses an empty progress object', () => {
    expect(() => ProgressSchema.parse(minimal)).not.toThrow();
  });

  it('parses nested course/lesson progress', () => {
    const ok = {
      courses: {
        algebra: {
          lastVisitedLessonSlug: 'lesson-1',
          lastVisitedAt: '2026-04-30T00:00:00Z',
          lessons: {
            'lesson-1': {
              status: 'started',
              startedAt: '2026-04-30T00:00:00Z',
              sectionState: {
                's1': { userCode: 'x = 1' },
              },
            },
          },
        },
      },
    };
    expect(() => ProgressSchema.parse(ok)).not.toThrow();
  });

  it('throws on missing required field (courses)', () => {
    expect(() => ProgressSchema.parse({})).toThrow();
  });

  it('rejects an unknown lesson status', () => {
    expect(() =>
      ProgressSchema.parse({
        courses: {
          algebra: { lessons: { 'l1': { status: 'paused' } } },
        },
      }),
    ).toThrow();
  });
});

describe('CourseSpecSchema', () => {
  const minimal = {
    topic: 'Linear algebra',
    level: 'beginner',
    durationTarget: '1h',
    theoryPracticeRatio: 0.5,
    draftStructure: {
      courseTitle: 'LA 101',
      courseDescription: 'Intro',
      modules: [
        {
          title: 'Vectors',
          lessons: [{ title: 'What is a vector?', summary: '...', estimatedMinutes: 10 }],
        },
      ],
    },
    createdAt: '2026-04-30T00:00:00Z',
  };

  it('parses a minimal valid spec', () => {
    expect(() => CourseSpecSchema.parse(minimal)).not.toThrow();
  });

  it('throws on missing required field (topic)', () => {
    const broken: Partial<typeof minimal> = { ...minimal };
    delete broken.topic;
    expect(() => CourseSpecSchema.parse(broken)).toThrow();
  });

  it('rejects an unknown level', () => {
    expect(() => CourseSpecSchema.parse({ ...minimal, level: 'expert' })).toThrow();
  });
});
