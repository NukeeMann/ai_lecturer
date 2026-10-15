// Numerical verification of the synthetic EEG model and every preset.
// These tests pin the clinical conventions the widgets teach: polarity,
// phase reversal, end-of-chain localisation, reference contamination and
// artifact fields — all computed from the generated data.

import { describe, expect, it } from 'vitest';

import { classifyTransientDuration, DISPLAY_DEFAULTS, type DisplayFilterSettings } from './dsp';
import { DEFAULT_RECORDING_ELECTRODES } from './electrodes';
import { analyzeChains, detectPhaseReversals, maxAmplitudeChannel, peakSampleIndex } from './localize';
import { getMontage, makeAverageMontage, type DerivedChannel, type Montage } from './montages';
import { prepareDisplayChannels } from './pipeline';
import { getSignal, type DecodedRecording } from './recording';
import {
  componentPeakField,
  deriveSeed,
  generateRecording,
  getSimPreset,
  mulberry32,
  nearestElectrodeTo,
  resolveSimulation,
  SIM_PRESET_IDS,
  SIM_PRESET_INFO,
  SIM_PRESETS,
  simulate,
  SimulationSpecSchema,
  type SimulationSpecInput,
} from './synth';

const FILTERS: DisplayFilterSettings = { lffHz: DISPLAY_DEFAULTS.lffHz, hffHz: DISPLAY_DEFAULTS.hffHz, notchHz: null };

function display(rec: DecodedRecording, montageId: string, filters = FILTERS) {
  const montage = getMontage(montageId) as Montage;
  const channels = prepareDisplayChannels(rec, montage, filters);
  const at = (label: string, t: number) => {
    const ch = channels.find((c) => c.label === label);
    if (!ch) throw new Error(`no channel ${label}`);
    return ch.data[Math.round(t * rec.sampleRate)];
  };
  return { montage, channels, at };
}

/** Sample index of the largest deflection within ±win s of t. */
function peakNear(rec: DecodedRecording, channels: DerivedChannel[], t: number, win = 0.03): number {
  const fs = rec.sampleRate;
  return peakSampleIndex(channels, (t - win) * fs, (t + win) * fs);
}

function rms(x: Float32Array, t0: number, t1: number, fs: number): number {
  const a = Math.round(t0 * fs);
  const b = Math.round(t1 * fs);
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
}

const noBackground = (spec: SimulationSpecInput): SimulationSpecInput => ({ ...spec, background: { kind: 'none' } });

/** Event times of a preset's first component. */
function presetTimes(id: keyof typeof SIM_PRESETS): number[] {
  const c = SIM_PRESETS[id].components?.[0];
  if (!c || !('times' in c)) throw new Error(`${id} has no timed first component`);
  return c.times;
}

describe('PRNG and determinism', () => {
  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
    expect(deriveSeed(1, 2)).not.toBe(deriveSeed(1, 3));
  });

  it('the same spec gives identical samples; another seed differs', () => {
    const s1 = simulate('phaseReversalF8');
    const s2 = simulate('phaseReversalF8');
    expect(Array.from(getSignal(s1, 'F8')!)).toEqual(Array.from(getSignal(s2, 'F8')!));
    const other = generateRecording({ ...SIM_PRESETS.phaseReversalF8, seed: 999 });
    expect(Array.from(getSignal(other, 'F8')!)).not.toEqual(Array.from(getSignal(s1, 'F8')!));
  });
});

describe('every preset', () => {
  it.each(SIM_PRESET_IDS)('%s parses, generates a synthetic common-reference recording and has UI info', (id) => {
    const spec = getSimPreset(id)!;
    expect(spec).not.toBeNull();
    const rec = generateRecording(spec);
    expect(rec.synthetic).toBe(true);
    expect(rec.reference).toBe('common');
    expect(rec.sampleRate).toBe(256);
    expect(rec.nSamples).toBe(Math.round(spec.durationSec * 256));
    for (const e of DEFAULT_RECORDING_ELECTRODES) expect(getSignal(rec, e)).not.toBeNull();
    for (const s of rec.signals) expect(s.data.every(Number.isFinite)).toBe(true);
    expect(SIM_PRESET_INFO[id].title.length).toBeGreaterThan(3);
  });
});

