import { describe, expect, it } from 'vitest';

import { ProgressSchema, SectionStateSchema } from './progress';

describe('SectionStateSchema.widgetState', () => {
  const widgetState = {
    v: 1,
    marks: [{ t: 12.4, channel: 'T7-P7' }],
    view: { montage: 'LB', sensitivityUvPerMm: 10, lffHz: null },
    submitted: true,
  };

  it('keeps a widget-owned object verbatim (nested arrays, nulls, numbers)', () => {
    const parsed = SectionStateSchema.parse({
      done: true,
      score: { correct: 2, total: 3 },
      widgetState,
    });
    expect(parsed).toEqual({
      done: true,
      score: { correct: 2, total: 3 },
      widgetState,
    });
  });

  it('is optional, and absent keys are not invented', () => {
    expect(SectionStateSchema.parse({ done: true })).toEqual({ done: true });
    expect('widgetState' in SectionStateSchema.parse({})).toBe(false);
  });

  it('rejects a non-object widgetState', () => {
    expect(SectionStateSchema.safeParse({ widgetState: [1, 2] }).success).toBe(false);
    expect(SectionStateSchema.safeParse({ widgetState: 'marks' }).success).toBe(false);
  });

  it('survives a full progress-document round trip', () => {
    const doc = {
      courses: {
        c1: {
          lessons: {
            l1: {
              status: 'started',
              sectionState: { s1: { done: true, widgetState } },
            },
          },
        },
      },
    };
    const reparsed = ProgressSchema.parse(JSON.parse(JSON.stringify(ProgressSchema.parse(doc))));
    expect(reparsed.courses.c1.lessons.l1.sectionState?.s1.widgetState).toEqual(widgetState);
  });
});
