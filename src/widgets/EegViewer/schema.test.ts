import { describe, expect, it } from 'vitest';

import {
  EegViewerDataSchema,
  EegViewerStateSchema,
  clampStart,
  describeViewerState,
  eegViewerAssetPaths,
  pageStart,
  resolveInitialSettings,
  withValue,
} from './schema';
import { eegViewerSample } from './sample';

describe('EegViewerDataSchema', () => {
  it('parses the sample and applies defaults', () => {
    const d = EegViewerDataSchema.parse(eegViewerSample);
    expect(d.controls).toEqual({ montage: true, sensitivity: true, timebase: true, filters: true, caliper: true, navigation: true });
    expect(d.annotations).toBe('toggle');
    expect(d.task?.toleranceSec).toBe(0.3);
    expect(d.task?.requireChannel).toBe(false);
  });

  it('accepts a recording source and reports its asset path', () => {
    const d = EegViewerDataSchema.parse({ source: { kind: 'recording', src: '/api/courses/c/assets/eeg/x.json' } });
    expect(eegViewerAssetPaths(d)).toEqual(['/api/courses/c/assets/eeg/x.json']);
    expect(eegViewerAssetPaths(EegViewerDataSchema.parse(eegViewerSample))).toEqual([]);
  });

  it('rejects a simulation without preset or spec, unknown presets and missing source', () => {
    expect(EegViewerDataSchema.safeParse({ source: { kind: 'simulation' } }).success).toBe(false);
    expect(EegViewerDataSchema.safeParse({ source: { kind: 'simulation', preset: 'nope' } }).success).toBe(false);
    expect(EegViewerDataSchema.safeParse({}).success).toBe(false);
  });

  it('rejects duplicate target ids and offset before onset', () => {
    const base = { kind: 'markEvents', prompt: 'p', explanation: 'e' };
    const dup = { ...base, targets: [{ id: 'a', onsetSec: 1, label: 'x' }, { id: 'a', onsetSec: 2, label: 'y' }] };
    const bad = { ...base, targets: [{ id: 'a', onsetSec: 3, offsetSec: 2, label: 'x' }] };
    expect(EegViewerDataSchema.safeParse({ source: eegViewerSample.source, task: dup }).success).toBe(false);
    expect(EegViewerDataSchema.safeParse({ source: eegViewerSample.source, task: bad }).success).toBe(false);
  });

  it('accepts a custom simulation spec', () => {
    const spec = { durationSec: 5, components: [{ kind: 'blink', times: [1, 3] }] };
    expect(EegViewerDataSchema.safeParse({ source: { kind: 'simulation', spec } }).success).toBe(true);
  });
});

describe('display settings helpers', () => {
  const data = EegViewerDataSchema.parse({ source: { kind: 'simulation', preset: 'blink' }, initial: { montage: 'avg', startSec: 99 } });

  it('resolves montage case-insensitively, clamps start, uses 5 s pages on narrow screens', () => {
    const s = resolveInitialSettings(data, { availableMontages: ['LB', 'AVG'], durationSec: 30, narrow: true });
    expect(s.montage).toBe('AVG');
    expect(s.secondsPerPage).toBe(5);
    expect(s.startSec).toBe(25);
    expect(s.lffHz).toBe(0.5);
    expect(s.hffHz).toBe(70);
    expect(s.notchHz).toBeNull();
  });

  it('falls back to the first available montage', () => {
    const s = resolveInitialSettings(data, { availableMontages: ['NATIVE'], durationSec: 10, narrow: false });
    expect(s.montage).toBe('NATIVE');
    expect(s.secondsPerPage).toBe(10);
    expect(s.startSec).toBe(0);
  });

  it('keeps explicit null filters (off)', () => {
    const d = EegViewerDataSchema.parse({ source: data.source, initial: { lffHz: null, notchHz: 50 } });
    const s = resolveInitialSettings(d, { availableMontages: ['LB'], durationSec: 10, narrow: false });
    expect(s.lffHz).toBeNull();
    expect(s.notchHz).toBe(50);
  });

  it('pages within the recording', () => {
    expect(clampStart(-3, 10, 30)).toBe(0);
    expect(clampStart(25, 10, 30)).toBe(20);
    expect(clampStart(5, 10, 8)).toBe(0);
    const s = resolveInitialSettings(data, { availableMontages: ['LB'], durationSec: 30, narrow: false });
    const at0 = { ...s, startSec: 0 };
    expect(pageStart(at0, 1, 30)).toBe(10);
    expect(pageStart({ ...at0, startSec: 20 }, 1, 30)).toBe(20);
    expect(pageStart(at0, -1, 30)).toBe(0);
  });

  it('adds an off-list authored value to option lists', () => {
    expect(withValue([5, 10, 20], 7)).toEqual([5, 7, 10, 20]);
    expect(withValue([5, 10], 10)).toEqual([5, 10]);
    expect(withValue([null, 1, 2], null)).toEqual([null, 1, 2]);
  });
});

describe('EegViewerStateSchema', () => {
  it('round-trips marks and defaults', () => {
    expect(EegViewerStateSchema.parse({ v: 1 })).toEqual({ v: 1, marks: [], checked: false });
    const st = { v: 1, marks: [{ t: 1.2, channel: 'F8-T8' }, { t0: 2, t1: 3, channel: null }], checked: true };
    expect(EegViewerStateSchema.parse(st)).toEqual(st);
    expect(EegViewerStateSchema.safeParse({ v: 2 }).success).toBe(false);
  });
});

describe('describeViewerState', () => {
  const settings = { montage: 'LB', sensitivityUvPerMm: 10, secondsPerPage: 10, lffHz: 0.5, hffHz: 70, notchHz: null, startSec: 0 };
  const task = EegViewerDataSchema.parse(eegViewerSample).task;

  it('flags synthetic signals and hides the key before checking', () => {
    const text = describeViewerState({
      settings,
      montageLabel: 'Longitudinal bipolar',
      durationSec: 10,
      synthetic: true,
      sourceLabel: 'simulation preset "phaseReversalF8"',
      task,
      marks: [{ t: 1.6, channel: 'Fp2-F8' }],
      checked: false,
    });
    expect(text).toMatch(/SYNTHETIC/);
    expect(text).toMatch(/notch off/);
    expect(text).toMatch(/1\.60 s on Fp2-F8/);
    expect(text).toMatch(/do not reveal/);
    expect(text.length).toBeLessThanOrEqual(2000);
  });

  it('reports results after checking and the caliper', () => {
    const text = describeViewerState({
      settings,
      montageLabel: 'LB',
      durationSec: 10,
      synthetic: false,
      sourceLabel: 'Helsinki neonatal, eeg5.edf',
      task,
      marks: [],
      checked: true,
      result: { hits: 2, misses: 1, falseMarks: 0 },
      caliper: { dtMs: 52, freqHz: 19.2, ppUv: 140, channel: 'F8-T8' },
    });
    expect(text).toMatch(/real recording/);
    expect(text).toMatch(/2 found, 1 missed/);
    expect(text).toMatch(/Δt 52 ms/);
  });
});