describe('phaseReversalF8', () => {
  const rec = simulate('phaseReversalF8');
  const times = presetTimes('phaseReversalF8');

  it('LB: Fp2-F8 and F8-T8 deflect in opposite directions (negative phase reversal at F8)', () => {
    const { montage, channels, at } = display(rec, 'LB');
    for (const t of times) {
      const i = peakNear(rec, channels, t);
      const ti = i / rec.sampleRate;
      expect(at('Fp2-F8', ti)).toBeGreaterThan(60); // drawn downwards
      expect(at('F8-T8', ti)).toBeLessThan(-60); // drawn upwards
      const rev = detectPhaseReversals(montage, channels, i);
      expect(rev).toHaveLength(1);
      expect(rev[0]).toMatchObject({ kind: 'negative', electrodes: ['F8'] });
    }
  });

  it('TB: F4-F8 deflects most, at the end of its chain (F8 is the chain end)', () => {
    const { montage, channels } = display(rec, 'TB');
    const i = peakNear(rec, channels, times[0]);
    const row = analyzeChains(montage, channels, i).find((c) => c.indices.includes(6))!;
    expect(row.endMaximum).toMatchObject({ electrode: 'F8', polarity: 'negative' });
  });

  it('AVG: F8 is the most negative channel', () => {
    const { channels } = display(rec, 'AVG');
    const i = peakNear(rec, channels, times[0]);
    const best = maxAmplitudeChannel(channels, i)!;
    expect(channels[best.index].label).toBe('F8-AVG');
    expect(best.value).toBeLessThan(-80);
  });
});

describe('endOfChainFp1', () => {
  const rec = simulate('endOfChainFp1');
  const times = presetTimes('endOfChainFp1');

  it('LB: maximal at the chain start (Fp1) with no phase reversal', () => {
    const { montage, channels, at } = display(rec, 'LB');
    for (const t of times) {
      const i = peakNear(rec, channels, t);
      const ti = i / rec.sampleRate;
      expect(detectPhaseReversals(montage, channels, i)).toEqual([]);
      const chains = analyzeChains(montage, channels, i);
      expect(chains[0].endMaximum).toMatchObject({ electrode: 'Fp1', end: 'start', polarity: 'negative' });
      expect(chains[1].endMaximum).toMatchObject({ electrode: 'Fp1', end: 'start', polarity: 'negative' });
      // Amplitude falls off along the chain, all with the same (upward) sign.
      expect(at('Fp1-F7', ti)).toBeLessThan(-80);
      expect(Math.abs(at('Fp1-F7', ti))).toBeGreaterThan(2 * Math.abs(at('F7-T7', ti)));
      expect(at('Fp1-F3', ti)).toBeLessThan(-60);
    }
  });

  it('AVG: Fp1 is the most negative channel', () => {
    const { channels } = display(rec, 'AVG');
    const i = peakNear(rec, channels, times[1]);
    expect(channels[maxAmplitudeChannel(channels, i)!.index].label).toBe('Fp1-AVG');
  });
});

