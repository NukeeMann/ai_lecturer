import { describe, expect, it } from 'vitest';

import { EegCaseDataSchema, caseScore, currentStepIndex, eegCaseAssetPaths, gradeChoice, gradeMeasure, parseNumber } from './schema';
import { eegCaseSample } from './sample';

describe('EegCaseDataSchema', () => {
  it('parses the sample', () => {
    const d = EegCaseDataSchema.parse(eegCaseSample);
    expect(d.steps.map((s) => s.kind)).toEqual(['choice', 'mark', 'multi', 'measure', 'reveal']);
    expect(eegCaseAssetPaths(d)).toEqual(['/api/courses/eeg-widgets-test/assets/figures/aes-fig90.png']);
  });
  it('rejects mark steps without a figure, out-of-range indices and multi-correct single choice', () => {
    const noFig = { ...eegCaseSample, figure: undefined };
    expect(EegCaseDataSchema.safeParse(noFig).success).toBe(false);
    const bad = (step: object) => EegCaseDataSchema.safeParse({ ...eegCaseSample, steps: [step] }).success;
    expect(bad({ id: 'a', kind: 'choice', prompt: 'p', options: ['x', 'y'], correct: [2], explanation: 'e' })).toBe(false);
    expect(bad({ id: 'a', kind: 'choice', prompt: 'p', options: ['x', 'y'], correct: [0, 1], explanation: 'e' })).toBe(false);
    expect(bad({ id: 'a', kind: 'multi', prompt: 'p', options: ['x', 'y'], correct: [0, 1], explanation: 'e' })).toBe(true);
    const dupIds = { ...eegCaseSample, steps: [eegCaseSample.steps[0], eegCaseSample.steps[0]] };
    expect(EegCaseDataSchema.safeParse(dupIds).success).toBe(false);
  });
  it('rejects figure + viewer together', () => {
    expect(EegCaseDataSchema.safeParse({ ...eegCaseSample, viewer: { source: { kind: 'simulation', preset: 'blink' } } }).success).toBe(false);
  });
});

describe('grading helpers', () => {
  const d = EegCaseDataSchema.parse(eegCaseSample);
  const multi = d.steps[2] as Extract<(typeof d.steps)[number], { kind: 'multi' }>;
  const measure = d.steps[3] as Extract<(typeof d.steps)[number], { kind: 'measure' }>;
  it('grades multi-select as an exact set', () => {
    expect(gradeChoice(multi, [1, 0])).toBe(true);
    expect(gradeChoice(multi, [0])).toBe(false);
    expect(gradeChoice(multi, [0, 1, 2])).toBe(false);
  });
  it('grades measurements within tolerance and parses Polish decimals', () => {
    expect(gradeMeasure(measure, 950)).toBe(true);
    expect(gradeMeasure(measure, 1081)).toBe(false);
    expect(parseNumber('9,5 Hz')).toBe(9.5);
    expect(parseNumber('ok. 1000 ms')).toBe(1000);
    expect(Number.isNaN(parseNumber('abc'))).toBe(true);
  });
  it('tracks the current step and first-try score', () => {
    expect(currentStepIndex(d.steps, {})).toBe(0);
    const answers = {
      where: { attempts: 1, firstCorrect: true, done: true },
      mark: { attempts: 1, firstCorrect: false, done: true },
    };
    expect(currentStepIndex(d.steps, answers)).toBe(2);
    expect(caseScore(d.steps, answers)).toEqual({ correct: 1, total: 4 });
  });
});
