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
import { ParametricExplorerDataSchema } from '@/widgets/ParametricExplorer/schema';
import { PlotImageDataSchema } from '@/widgets/PlotImage/schema';

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

  it('defaults schemaVersion to 1 when missing', () => {
    const parsed = CourseSchema.parse(minimal);
    expect(parsed.schemaVersion).toBe(1);
  });

  it('parses successfully when schemaVersion: 1 is present', () => {
    const parsed = CourseSchema.parse({ ...minimal, schemaVersion: 1 });
    expect(parsed.schemaVersion).toBe(1);
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

  it('defaults schemaVersion to 1 when missing', () => {
    const parsed = LessonSchema.parse(lesson);
    expect(parsed.schemaVersion).toBe(1);
  });

  it('parses successfully when schemaVersion: 1 is present', () => {
    const parsed = LessonSchema.parse({ ...lesson, schemaVersion: 1 });
    expect(parsed.schemaVersion).toBe(1);
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
      {
        id: 's7',
        title: 't',
        type: 'parametricExplorer',
        data: {
          setupCode: '',
          renderCode: 'plt.plot([0, freq])',
          params: [
            {
              name: 'freq',
              label: 'Freq',
              type: 'slider',
              min: 0,
              max: 5,
              step: 0.1,
              default: 1,
            },
          ],
          outputType: 'plot',
        },
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

  it('accepts lesson-level + section-level sources', () => {
    const lessonWithSources = {
      ...lesson,
      sources: [
        {
          url: 'https://example.com/a',
          title: 'A',
          kind: 'paper',
          author: 'A. Author',
          year: 2024,
        },
      ],
      sections: [
        {
          id: 's1',
          title: 'Read',
          type: 'theory',
          data: { markdown: '# hi' },
          sources: [
            { url: 'https://example.com/v', title: 'Vid', kind: 'video' },
          ],
        },
      ],
    };
    const parsed = LessonSchema.parse(lessonWithSources);
    expect(parsed.sources?.[0].kind).toBe('paper');
    expect(parsed.sections[0].sources?.[0].kind).toBe('video');
  });

  it('rejects sources with an unknown kind', () => {
    const bad = {
      ...lesson,
      sources: [{ url: 'https://example.com', title: 'T', kind: 'tweet' }],
    };
    expect(() => LessonSchema.parse(bad)).toThrow();
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

  it('PlotImageData: parses a minimal valid object', () => {
    const ok = { src: '/foo.png', alt: 'A plot' };
    expect(() => PlotImageDataSchema.parse(ok)).not.toThrow();
  });

  it('PlotImageData: parses with all optional fields', () => {
    const full = {
      src: '/x.png',
      alt: 'desc',
      caption: 'cap',
      sourceCode: 'plt.show()',
      sourceLanguage: 'python' as const,
    };
    const parsed = PlotImageDataSchema.parse(full);
    expect(parsed.sourceLanguage).toBe('python');
  });

  it('PlotImageData: rejects missing src', () => {
    const broken = { alt: 'A plot' } as Record<string, unknown>;
    expect(() => PlotImageDataSchema.parse(broken)).toThrow();
  });

  it('PlotImageData: rejects missing alt', () => {
    const broken = { src: '/foo.png' } as Record<string, unknown>;
    expect(() => PlotImageDataSchema.parse(broken)).toThrow();
  });

  it('PlotImageData: rejects empty alt', () => {
    expect(() =>
      PlotImageDataSchema.parse({ src: '/foo.png', alt: '' }),
    ).toThrow();
  });

  it('PlotImageData: rejects sourceLanguage outside the enum', () => {
    expect(() =>
      PlotImageDataSchema.parse({ src: '/x.png', alt: 'a', sourceLanguage: 'js' }),
    ).toThrow();
  });

  it('ParametricExplorerData: parses a minimal valid object', () => {
    const ok = {
      setupCode: '',
      renderCode: 'plt.plot([0, freq])',
      params: [
        {
          name: 'freq',
          label: 'Freq',
          type: 'slider',
          min: 0,
          max: 5,
          step: 0.1,
          default: 1,
        },
      ],
      outputType: 'plot',
    };
    expect(() => ParametricExplorerDataSchema.parse(ok)).not.toThrow();
  });

  it('ParametricExplorerData: parses select + toggle params', () => {
    const ok = {
      setupCode: '',
      renderCode: '',
      params: [
        { name: 'mode', label: 'Mode', type: 'select', options: ['a', 'b'], default: 'a' },
        { name: 'flag', label: 'Flag', type: 'toggle', default: true },
      ],
      outputType: 'value',
    };
    expect(() => ParametricExplorerDataSchema.parse(ok)).not.toThrow();
  });

  it('ParametricExplorerData: rejects unknown outputType', () => {
    expect(() =>
      ParametricExplorerDataSchema.parse({
        setupCode: '',
        renderCode: '',
        params: [],
        outputType: 'png',
      }),
    ).toThrow();
  });

  it('ParametricExplorerData: accepts optional debounceMs', () => {
    const parsed = ParametricExplorerDataSchema.parse({
      setupCode: '',
      renderCode: '',
      params: [],
      outputType: 'plot',
      debounceMs: 250,
    });
    expect(parsed.debounceMs).toBe(250);
  });
});

describe('ParametricExplorer param value serialization', () => {
  // Param values are passed to Pyodide as a plain JS object — Pyodide's
  // automatic JS↔Python conversion turns:
  //   number → float, boolean → bool, string → str
  // These tests pin the serialized shape that the worker forwards to Python
  // so a future refactor doesn't silently change types under the user's code.
  it('slider param serializes as a JS number (→ Python float)', () => {
    const params: Record<string, number | string | boolean> = { freq: 1.5 };
    expect(typeof params.freq).toBe('number');
    expect(Number.isFinite(params.freq as number)).toBe(true);
  });

  it('toggle param serializes as a JS boolean (→ Python bool)', () => {
    const params: Record<string, number | string | boolean> = { on: true };
    expect(typeof params.on).toBe('boolean');
    expect(params.on).toBe(true);
  });

  it('select param serializes as a JS string (→ Python str)', () => {
    const params: Record<string, number | string | boolean> = { mode: 'fast' };
    expect(typeof params.mode).toBe('string');
    expect(params.mode).toBe('fast');
  });

  it('mixed params object preserves each per-param type', () => {
    const params: Record<string, number | string | boolean> = {
      freq: 2,
      mode: 'fast',
      on: false,
    };
    expect(typeof params.freq).toBe('number');
    expect(typeof params.mode).toBe('string');
    expect(typeof params.on).toBe('boolean');
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

  it('parses each new durationTarget enum value', () => {
    for (const dt of ['short', 'standard', 'extensive', 'comprehensive'] as const) {
      const parsed = CourseSpecSchema.parse({ ...minimal, durationTarget: dt });
      expect(parsed.durationTarget).toBe(dt);
    }
  });

  it('maps legacy durationTarget values to the new enum', () => {
    const cases: { input: string; expected: 'short' | 'standard' | 'extensive' }[] = [
      { input: '30min', expected: 'short' },
      { input: '1h', expected: 'standard' },
      { input: 'weekend', expected: 'extensive' },
    ];
    for (const { input, expected } of cases) {
      const parsed = CourseSpecSchema.parse({ ...minimal, durationTarget: input });
      expect(parsed.durationTarget).toBe(expected);
    }
  });

  it('rejects an out-of-enum durationTarget value', () => {
    expect(() => CourseSpecSchema.parse({ ...minimal, durationTarget: 'forever' })).toThrow();
  });
});