describe('blink', () => {
  const rec = simulate('blink');
  const times = presetTimes('blink');

  it('is a frontal positivity maximal at Fp1/Fp2 (AVG positive at Fp1/Fp2)', () => {
    const { channels, at } = display(rec, 'AVG');
    for (const t of times) {
      const ti = peakNear(rec, channels, t, 0.05) / rec.sampleRate;
      expect(at('Fp1-AVG', ti)).toBeGreaterThan(60);
      expect(at('Fp2-AVG', ti)).toBeGreaterThan(60);
      const best = maxAmplitudeChannel(channels, Math.round(ti * rec.sampleRate))!;
      expect(['Fp1-AVG', 'Fp2-AVG']).toContain(channels[best.index].label);
      expect(best.value).toBeGreaterThan(0);
    }
  });

  it('LB: Fp1-F7 / Fp1-F3 deflect downwards (positive) without phase reversal', () => {
    const { montage, channels, at } = display(rec, 'LB');
    const i = peakNear(rec, channels, times[0], 0.05);
    const ti = i / rec.sampleRate;
    expect(at('Fp1-F7', ti)).toBeGreaterThan(40);
    expect(at('Fp1-F3', ti)).toBeGreaterThan(40);
    expect(detectPhaseReversals(montage, channels, i)).toEqual([]);
    expect(analyzeChains(montage, channels, i)[0].endMaximum).toMatchObject({ electrode: 'Fp1', polarity: 'positive' });
  });

  it('has the field gradient Fp1 > F3/F7 > Fz ≫ posterior (raw potentials)', () => {
    const f = componentPeakField(SIM_PRESETS.blink.components![0]);
    expect(f.Fp1).toBeCloseTo(150, 6);
    expect(f.Fp2).toBeCloseTo(150, 6);
    expect(f.F3).toBeGreaterThan(0.15 * f.Fp1);
    expect(f.F3).toBeLessThan(0.5 * f.Fp1);
    expect(f.F7).toBeLessThan(0.5 * f.Fp1);
    expect(f.Fz).toBeLessThan(f.F3);
    expect(f.O1).toBeLessThan(0.01);
  });
});

describe('lateralEyeMovementLeft', () => {
  const spec = SIM_PRESETS.lateralEyeMovementLeft;

  it('F7 positive and F8 negative (positive towards the gaze side), held during the gaze', () => {
    const rec = generateRecording(noBackground(spec));
    const f7 = getSignal(rec, 'F7')!;
    const f8 = getSignal(rec, 'F8')!;
    const i = Math.round(2.8 * rec.sampleRate);
    expect(f7[i]).toBeCloseTo(100, 3);
    expect(f8[i]).toBeCloseTo(-100, 3);
    expect(getSignal(rec, 'Fp1')![i]).toBeGreaterThan(0);
    expect(getSignal(rec, 'Fp2')![i]).toBeLessThan(0);
    // Back to baseline after the return saccade.
    expect(f7[Math.round(4.5 * rec.sampleRate)]).toBeCloseTo(0, 6);
  });

  it('LB at the saccade: opposite phase reversals at F7 (positive) and F8 (negative)', () => {
    const rec = generateRecording(
      noBackground({
        ...spec,
        components: [{ kind: 'lateralEyeMovement', direction: 'left', times: [2.0, 6.0], holdSec: 1.5, amplitudeUv: 100 }],
      }),
    );
    const { montage, channels } = display(rec, 'LB');
    const i = Math.round(2.06 * rec.sampleRate);
    const rev = detectPhaseReversals(montage, channels, i);
    expect(rev).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'positive', electrodes: ['F7'] }),
        expect.objectContaining({ kind: 'negative', electrodes: ['F8'] }),
      ]),
    );
  });

  it('mirrors for gaze to the right', () => {
    const f = componentPeakField({ kind: 'lateralEyeMovement', direction: 'right', times: [1] });
    expect(f.F8).toBeCloseTo(70, 6);
    expect(f.F7).toBeCloseTo(-70, 6);
  });

  it('adds a brief lateral rectus spike at F7 on the outward saccade', () => {
    const rec = generateRecording(noBackground(spec));
    const { montage, channels } = display(rec, 'LB');
    const i = peakNear(rec, channels, 2.006, 0.015);
    const rev = detectPhaseReversals(montage, channels, i);
    expect(rev.some((r) => r.electrodes.includes('F7'))).toBe(true);
  });
});

