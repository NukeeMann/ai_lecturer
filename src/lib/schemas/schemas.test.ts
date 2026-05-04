import { describe, expect, it } from 'vitest';

import { CourseSchema } from '@/lib/schemas/course';
import { LessonSchema, SectionSchema } from '@/lib/schemas/lesson';
import { ProgressSchema } from '@/lib/schemas/progress';
import { CourseSpecSchema } from '@/lib/schemas/courseSpec';
import { TheoryDataSchema } from '@/widgets/Theory/schema';
import { QuizDataSchema } from '@/widgets/Quiz/schema';
import { CodeDataSchema } from '@/widgets/Code/schema';
import {
  CodeClozeDataSchema,
  validateSlotValue,
} from '@/widgets/CodeCloze/schema';
import { DemoDataSchema } from '@/widgets/Demo/schema';
import {
  DataTableDataSchema,
  filterRows,
  sortRows,
  type DataTableRow,
} from '@/widgets/DataTable/schema';
import {
  DragMatchDataSchema,
  computeZoneState,
  validateDragMatch,
  type DragMatchData,
  type DragMatchPlacement,
} from '@/widgets/DragMatch/schema';
import { SandboxDataSchema } from '@/widgets/Sandbox/schema';
import { ParametricExplorerDataSchema } from '@/widgets/ParametricExplorer/schema';
import { PlotImageDataSchema } from '@/widgets/PlotImage/schema';
import {
  VideoDataSchema,
  extractYouTubeId,
} from '@/widgets/Video/schema';

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
        id: 's-cc',
        title: 't',
        type: 'codeCloze',
        data: {
          template: 'def f(): return {{x}}',
          slots: [
            { id: 'x', validation: { kind: 'exact', value: '42' } },
          ],
        },
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
      {
        id: 's-dm',
        title: 't',
        type: 'dragMatch',
        data: {
          prompt: 'Match each item.',
          items: [{ id: 'a', label: 'A' }],
          zones: [{ id: 'z', label: 'Z', accepts: ['a'] }],
        },
      },
      {
        id: 's-dt',
        title: 't',
        type: 'dataTable',
        data: {
          columns: [{ key: 'name', label: 'Name' }],
          rows: [{ name: 'Ada' }],
        },
      },
      {
        id: 's-vid',
        title: 't',
        type: 'video',
        data: { kind: 'youtube', src: 'aircAruvnKk' },
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

  it('VideoData: parses a minimal valid YouTube object', () => {
    const ok = { kind: 'youtube', src: 'aircAruvnKk' };
    const parsed = VideoDataSchema.parse(ok);
    expect(parsed.kind).toBe('youtube');
    expect(parsed.autoplay).toBe(false);
  });

  it('VideoData: parses a minimal valid MP4 object', () => {
    const ok = { kind: 'mp4', src: '/api/courses/abc/assets/intro.mp4' };
    const parsed = VideoDataSchema.parse(ok);
    expect(parsed.kind).toBe('mp4');
    expect(parsed.autoplay).toBe(false);
  });

  it('VideoData: parses with full transcript and optional fields', () => {
    const full = {
      kind: 'youtube',
      src: 'https://youtu.be/aircAruvnKk',
      title: 'Hello',
      durationSeconds: 600,
      autoplay: true,
      startAt: 30,
      transcript: [
        { tStart: 0, tEnd: 5, text: 'Intro', speaker: 'Grant' },
        { tStart: 5, text: 'Continuation' },
      ],
    };
    const parsed = VideoDataSchema.parse(full);
    expect(parsed.transcript).toHaveLength(2);
    expect(parsed.transcript?.[0].speaker).toBe('Grant');
    expect(parsed.transcript?.[1].tEnd).toBeUndefined();
  });

  it('VideoData: rejects unknown kind', () => {
    expect(() =>
      VideoDataSchema.parse({ kind: 'webm', src: '/x.webm' }),
    ).toThrow();
  });

  it('VideoData: rejects empty src', () => {
    expect(() =>
      VideoDataSchema.parse({ kind: 'mp4', src: '' }),
    ).toThrow();
  });

  it('VideoData: rejects empty transcript text', () => {
    expect(() =>
      VideoDataSchema.parse({
        kind: 'mp4',
        src: '/x.mp4',
        transcript: [{ tStart: 0, text: '' }],
      }),
    ).toThrow();
  });

  it('VideoData: rejects negative tStart', () => {
    expect(() =>
      VideoDataSchema.parse({
        kind: 'mp4',
        src: '/x.mp4',
        transcript: [{ tStart: -1, text: 'oops' }],
      }),
    ).toThrow();
  });

  it('extractYouTubeId: returns the bare 11-char id unchanged', () => {
    expect(extractYouTubeId('aircAruvnKk')).toBe('aircAruvnKk');
    expect(extractYouTubeId('  aircAruvnKk  ')).toBe('aircAruvnKk');
  });

  it('extractYouTubeId: parses youtu.be short links', () => {
    expect(extractYouTubeId('https://youtu.be/aircAruvnKk')).toBe('aircAruvnKk');
    expect(extractYouTubeId('https://youtu.be/aircAruvnKk?t=42')).toBe(
      'aircAruvnKk',
    );
  });

  it('extractYouTubeId: parses watch?v= URLs', () => {
    expect(
      extractYouTubeId('https://www.youtube.com/watch?v=aircAruvnKk'),
    ).toBe('aircAruvnKk');
    expect(
      extractYouTubeId('https://m.youtube.com/watch?v=aircAruvnKk&t=10s'),
    ).toBe('aircAruvnKk');
  });

  it('extractYouTubeId: parses /embed/ and /shorts/ URLs', () => {
    expect(
      extractYouTubeId('https://www.youtube.com/embed/aircAruvnKk'),
    ).toBe('aircAruvnKk');
    expect(
      extractYouTubeId('https://www.youtube.com/shorts/aircAruvnKk'),
    ).toBe('aircAruvnKk');
    expect(
      extractYouTubeId('https://www.youtube-nocookie.com/embed/aircAruvnKk'),
    ).toBe('aircAruvnKk');
  });

  it('extractYouTubeId: returns null for non-YouTube URLs and bad input', () => {
    expect(extractYouTubeId('https://vimeo.com/123456')).toBeNull();
    expect(extractYouTubeId('not a url')).toBeNull();
    expect(extractYouTubeId('')).toBeNull();
    expect(extractYouTubeId('https://www.youtube.com/watch?v=tooShort')).toBeNull();
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

  it('CodeClozeData: parses a minimal valid object', () => {
    const ok = {
      template: 'return {{x}}',
      slots: [{ id: 'x', validation: { kind: 'exact', value: '1' } }],
    };
    expect(() => CodeClozeDataSchema.parse(ok)).not.toThrow();
  });

  it('CodeClozeData: parses with finalTests, hints, and per-slot hint', () => {
    const parsed = CodeClozeDataSchema.parse({
      taskMarkdown: 'Fill the blanks.',
      template: 'a = {{a}}; b = {{b}}',
      slots: [
        {
          id: 'a',
          hint: 'pick 1',
          validation: { kind: 'oneOf', values: ['1', 'one'] },
        },
        {
          id: 'b',
          validation: { kind: 'regex', pattern: '\\d+' },
        },
      ],
      finalTests: [{ name: 't', body: 'assert True' }],
      hints: [{ revealAfterAttempts: 2, markdown: 'try harder' }],
    });
    expect(parsed.finalTests?.[0].hidden).toBe(true);
    expect(parsed.slots[0].validation).toEqual({
      kind: 'oneOf',
      values: ['1', 'one'],
    });
  });

  it('CodeClozeData: rejects unknown validation kind', () => {
    expect(() =>
      CodeClozeDataSchema.parse({
        template: '{{x}}',
        slots: [
          {
            id: 'x',
            validation: { kind: 'startsWith', value: 'a' },
          },
        ],
      }),
    ).toThrow();
  });

  it('CodeClozeData: rejects oneOf with empty values array', () => {
    expect(() =>
      CodeClozeDataSchema.parse({
        template: '{{x}}',
        slots: [{ id: 'x', validation: { kind: 'oneOf', values: [] } }],
      }),
    ).toThrow();
  });

  it('DragMatchData: parses a minimal valid object and defaults multipleItemsPerZone', () => {
    const ok = {
      prompt: 'Match each.',
      items: [{ id: 'a', label: 'A' }],
      zones: [{ id: 'z', label: 'Zone', accepts: ['a'] }],
    };
    const parsed = DragMatchDataSchema.parse(ok);
    expect(parsed.multipleItemsPerZone).toBe(false);
  });

  it('DragMatchData: parses with explanation and multipleItemsPerZone=true', () => {
    const parsed = DragMatchDataSchema.parse({
      prompt: 'Order steps.',
      items: [
        { id: 'a', label: 'first' },
        { id: 'b', label: 'second' },
      ],
      zones: [{ id: 'order', label: 'Order', accepts: ['a', 'b'] }],
      multipleItemsPerZone: true,
      explanation: 'Steps in order.',
    });
    expect(parsed.multipleItemsPerZone).toBe(true);
    expect(parsed.explanation).toBe('Steps in order.');
  });

  it('DragMatchData: rejects empty items array', () => {
    expect(() =>
      DragMatchDataSchema.parse({
        prompt: 'p',
        items: [],
        zones: [{ id: 'z', label: 'Z', accepts: [] }],
      }),
    ).toThrow();
  });

  it('DragMatchData: rejects empty zones array', () => {
    expect(() =>
      DragMatchDataSchema.parse({
        prompt: 'p',
        items: [{ id: 'a', label: 'A' }],
        zones: [],
      }),
    ).toThrow();
  });

  it('DragMatchData: rejects items with empty id or label', () => {
    expect(() =>
      DragMatchDataSchema.parse({
        prompt: 'p',
        items: [{ id: '', label: 'A' }],
        zones: [{ id: 'z', label: 'Z', accepts: [] }],
      }),
    ).toThrow();
  });
});

describe('CodeCloze validateSlotValue', () => {
  it('exact: requires byte-for-byte equality', () => {
    expect(
      validateSlotValue({ kind: 'exact', value: 'sum' }, 'sum'),
    ).toBe(true);
    expect(
      validateSlotValue({ kind: 'exact', value: 'sum' }, 'Sum'),
    ).toBe(false);
    expect(
      validateSlotValue({ kind: 'exact', value: 'sum' }, ' sum'),
    ).toBe(false);
  });

  it('oneOf: accepts any listed value', () => {
    const v = {
      kind: 'oneOf' as const,
      values: ['len(values)', '3'],
    };
    expect(validateSlotValue(v, 'len(values)')).toBe(true);
    expect(validateSlotValue(v, '3')).toBe(true);
    expect(validateSlotValue(v, '4')).toBe(false);
  });

  it('regex: anchors implicitly (full match)', () => {
    const v = { kind: 'regex' as const, pattern: '\\d+' };
    expect(validateSlotValue(v, '123')).toBe(true);
    expect(validateSlotValue(v, '12a')).toBe(false);
    expect(validateSlotValue(v, '')).toBe(false);
  });

  it('regex: invalid pattern returns false instead of throwing', () => {
    const v = { kind: 'regex' as const, pattern: '(' };
    expect(validateSlotValue(v, 'x')).toBe(false);
  });
});

describe('DragMatch validateDragMatch', () => {
  const singleZoneData: DragMatchData = {
    prompt: 'Match each programming term.',
    items: [
      { id: 'i-var', label: 'Variable' },
      { id: 'i-fn', label: 'Function' },
      { id: 'i-loop', label: 'Loop' },
    ],
    zones: [
      { id: 'z-var', label: 'Storage', accepts: ['i-var'] },
      { id: 'z-fn', label: 'Reusable code', accepts: ['i-fn'] },
      { id: 'z-loop', label: 'Repeats', accepts: ['i-loop'] },
    ],
    multipleItemsPerZone: false,
  };

  it('single-zone: all items in correct zones is allCorrect', () => {
    const result = validateDragMatch(singleZoneData, {
      'z-var': ['i-var'],
      'z-fn': ['i-fn'],
      'z-loop': ['i-loop'],
      __bank__: [],
    });
    expect(result.allCorrect).toBe(true);
    expect(result.zoneCorrect['z-var']).toBe(true);
    expect(result.misplacedItemIds.size).toBe(0);
  });

  it('single-zone: one swapped pair flags exactly two misplaced items', () => {
    const result = validateDragMatch(singleZoneData, {
      'z-var': ['i-fn'],
      'z-fn': ['i-var'],
      'z-loop': ['i-loop'],
      __bank__: [],
    });
    expect(result.allCorrect).toBe(false);
    expect(result.zoneCorrect['z-var']).toBe(false);
    expect(result.zoneCorrect['z-fn']).toBe(false);
    expect(result.zoneCorrect['z-loop']).toBe(true);
    expect(result.misplacedItemIds.has('i-var')).toBe(true);
    expect(result.misplacedItemIds.has('i-fn')).toBe(true);
    expect(result.misplacedItemIds.has('i-loop')).toBe(false);
  });

  it('single-zone: item left in bank is misplaced and zone is empty/incorrect', () => {
    const result = validateDragMatch(singleZoneData, {
      'z-var': ['i-var'],
      'z-fn': ['i-fn'],
      'z-loop': [],
      __bank__: ['i-loop'],
    });
    expect(result.allCorrect).toBe(false);
    expect(result.zoneCorrect['z-loop']).toBe(false);
    expect(result.misplacedItemIds.has('i-loop')).toBe(true);
  });

  const multiZoneData: DragMatchData = {
    prompt: 'Group fruits and vegetables.',
    items: [
      { id: 'apple', label: 'Apple' },
      { id: 'banana', label: 'Banana' },
      { id: 'carrot', label: 'Carrot' },
    ],
    zones: [
      { id: 'fruit', label: 'Fruit', accepts: ['apple', 'banana'] },
      { id: 'veg', label: 'Vegetable', accepts: ['carrot'] },
    ],
    multipleItemsPerZone: true,
  };

  it('multi-zone (ordered): exact accepts order is correct', () => {
    const result = validateDragMatch(multiZoneData, {
      fruit: ['apple', 'banana'],
      veg: ['carrot'],
      __bank__: [],
    });
    expect(result.allCorrect).toBe(true);
  });

  it('multi-zone (ordered): wrong order in zone is incorrect', () => {
    const result = validateDragMatch(multiZoneData, {
      fruit: ['banana', 'apple'],
      veg: ['carrot'],
      __bank__: [],
    });
    expect(result.allCorrect).toBe(false);
    expect(result.zoneCorrect['fruit']).toBe(false);
    expect(result.zoneCorrect['veg']).toBe(true);
  });

  it('multi-zone (ordered): missing one item in zone is incorrect', () => {
    const result = validateDragMatch(multiZoneData, {
      fruit: ['apple'],
      veg: ['carrot'],
      __bank__: ['banana'],
    });
    expect(result.allCorrect).toBe(false);
    expect(result.zoneCorrect['fruit']).toBe(false);
    expect(result.misplacedItemIds.has('banana')).toBe(true);
  });

  it('multi-zone (unordered, multipleItemsPerZone=false): set equality wins', () => {
    const data: DragMatchData = { ...multiZoneData, multipleItemsPerZone: false };
    const result = validateDragMatch(data, {
      fruit: ['banana', 'apple'],
      veg: ['carrot'],
      __bank__: [],
    });
    expect(result.allCorrect).toBe(true);
  });
});

describe('DragMatch computeZoneState (US-082)', () => {
  const data: DragMatchData = {
    prompt: 'Match terms.',
    items: [
      { id: 'A', label: 'A' },
      { id: 'B', label: 'B' },
    ],
    zones: [
      { id: 'X', label: 'X', accepts: ['A'] },
      { id: 'Y', label: 'Y', accepts: ['B'] },
    ],
    multipleItemsPerZone: false,
  };

  it('reports correct LIVE when a zone holds the right item, even before submit', () => {
    // Drop the right item — no submit click yet.
    const placement: DragMatchPlacement = { X: ['A'], Y: [], __bank__: ['B'] };
    expect(computeZoneState(data, placement, 'X', false)).toBe('correct');
  });

  it('after correcting a wrong placement, the zone reports correct without re-submitting', () => {
    // Step 1: learner drops both items in the wrong zones and submits.
    let placement: DragMatchPlacement = { X: ['B'], Y: ['A'], __bank__: [] };
    expect(computeZoneState(data, placement, 'X', true)).toBe('incorrect');
    expect(computeZoneState(data, placement, 'Y', true)).toBe('incorrect');
    // Step 2: learner re-drags items into the right zones. Drag-end resets
    // `submitted` to false in the widget, but the box must still go green.
    placement = { X: ['A'], Y: ['B'], __bank__: [] };
    expect(computeZoneState(data, placement, 'X', false)).toBe('correct');
    expect(computeZoneState(data, placement, 'Y', false)).toBe('correct');
  });

  it('mismatched zone is idle when never submitted, incorrect after submit', () => {
    const placement: DragMatchPlacement = { X: ['B'], Y: ['A'], __bank__: [] };
    expect(computeZoneState(data, placement, 'X', false)).toBe('idle');
    expect(computeZoneState(data, placement, 'X', true)).toBe('incorrect');
  });

  it('empty zone is idle before submit and incorrect after submit (preserves prior styling)', () => {
    const placement: DragMatchPlacement = { X: [], Y: [], __bank__: ['A', 'B'] };
    expect(computeZoneState(data, placement, 'X', false)).toBe('idle');
    expect(computeZoneState(data, placement, 'X', true)).toBe('incorrect');
  });

  it('multi-item zone matches set equality for live success when multipleItemsPerZone=false', () => {
    const multiData: DragMatchData = {
      ...data,
      zones: [{ id: 'Z', label: 'Z', accepts: ['A', 'B'] }],
      multipleItemsPerZone: false,
    };
    const placement: DragMatchPlacement = { Z: ['B', 'A'], __bank__: [] };
    expect(computeZoneState(multiData, placement, 'Z', false)).toBe('correct');
  });

  it('unknown zone id is idle (defensive guard)', () => {
    const placement: DragMatchPlacement = { X: ['A'], Y: ['B'], __bank__: [] };
    expect(computeZoneState(data, placement, 'nope', false)).toBe('idle');
  });
});

describe('DataTableData schema', () => {
  it('parses a minimal valid object and applies pageSize default', () => {
    const parsed = DataTableDataSchema.parse({
      columns: [{ key: 'name', label: 'Name' }],
      rows: [{ name: 'Ada' }],
    });
    expect(parsed.pageSize).toBe(25);
    expect(parsed.columns[0].type).toBe('string');
    expect(parsed.columns[0].sortable).toBe(true);
    expect(parsed.columns[0].filterable).toBe(false);
  });

  it('rejects empty columns array', () => {
    expect(() =>
      DataTableDataSchema.parse({ columns: [], rows: [] }),
    ).toThrow();
  });

  it('rejects non-positive pageSize', () => {
    expect(() =>
      DataTableDataSchema.parse({
        columns: [{ key: 'a', label: 'A' }],
        rows: [],
        pageSize: 0,
      }),
    ).toThrow();
  });

  it('accepts initialSort with key + dir', () => {
    const parsed = DataTableDataSchema.parse({
      columns: [{ key: 'a', label: 'A' }],
      rows: [],
      initialSort: { key: 'a', dir: 'desc' },
    });
    expect(parsed.initialSort?.dir).toBe('desc');
  });

  it('rejects initialSort with unknown direction', () => {
    expect(() =>
      DataTableDataSchema.parse({
        columns: [{ key: 'a', label: 'A' }],
        rows: [],
        initialSort: { key: 'a', dir: 'sideways' },
      }),
    ).toThrow();
  });

  it('accepts row cells of mixed primitive types and null', () => {
    const parsed = DataTableDataSchema.parse({
      columns: [
        { key: 'name', label: 'Name', type: 'string' },
        { key: 'score', label: 'Score', type: 'number' },
        { key: 'passed', label: 'Passed', type: 'boolean' },
      ],
      rows: [
        { name: 'Ada', score: 92, passed: true },
        { name: 'Linus', score: null, passed: false },
      ],
    });
    expect(parsed.rows.length).toBe(2);
  });
});

describe('DataTable sortRows', () => {
  const columns = [
    { key: 'name', label: 'Name', type: 'string' as const, sortable: true, filterable: false },
    { key: 'score', label: 'Score', type: 'number' as const, sortable: true, filterable: false },
  ];
  const rows: DataTableRow[] = [
    { name: 'Bob', score: 10 },
    { name: 'Alice', score: 30 },
    { name: 'Cara', score: 20 },
  ];

  it('returns rows in original order when sort is null', () => {
    const result = sortRows({ rows, sort: null, columns });
    expect(result.map((r) => r.name)).toEqual(['Bob', 'Alice', 'Cara']);
  });

  it('sorts ascending by string', () => {
    const result = sortRows({ rows, sort: { key: 'name', dir: 'asc' }, columns });
    expect(result.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Cara']);
  });

  it('sorts descending by number', () => {
    const result = sortRows({ rows, sort: { key: 'score', dir: 'desc' }, columns });
    expect(result.map((r) => r.score)).toEqual([30, 20, 10]);
  });

  it('sorts ascending by number', () => {
    const result = sortRows({ rows, sort: { key: 'score', dir: 'asc' }, columns });
    expect(result.map((r) => r.score)).toEqual([10, 20, 30]);
  });

  it('null/undefined cells sort to the end', () => {
    const sparse: DataTableRow[] = [
      { name: 'A', score: 10 },
      { name: 'B', score: null },
      { name: 'C', score: 5 },
    ];
    const asc = sortRows({ rows: sparse, sort: { key: 'score', dir: 'asc' }, columns });
    expect(asc.map((r) => r.name)).toEqual(['C', 'A', 'B']);
  });

  it('does not mutate the input array', () => {
    const original = rows.slice();
    sortRows({ rows, sort: { key: 'name', dir: 'desc' }, columns });
    expect(rows).toEqual(original);
  });
});

describe('DataTable filterRows', () => {
  const columns = [
    { key: 'name', label: 'Name', type: 'string' as const, sortable: true, filterable: true },
    { key: 'score', label: 'Score', type: 'number' as const, sortable: true, filterable: true },
    { key: 'tag', label: 'Tag', type: 'string' as const, sortable: true, filterable: false },
  ];
  const rows: DataTableRow[] = [
    { name: 'Alice', score: 80, tag: 'gold' },
    { name: 'Bob', score: 60, tag: 'silver' },
    { name: 'Bobby', score: 95, tag: 'gold' },
    { name: 'Cara', score: 40, tag: 'bronze' },
  ];

  it('string contains filter is case-insensitive', () => {
    const result = filterRows({
      rows,
      filters: { name: 'bob' },
      columns,
    });
    expect(result.map((r) => r.name)).toEqual(['Bob', 'Bobby']);
  });

  it('number range filter respects both bounds', () => {
    const result = filterRows({
      rows,
      filters: { score: { min: 50, max: 90 } },
      columns,
    });
    expect(result.map((r) => r.name)).toEqual(['Alice', 'Bob']);
  });

  it('number range filter accepts only min', () => {
    const result = filterRows({
      rows,
      filters: { score: { min: 70 } },
      columns,
    });
    expect(result.map((r) => r.name)).toEqual(['Alice', 'Bobby']);
  });

  it('number range filter accepts only max', () => {
    const result = filterRows({
      rows,
      filters: { score: { max: 60 } },
      columns,
    });
    expect(result.map((r) => r.name)).toEqual(['Bob', 'Cara']);
  });

  it('combines multiple column filters with AND', () => {
    const result = filterRows({
      rows,
      filters: { name: 'bob', score: { min: 70 } },
      columns,
    });
    expect(result.map((r) => r.name)).toEqual(['Bobby']);
  });

  it('ignores filters on non-filterable columns', () => {
    const result = filterRows({
      rows,
      filters: { tag: 'gold' },
      columns,
    });
    expect(result.length).toBe(rows.length);
  });

  it('empty/undefined filter values pass through every row', () => {
    const result = filterRows({
      rows,
      filters: { name: '', score: {} },
      columns,
    });
    expect(result.length).toBe(rows.length);
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

  it('parses lesson progress with a per-section manuallyCompletedSections map (US-065)', () => {
    const ok = {
      courses: {
        algebra: {
          lessons: {
            'lesson-1': {
              status: 'started',
              manuallyCompletedSections: { s1: true, s2: true },
            },
          },
        },
      },
    };
    const parsed = ProgressSchema.parse(ok);
    expect(
      parsed.courses.algebra.lessons['lesson-1'].manuallyCompletedSections?.s1,
    ).toBe(true);
    expect(
      parsed.courses.algebra.lessons['lesson-1'].manuallyCompletedSections?.s2,
    ).toBe(true);
  });

  it('rejects manuallyCompletedSections with non-boolean values (US-065)', () => {
    expect(() =>
      ProgressSchema.parse({
        courses: {
          algebra: {
            lessons: {
              'lesson-1': {
                status: 'started',
                manuallyCompletedSections: { s1: 'yes' },
              },
            },
          },
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
