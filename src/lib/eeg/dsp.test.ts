import { describe, expect, it } from 'vitest';

import {
  applyBiquad,
  applyDisplayFilters,
  biquadMagnitude,
  cascadeMagnitude,
  classifyTransientDuration,
  designDisplayFilters,
  dyToUv,
  filtfilt,
  formatTime,
  formatTimeRange,
  highpass,
  highpass1,
  lowpass,
  lowpass1,
  measureWindow,
  minMaxDecimate,
  notch,
  POLARITY_NEGATIVE_UP,
  PX_PER_MM,
  sampleAt,
  scaleBarUv,
  SENSITIVITY_OPTIONS,
  stepOption,
  timeConstantSec,
  uvToDy,
} from './dsp';

const db = (m: number) => 20 * Math.log10(m);

function sine(n: number, fs: number, f: number, amp = 1, phase = 0): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * f * i) / fs + phase);
  return out;
}

function rms(x: ArrayLike<number>, a = 0, b = x.length): number {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
}

function argmax(x: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < x.length; i++) if (x[i] > x[best]) best = i;
  return best;
}

describe('biquad design (RBJ)', () => {
  it.each([
    [0.5, 256],
    [1, 200],
    [5, 500],
  ])('high-pass is −3 dB at fc = %s Hz (fs %s)', (fc, fs) => {
    expect(db(biquadMagnitude(highpass(fc, fs), fc, fs))).toBeCloseTo(-3.01, 1);
    expect(db(biquadMagnitude(highpass1(fc, fs), fc, fs))).toBeCloseTo(-3.01, 1);
    expect(biquadMagnitude(highpass(fc, fs), fs / 4, fs)).toBeGreaterThan(0.99);
  });

  it.each([
    [70, 256],
    [15, 256],
    [35, 500],
  ])('low-pass is −3 dB at fc = %s Hz (fs %s)', (fc, fs) => {
    expect(db(biquadMagnitude(lowpass(fc, fs), fc, fs))).toBeCloseTo(-3.01, 1);
    expect(db(biquadMagnitude(lowpass1(fc, fs), fc, fs))).toBeCloseTo(-3.01, 1);
    expect(biquadMagnitude(lowpass(fc, fs), 0.1, fs)).toBeGreaterThan(0.999);
  });

  it('notch removes the mains frequency and spares neighbours', () => {
    const n50 = notch(50, 256);
    expect(db(biquadMagnitude(n50, 50, 256))).toBeLessThan(-60);
    expect(db(biquadMagnitude(n50, 45, 256))).toBeGreaterThan(-0.5);
    expect(db(biquadMagnitude(n50, 10, 256))).toBeGreaterThan(-0.05);
  });

  it('rejects cutoffs at or above Nyquist', () => {
    expect(() => lowpass(128, 256)).toThrow(RangeError);
    expect(() => highpass(0, 256)).toThrow(RangeError);
    expect(() => highpass1(200, 256)).toThrow(RangeError);
  });
});