describe('wideFieldInPhaseCancellation', () => {
  const rec = simulate('wideFieldInPhaseCancellation');
  const times = presetTimes('wideFieldInPhaseCancellation');

  it('LB: F8-T8 is near-isoelectric between opposite deflections in Fp2-F8 and T8-P8', () => {
    const { montage, channels, at } = display(rec, 'LB');
    for (const t of times) {
      const i = Math.round(t * rec.sampleRate);
      expect(at('Fp2-F8', t)).toBeGreaterThan(40);
      expect(at('T8-P8', t)).toBeLessThan(-40);
      expect(Math.abs(at('F8-T8', t))).toBeLessThan(0.3 * Math.abs(at('Fp2-F8', t)));
      const rev = detectPhaseReversals(montage, channels, i, { minRelative: 0.3 });
      expect(rev[0]).toMatchObject({ kind: 'negative', electrodes: ['F8', 'T8'], isoelectricIndices: [15] });
    }
  });

  it('referential: F8 and T8 are both strongly and equally negative', () => {
    const { at } = display(rec, 'AVG');
    const t = times[0];
    expect(at('F8-AVG', t)).toBeLessThan(-50);
    expect(at('T8-AVG', t)).toBeLessThan(-50);
    const f = componentPeakField(SIM_PRESETS.wideFieldInPhaseCancellation.components![0]);
    expect(f.F8).toBeCloseTo(f.T8, 9);
  });
});

describe('earReferenceContaminationT7', () => {
  const rec = simulate('earReferenceContaminationT7');
  const times = presetTimes('earReferenceContaminationT7');

  it('EAR: an active A1 makes distant left channels deflect the "wrong" way', () => {
    const { at } = display(rec, 'EAR');
    for (const t of times) {
      expect(at('T7-A1', t)).toBeLessThan(-40); // the true negativity, reduced
      for (const far of ['Fp1-A1', 'O1-A1', 'P3-A1', 'F3-A1']) expect(at(far, t)).toBeGreaterThan(40); // false positivity
      for (const right of ['Fp2-A2', 'F8-A2', 'O2-A2', 'C4-A2']) expect(Math.abs(at(right, t))).toBeLessThan(25);
    }
  });

  it('LB: the field stays local (phase reversal at T7; far left chains quiet)', () => {
    const { montage, channels, at } = display(rec, 'LB');
    for (const t of times) {
      const i = Math.round(t * rec.sampleRate);
      expect(detectPhaseReversals(montage, channels, i)).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'negative', electrodes: ['T7'] })]),
      );
      expect(Math.abs(at('P3-O1', t))).toBeLessThan(25);
      expect(Math.abs(at('Fp1-F3', t))).toBeLessThan(25);
    }
  });
});

describe('averageReferenceContaminationBlink', () => {
  const rec = simulate('averageReferenceContaminationBlink');
  const times = presetTimes('averageReferenceContaminationBlink');

  it('AVG: large blinks create a false negativity (upward) in posterior channels', () => {
    const { at } = display(rec, 'AVG');
    for (const t of times) {
      for (const ch of ['O1-AVG', 'O2-AVG', 'P3-AVG', 'P4-AVG', 'Pz-AVG']) expect(at(ch, t)).toBeLessThan(-15);
      expect(at('Fp1-AVG', t)).toBeGreaterThan(150);
    }
  });

  it('the posterior electrodes themselves are untouched (raw, no background)', () => {
    const clean = generateRecording(noBackground(SIM_PRESETS.averageReferenceContaminationBlink));
    const i = Math.round(times[0] * clean.sampleRate);
    expect(Math.abs(getSignal(clean, 'O1')![i])).toBeLessThan(0.5);
    expect(getSignal(clean, 'Fp1')![i]).toBeGreaterThan(250);
  });

  it('excluding Fp1/Fp2 from the average removes most of the contamination', () => {
    const fs = rec.sampleRate;
    const withAll = prepareDisplayChannels(rec, getMontage('AVG')!, FILTERS);
    const without = prepareDisplayChannels(rec, makeAverageMontage(['Fp1', 'Fp2']), FILTERS);
    const o1 = (chs: DerivedChannel[]) => chs.find((c) => c.plus === 'O1')!.data[Math.round(times[0] * fs)];
    expect(Math.abs(o1(without))).toBeLessThan(0.5 * Math.abs(o1(withAll)));
  });
});

