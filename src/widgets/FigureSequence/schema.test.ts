import { describe, expect, it } from 'vitest';

import {
  FigureSequenceDataSchema,
  compareInitial,
  figureSequenceAssetPaths,
  initialIndex,
  isSequenceComplete,
  tickLabelIndices,
} from './schema';
import { figureSequenceSample } from './sample';

describe('FigureSequenceDataSchema', () => {
  it('parses the sample', () => {
    const d = FigureSequenceDataSchema.parse(figureSequenceSample);
    expect(d.layout).toBe('slider');
    expect(figureSequenceAssetPaths(d)).toHaveLength(4);
    expect(initialIndex(d)).toBe(0);
  });
  it('rejects unknown initial/compare frames, duplicates and single frames', () => {
    const bad = (patch: object) => FigureSequenceDataSchema.safeParse({ ...figureSequenceSample, ...patch }).success;
    expect(bad({ initialFrame: 'x' })).toBe(false);
    expect(bad({ compareDefaults: ['m11', 'zz'] })).toBe(false);
    expect(bad({ frames: [figureSequenceSample.frames[0]] })).toBe(false);
    expect(bad({ frames: [figureSequenceSample.frames[0], figureSequenceSample.frames[0]] })).toBe(false);
  });
  it('resolves initial and compare frames', () => {
    const d = FigureSequenceDataSchema.parse({ ...figureSequenceSample, initialFrame: 'm16', compareDefaults: ['y10', 'm11'] });
    expect(initialIndex(d)).toBe(2);
    expect(compareInitial(d)).toEqual([3, 0]);
  });
});

describe('helpers', () => {
  it('completes after all frames (stepper/slider) or interaction (compare)', () => {
    expect(isSequenceComplete('slider', ['a', 'b'], 3, true)).toBe(false);
    expect(isSequenceComplete('stepper', ['a', 'b', 'c', 'a'], 3, false)).toBe(true);
    expect(isSequenceComplete('compare', [], 3, true)).toBe(true);
  });
  it('thins slider labels, keeping first and last', () => {
    expect(tickLabelIndices(4, 6)).toEqual([0, 1, 2, 3]);
    const t = tickLabelIndices(12, 4);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(11);
    expect(t.length).toBeLessThanOrEqual(4);
  });
});