describe('display filters (zero-phase, clinical cutoffs)', () => {
  const fs = 256;

  it('combined forward–backward response is −3 dB at the nominal LFF/HFF', () => {
    const lff = designDisplayFilters({ lffHz: 0.5, hffHz: null, notchHz: null }, fs).sections;
    expect(db(cascadeMagnitude(lff, 0.5, fs, true))).toBeCloseTo(-3.01, 1);
    const hff = designDisplayFilters({ lffHz: null, hffHz: 70, notchHz: null }, fs).sections;
    expect(db(cascadeMagnitude(hff, 70, fs, true))).toBeCloseTo(-3.01, 1);
    const hff15 = designDisplayFilters({ lffHz: null, hffHz: 15, notchHz: null }, fs).sections;
    expect(db(cascadeMagnitude(hff15, 15, fs, true))).toBeCloseTo(-3.01, 1);
  });

  it('LFF is first order: LFF 1 Hz keeps roughly 40 % of a 0.5 Hz wave', () => {
    const x = sine(fs * 40, fs, 0.5, 100);
    const y = applyDisplayFilters(x, { lffHz: 1, hffHz: null, notchHz: null }, fs);
    const ratio = rms(y, fs * 10, fs * 30) / rms(x, fs * 10, fs * 30);
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.5);
  });

  it('a sine at the nominal cutoff comes out at ≈ 0.707', () => {
    const x = sine(fs * 30, fs, 70, 50);
    const y = applyDisplayFilters(x, { lffHz: null, hffHz: 70, notchHz: null }, fs);
    expect(rms(y, fs * 5, fs * 25) / rms(x, fs * 5, fs * 25)).toBeCloseTo(Math.SQRT1_2, 1);
  });

  it('notch 50 Hz kills a 50 Hz sine but passes alpha', () => {
    const mains = sine(fs * 10, fs, 50, 40);
    const alpha = sine(fs * 10, fs, 10, 40);
    const s = { lffHz: null, hffHz: null, notchHz: 50 };
    expect(rms(applyDisplayFilters(mains, s, fs), fs, fs * 9)).toBeLessThan(0.01 * rms(mains));
    expect(rms(applyDisplayFilters(alpha, s, fs), fs, fs * 9) / rms(alpha, fs, fs * 9)).toBeGreaterThan(0.99);
  });

  it('skips filters the sample rate cannot represent', () => {
    const r = designDisplayFilters({ lffHz: 0.5, hffHz: 70, notchHz: 60 }, 128);
    expect(r.skipped).toEqual(['hff']);
    expect(r.sections).toHaveLength(2);
    expect(designDisplayFilters({ lffHz: null, hffHz: null, notchHz: null }, 256).sections).toHaveLength(0);
  });

  it('returns a copy when no filter is active', () => {
    const x = new Float32Array([1, 2, 3]);
    const y = applyDisplayFilters(x, { lffHz: null, hffHz: null, notchHz: null }, fs);
    expect(y).not.toBe(x);
    expect(Array.from(y)).toEqual([1, 2, 3]);
  });
});

describe('filtfilt', () => {
  const fs = 256;
  const spike = () => {
    const x = new Float32Array(fs * 4);
    for (let i = 0; i < x.length; i++) x[i] = 100 * Math.exp(-(((i - 600) / 4) ** 2));
    return x;
  };

  it('has zero lag on a spike (causal filtering delays it)', () => {
    const x = spike();
    const lp = [lowpass(30, fs)];
    expect(argmax(filtfilt(x, lp))).toBe(600);
    expect(argmax(applyBiquad(x, lp))).toBeGreaterThan(601);
    expect(argmax(applyDisplayFilters(x, DISPLAY(), fs))).toBe(600);
    expect(argmax(applyDisplayFilters(x, { ...DISPLAY(), phase: 'causal' }, fs))).toBeGreaterThan(600);
  });

  it('starts from steady state: no edge transient on a constant or a ramp', () => {
    const c = new Float32Array(fs * 3).fill(250);
    const hp = filtfilt(c, [highpass1(0.5, fs), lowpass(70, fs)], { padLen: fs });
    expect(Math.max(...Array.from(hp).map(Math.abs))).toBeLessThan(1e-3);
    const lp = filtfilt(c, [lowpass(15, fs), notch(50, fs)]);
    for (const v of lp) expect(v).toBeCloseTo(250, 3);
  });

  it('handles tiny inputs and empty cascades', () => {
    expect(filtfilt([], [lowpass(10, fs)])).toHaveLength(0);
    expect(Array.from(filtfilt([5], [lowpass(10, fs)]))).toEqual([5]);
    expect(Array.from(filtfilt([1, 2, 3], []))).toEqual([1, 2, 3]);
  });
});

function DISPLAY() {
  return { lffHz: 0.5, hffHz: 70, notchHz: 50 } as const;
}