describe('alphaReactivity', () => {
  const rec = simulate('alphaReactivity');
  const fs = rec.sampleRate;

  it('posterior alpha attenuates with eyes open and returns after closure', () => {
    const { channels } = display(rec, 'LB');
    const p3o1 = channels.find((c) => c.label === 'P3-O1')!.data;
    const closed = rms(p3o1, 0.5, 3.5, fs);
    const open = rms(p3o1, 4.8, 7.8, fs);
    const closedAgain = rms(p3o1, 9, 11.5, fs);
    expect(closed).toBeGreaterThan(1.8 * open);
    expect(closedAgain).toBeGreaterThan(1.8 * open);
  });

  it('is posterior-dominant and ≈ 10 Hz', () => {
    const clean = generateRecording(noBackground(SIM_PRESETS.alphaReactivity));
    const o1 = getSignal(clean, 'O1')!;
    expect(rms(o1, 0.5, 3.5, fs)).toBeGreaterThan(3 * rms(getSignal(clean, 'Fz')!, 0.5, 3.5, fs));
    let crossings = 0;
    for (let i = Math.round(0.5 * fs); i < Math.round(3.5 * fs); i++) if (o1[i - 1] < 0 && o1[i] >= 0) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(27);
    expect(crossings).toBeLessThanOrEqual(33);
  });
});

describe('electrodePopP7', () => {
  it('changes only P7 (no field) and reverses narrowly at P7 in LB', () => {
    const clean = generateRecording(noBackground(SIM_PRESETS.electrodePopP7));
    const i = Math.round(2.3 * clean.sampleRate);
    for (const s of clean.signals) {
      if (s.label === 'P7') expect(s.data[i]).toBeGreaterThan(195); // just after the step
      else expect(s.data.every((v) => v === 0)).toBe(true);
    }
    const rec = simulate('electrodePopP7');
    const { montage, channels, at } = display(rec, 'LB');
    const j = peakNear(rec, channels, 2.3, 0.02);
    const t = j / rec.sampleRate;
    expect(at('T7-P7', t)).toBeLessThan(-100);
    expect(at('P7-O1', t)).toBeGreaterThan(100);
    expect(detectPhaseReversals(montage, channels, j)).toEqual([expect.objectContaining({ kind: 'positive', electrodes: ['P7'] })]);
  });
});

describe('lineNoise50T8', () => {
  it('puts 50 Hz on T8 only; the 50 Hz notch removes it', () => {
    const clean = generateRecording(noBackground(SIM_PRESETS.lineNoise50T8));
    for (const s of clean.signals) {
      if (s.label === 'T8') expect(rms(s.data, 1, 9, 256)).toBeCloseTo(25 / Math.SQRT2, 0);
      else expect(s.data.every((v) => v === 0)).toBe(true);
    }
    const rec = simulate('lineNoise50T8');
    const off = display(rec, 'LB').channels.find((c) => c.label === 'F8-T8')!.data;
    const on = display(rec, 'LB', { ...FILTERS, notchHz: 50 }).channels.find((c) => c.label === 'F8-T8')!.data;
    expect(rms(on, 1, 9, 256)).toBeLessThan(0.6 * rms(off, 1, 9, 256));
  });
});

describe('muscleTemporal', () => {
  it('bursts of fast activity over the temporal chains, strongly reduced by HFF 15 Hz', () => {
    const rec = simulate('muscleTemporal');
    const ch = (f: DisplayFilterSettings) => display(rec, 'LB', f).channels.find((c) => c.label === 'F7-T7')!.data;
    const wide = ch(FILTERS);
    const burst = rms(wide, 2.2, 3.3, 256);
    expect(burst).toBeGreaterThan(2.5 * rms(wide, 4, 5.8, 256));
    expect(rms(ch({ ...FILTERS, hffHz: 15 }), 2.2, 3.3, 256)).toBeLessThan(0.5 * burst);
    // Midline stays quiet.
    const fz = display(rec, 'LB').channels.find((c) => c.label === 'Fz-Cz')!.data;
    expect(rms(fz, 2.2, 3.3, 256)).toBeLessThan(0.5 * burst);
  });
});

describe('discharge morphology (IFCN durations)', () => {
  /** Width (ms) of the main component of an isolated discharge at Cz. */
  function mainWidthMs(waveform: 'spike' | 'sharp', durationMs?: number): number {
    const rec = generateRecording({
      durationSec: 2,
      background: { kind: 'none' },
      components: [{ kind: 'discharge', center: 'Cz', waveform, durationMs, times: [1], peakUv: 100 }],
    });
    const x = getSignal(rec, 'Cz')!;
    const fs = rec.sampleRate;
    const p = Math.round(fs);
    expect(x[p]).toBeLessThan(-80); // surface-negative peak at the event time
    let a = p;
    let b = p;
    while (a > 0 && x[a - 1] < 0) a--;
    while (b < x.length - 1 && x[b + 1] < 0) b++;
    return ((b - a + 1) / fs) * 1000;
  }

  it('spikes last 20–<70 ms and sharp waves 70–200 ms', () => {
    expect(classifyTransientDuration(mainWidthMs('spike'))).toBe('spike');
    expect(classifyTransientDuration(mainWidthMs('spike', 30))).toBe('spike');
    expect(classifyTransientDuration(mainWidthMs('sharp'))).toBe('sharp');
    expect(classifyTransientDuration(mainWidthMs('sharp', 180))).toBe('sharp');
  });

  it('is surface-negative by default and positive on request', () => {
    const neg = componentPeakField({ kind: 'discharge', center: 'T7', times: [1], peakUv: 80 });
    expect(neg.T7).toBeCloseTo(-80, 9);
    expect(neg.T8).toBeGreaterThan(-1);
    const pos = componentPeakField({ kind: 'discharge', center: 'T7', times: [1], peakUv: 80, polarity: 'positive' });
    expect(pos.T7).toBeCloseTo(80, 9);
  });

  it('spike-and-wave adds an after-going slow wave of the same polarity', () => {
    const rec = generateRecording({
      durationSec: 2,
      background: { kind: 'none' },
      components: [{ kind: 'discharge', center: 'Fz', waveform: 'spikeWave', times: [0.5], peakUv: 100 }],
    });
    const fz = getSignal(rec, 'Fz')!;
    const fs = rec.sampleRate;
    let minAfter = 0;
    for (let i = Math.round(0.6 * fs); i < Math.round(0.9 * fs); i++) minAfter = Math.min(minAfter, fz[i]);
    expect(minAfter).toBeLessThan(-50);
  });
});

describe('ECG and sweat components', () => {
  it('ECG is left-ear dominant, prominent with ear reference, and adds an ECG channel', () => {
    const rec = generateRecording({ durationSec: 6, background: { kind: 'none' }, components: [{ kind: 'ecg', amplitudeUv: 20, heartRateBpm: 90 }] });
    expect(getSignal(rec, 'ECG')).not.toBeNull();
    const peak = (e: string) => Math.max(...Array.from(getSignal(rec, e)!).map(Math.abs));
    expect(peak('A1')).toBeGreaterThan(2 * peak('A2'));
    expect(peak('A1')).toBeGreaterThan(peak('T7'));
    const field = componentPeakField({ kind: 'ecg', amplitudeUv: 20 });
    expect(field.A1).toBeCloseTo(20, 9);
  });

  it('sweat is a slow (< 0.5 Hz) drift on the given electrodes', () => {
    const rec = generateRecording({ durationSec: 20, background: { kind: 'none' }, components: [{ kind: 'sweat', electrodes: ['T3'], amplitudeUv: 50 }] });
    const t7 = getSignal(rec, 'T7')!;
    let crossings = 0;
    for (let i = 1; i < t7.length; i++) if (t7[i - 1] < 0 && t7[i] >= 0) crossings++;
    expect(crossings).toBeLessThanOrEqual(10); // < 0.5 Hz over 20 s
    expect(Math.max(...Array.from(t7))).toBeGreaterThan(20);
  });
});