describe('minMaxDecimate', () => {
  it('preserves the extremes of every column (spikes never disappear)', () => {
    const n = 7680;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin(i / 50) * 20;
    x[1234] = 500;
    x[5000] = -400;
    const { min, max } = minMaxDecimate(x, 0, n, 900);
    expect(min).toHaveLength(900);
    expect(Math.max(...max)).toBe(500);
    expect(Math.min(...min)).toBe(-400);
  });

  it('includes the previous sample so adjacent columns connect', () => {
    const x = [0, 0, 10, 10, 20, 20];
    const { min, max } = minMaxDecimate(x, 0, 6, 3);
    expect(Array.from(min)).toEqual([0, 0, 10]);
    expect(Array.from(max)).toEqual([0, 10, 20]);
  });

  it('marks columns outside the data as NaN and supports fractional starts', () => {
    const x = [1, 2, 3, 4];
    const r = minMaxDecimate(x, -4, 4, 8);
    expect(Number.isNaN(r.min[0])).toBe(true);
    expect(Number.isNaN(r.max[3])).toBe(true);
    expect(r.max[7]).toBe(4);
    const past = minMaxDecimate(x, 2, 10, 4);
    expect(Number.isNaN(past.max[3])).toBe(true);
    const frac = minMaxDecimate(x, 0.5, 3.5, 3);
    expect(frac.max[2]).toBe(4);
  });

  it('upsamples (more columns than samples) without gaps', () => {
    const r = minMaxDecimate([0, 10], 0, 2, 8);
    expect(Array.from(r.max).every(Number.isFinite)).toBe(true);
  });

  it('reuses output buffers of the right size', () => {
    const out = { min: new Float32Array(4), max: new Float32Array(4) };
    expect(minMaxDecimate([1, 2, 3, 4], 0, 4, 4, out).min).toBe(out.min);
  });
});

describe('scaling and polarity', () => {
  it('draws negative up (negative µV → upward = negative screen dy)', () => {
    expect(POLARITY_NEGATIVE_UP).toBe(true);
    expect(uvToDy(-50, 10)).toBeLessThan(0);
    expect(uvToDy(50, 10)).toBeCloseTo(5 * PX_PER_MM, 9);
    expect(uvToDy(50, 10, 2)).toBeCloseTo(10 * PX_PER_MM, 9);
    expect(dyToUv(uvToDy(-37, 7, 1.5), 7, 1.5)).toBeCloseTo(-37, 9);
  });

  it('steps through option lists', () => {
    const opts = SENSITIVITY_OPTIONS as readonly number[];
    expect(stepOption(opts, 10, 1)).toBe(15);
    expect(stepOption(opts, 10, -1)).toBe(7);
    expect(stepOption(opts, 12, 1)).toBe(15);
    expect(stepOption(opts, 12, -1)).toBe(10);
    expect(stepOption(opts, 500, 1)).toBe(500);
    expect(stepOption(opts, 1, -1)).toBe(1);
  });

  it('picks a nice calibration bar', () => {
    expect(scaleBarUv(10, 40)).toBe(100);
    expect(scaleBarUv(7, 40)).toBe(50);
    expect(scaleBarUv(100, 40)).toBe(1000);
  });

  it('converts LFF to a time constant', () => {
    expect(timeConstantSec(0.5)).toBeCloseTo(0.318, 3);
  });
});

describe('caliper measurements', () => {
  it('measures period, frequency and peak-to-peak', () => {
    const fs = 256;
    const x = sine(fs * 2, fs, 10, 30);
    const m = measureWindow(x, fs, 0.2, 0.1);
    expect(m.dtMs).toBeCloseTo(100, 9);
    expect(m.freqHz).toBeCloseTo(10, 9);
    expect(m.ppUv).toBeGreaterThan(59);
    expect(m.ppUv).toBeLessThanOrEqual(60);
    expect(m.maxT).toBeGreaterThanOrEqual(0.1);
    expect(measureWindow(x, fs, 0.3, 0.3).freqHz).toBe(Infinity);
  });

  it('interpolates sample values and respects the data offset', () => {
    expect(sampleAt([0, 10, 20], 10, 0.15)).toBeCloseTo(15, 9);
    expect(sampleAt([0, 10, 20], 10, 1.15, 1)).toBeCloseTo(15, 9);
    expect(Number.isNaN(sampleAt([0, 10, 20], 10, 0.5))).toBe(true);
  });

  it('classifies durations with the IFCN limits', () => {
    expect(classifyTransientDuration(19)).toBe('other');
    expect(classifyTransientDuration(20)).toBe('spike');
    expect(classifyTransientDuration(69.9)).toBe('spike');
    expect(classifyTransientDuration(70)).toBe('sharp');
    expect(classifyTransientDuration(200)).toBe('sharp');
    expect(classifyTransientDuration(201)).toBe('other');
  });
});

describe('time formatting', () => {
  it('formats mm:ss', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(3661)).toBe('1:01:01');
    expect(formatTime(9.25, 2)).toBe('00:09.25');
    expect(formatTimeRange(10, 20)).toBe('00:10–00:20');
  });
});