describe('spec validation', () => {
  const base = { durationSec: 5 };
  const issues = (spec: unknown) => {
    const r = SimulationSpecSchema.safeParse(spec);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };

  it('enforces IFCN durations for spikes and sharp waves', () => {
    expect(issues({ ...base, components: [{ kind: 'discharge', center: 'F8', waveform: 'spike', durationMs: 100, times: [1] }] })[0]).toMatch(
      /20–<70 ms \(IFCN\)/,
    );
    expect(issues({ ...base, components: [{ kind: 'discharge', center: 'F8', waveform: 'sharp', durationMs: 60, times: [1] }] })).toHaveLength(1);
    expect(issues({ ...base, components: [{ kind: 'discharge', center: 'F8', waveform: 'spike', durationMs: 69, times: [1] }] })).toEqual([]);
  });

  it('rejects unknown locations, electrodes and out-of-range times', () => {
    expect(issues({ ...base, components: [{ kind: 'discharge', center: 'X9', times: [1] }] })[0]).toMatch(/Unknown location/);
    expect(issues({ ...base, components: [{ kind: 'electrodePop', electrode: 'Q1', times: [1] }] })[0]).toMatch(/Unknown scalp electrode/);
    expect(issues({ ...base, components: [{ kind: 'blink', times: [7] }] })[0]).toMatch(/components\.0\.times\.0: .*outside/);
    expect(issues({ ...base, components: [{ kind: 'muscle', center: 'T7', bursts: [{ onsetSec: 9, durationSec: 1 }] }] })[0]).toMatch(/bursts\.0\.onsetSec/);
    expect(issues({ ...base, electrodes: ['Fp1', 'ECG'] })[0]).toMatch(/electrodes\.1/);
    expect(issues({ ...base, components: [{ kind: 'rhythm', center: 'Oz', freqHz: 10, amplitudeUv: 20, onsetSec: 3, offsetSec: 2 }] })[0]).toMatch(/offsetSec/);
  });

  it('accepts regions, spherical points and old electrode names', () => {
    expect(issues({ ...base, components: [{ kind: 'rhythm', center: 'posterior', freqHz: 10, amplitudeUv: 20 }] })).toEqual([]);
    expect(issues({ ...base, components: [{ kind: 'discharge', center: { theta: 90, phi: 72 }, times: [1] }] })).toEqual([]);
    expect(issues({ ...base, components: [{ kind: 'discharge', center: 'T4', times: [1] }] })).toEqual([]);
  });
});

describe('generator options and helpers', () => {
  it('honours an electrode subset and adds electrodes components need', () => {
    const rec = generateRecording({
      durationSec: 1,
      electrodes: ['Fp1', 'Fp2', 'C3', 'C4', 'T3', 'T4', 'O1', 'O2', 'Cz'],
      components: [{ kind: 'electrodePop', electrode: 'P7', times: [0.5] }],
    });
    expect(rec.signals.map((s) => s.label)).toEqual(['Fp1', 'Fp2', 'C3', 'C4', 'T7', 'T8', 'O1', 'O2', 'Cz', 'P7']);
  });

  it('annotates simulated events (and can be told not to)', () => {
    const rec = simulate('phaseReversalF8');
    expect(rec.annotations).toHaveLength(3);
    expect(rec.annotations[0]).toMatchObject({ label: 'spike', source: 'simulation' });
    expect(rec.annotations[0].channels).toContain('F8');
    expect(rec.annotations[0].onsetSec).toBeLessThan(1.6);
    expect(generateRecording({ ...SIM_PRESETS.blink, annotate: false }).annotations).toEqual([]);
    expect(simulate('alphaReactivity').annotations.map((a) => a.label)).toEqual(['eyes open', 'eyes closed']);
  });

  it('resolves presets and specs', () => {
    expect(resolveSimulation({ preset: 'blink' }).durationSec).toBe(10);
    expect(resolveSimulation({ preset: 'blink', spec: { durationSec: 3 } }).durationSec).toBe(3);
    expect(() => resolveSimulation({ preset: 'nope' })).toThrow(/Unknown simulation preset/);
    expect(() => resolveSimulation({})).toThrow();
    expect(getSimPreset('nope')).toBeNull();
    expect(nearestElectrodeTo({ theta: 90, phi: 72 }, ['F8', 'T8', 'C4'])).toMatch(/F8|T8/);
    expect(nearestElectrodeTo('posterior')).toBe('Oz');
  });
});
