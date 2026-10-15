import { describe, expect, it } from 'vitest';

import { ELECTRODES_10_20 } from './electrodes';
import {
  availableMontages,
  averagePool,
  BUILTIN_MONTAGES,
  channelElectrodes,
  channelGroups,
  channelInvolves,
  deriveChannels,
  getMontage,
  makeAverageMontage,
  montageAvailability,
  MONTAGE_AVG,
  MONTAGE_CZ,
  MONTAGE_EAR,
  MONTAGE_LB,
  MONTAGE_NEO,
  MONTAGE_TB,
  nativeMontage,
  recordedReferenceMontage,
} from './montages';
import type { DecodedRecording } from './recording';

/** Common-reference recording where each electrode holds a constant value. */
function constantRecording(values: Record<string, number>, n = 4): DecodedRecording {
  return {
    sampleRate: 100,
    nSamples: n,
    durationSec: n / 100,
    reference: 'common',
    signals: Object.entries(values).map(([label, v]) => ({ label, data: new Float32Array(n).fill(v) })),
    annotations: [],
    synthetic: false,
  };
}

const ALL = Object.fromEntries([...ELECTRODES_10_20, 'A1', 'A2', 'ECG'].map((e, i) => [e, (i + 1) * 10]));

describe('built-in montages (ACNS 2016)', () => {
  it('LB double banana has the ACNS chain order', () => {
    expect(MONTAGE_LB.channels.map((c) => c.label)).toEqual([
      'Fp1-F7', 'F7-T7', 'T7-P7', 'P7-O1',
      'Fp1-F3', 'F3-C3', 'C3-P3', 'P3-O1',
      'Fz-Cz', 'Cz-Pz',
      'Fp2-F4', 'F4-C4', 'C4-P4', 'P4-O2',
      'Fp2-F8', 'F8-T8', 'T8-P8', 'P8-O2',
    ]);
    expect(new Set(channelGroups(MONTAGE_LB))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(channelGroups(MONTAGE_LB).slice(0, 5)).toEqual([0, 0, 0, 0, 1]);
  });

  it('TB rows run left to right', () => {
    expect(MONTAGE_TB.channels.map((c) => c.label)).toEqual([
      'F7-Fp1', 'Fp1-Fp2', 'Fp2-F8',
      'F7-F3', 'F3-Fz', 'Fz-F4', 'F4-F8',
      'T7-C3', 'C3-Cz', 'Cz-C4', 'C4-T8',
      'P7-P3', 'P3-Pz', 'Pz-P4', 'P4-P8',
      'P7-O1', 'O1-O2', 'O2-P8',
    ]);
  });

  it('NEO is the 12-channel neonatal montage', () => {
    expect(MONTAGE_NEO.channels.map((c) => c.label)).toEqual([
      'Fp1-T7', 'T7-O1', 'Fp2-T8', 'T8-O2', 'Fp1-C3', 'C3-O1', 'Fp2-C4', 'C4-O2', 'T7-C3', 'C3-Cz', 'Cz-C4', 'C4-T8',
    ]);
  });

  it('referential montages cover the 19 electrodes (Cz omitted from CZ)', () => {
    expect(MONTAGE_AVG.channels).toHaveLength(19);
    expect(MONTAGE_EAR.channels).toHaveLength(19);
    expect(MONTAGE_CZ.channels).toHaveLength(18);
    expect(MONTAGE_CZ.channels.some((c) => c.plus === 'Cz')).toBe(false);
    expect(new Set(MONTAGE_AVG.channels.map((c) => c.plus))).toEqual(new Set(ELECTRODES_10_20));
    expect(MONTAGE_EAR.channels.find((c) => c.plus === 'T7')!.label).toBe('T7-A1');
    expect(MONTAGE_EAR.channels.find((c) => c.plus === 'T8')!.label).toBe('T8-A2');
    expect(MONTAGE_EAR.channels.find((c) => c.plus === 'Cz')!.label).toBe('Cz-A1A2');
  });

  it('bipolar labels are plus-minus of 10-20 electrodes', () => {
    for (const m of [MONTAGE_LB, MONTAGE_TB, MONTAGE_NEO]) {
      for (const c of m.channels) {
        expect(c.label).toBe(`${c.plus}-${c.minus}`);
        expect(ELECTRODES_10_20).toContain(c.plus);
        expect(ELECTRODES_10_20).toContain(c.minus);
      }
    }
  });

  it('looks montages up case-insensitively', () => {
    expect(getMontage('lb')).toBe(MONTAGE_LB);
    expect(getMontage('nope')).toBeNull();
    expect(Object.keys(BUILTIN_MONTAGES)).toEqual(['LB', 'TB', 'AVG', 'CZ', 'EAR', 'NEO']);
  });
});

describe('deriveChannels (common reference)', () => {
  const rec = constantRecording(ALL);
  const v = (e: string) => ALL[e];

  it('computes bipolar differences as V(plus) − V(minus)', () => {
    const lb = deriveChannels(rec, MONTAGE_LB);
    expect(lb).toHaveLength(18);
    for (const ch of lb) {
      expect(ch.available).toBe(true);
      expect(ch.data[0]).toBeCloseTo(v(ch.plus) - v(ch.minus), 4);
    }
  });

  it('averages scalp electrodes only (no ears, no polygraphy)', () => {
    const pool = averagePool(rec);
    expect(pool).toHaveLength(19);
    expect(pool).not.toContain('A1');
    expect(pool).not.toContain('ECG');
    const mean = ELECTRODES_10_20.reduce((s, e) => s + v(e), 0) / 19;
    const avg = deriveChannels(rec, MONTAGE_AVG);
    for (const ch of avg) expect(ch.data[0]).toBeCloseTo(v(ch.plus) - mean, 3);
  });

  it('honours excludeFromAverage (montage or option)', () => {
    const others = ELECTRODES_10_20.filter((e) => e !== 'Fp1' && e !== 'Fp2');
    const mean = others.reduce((s, e) => s + v(e), 0) / others.length;
    const viaMontage = deriveChannels(rec, makeAverageMontage(['Fp1', 'Fp2']));
    const viaOption = deriveChannels(rec, MONTAGE_AVG, { excludeFromAverage: ['Fp1', 'Fp2'] });
    expect(viaMontage[0].data[0]).toBeCloseTo(v('Fp1') - mean, 3);
    expect(viaOption[0].data[0]).toBeCloseTo(v('Fp1') - mean, 3);
    expect(makeAverageMontage(['Fp1']).label).toMatch(/without Fp1/);
    expect(makeAverageMontage()).toBe(MONTAGE_AVG);
  });

  it('uses the ipsilateral ear (linked ears for midline)', () => {
    const ear = deriveChannels(rec, MONTAGE_EAR);
    const get = (label: string) => ear.find((c) => c.label === label)!.data[0];
    expect(get('T7-A1')).toBeCloseTo(v('T7') - v('A1'), 4);
    expect(get('O2-A2')).toBeCloseTo(v('O2') - v('A2'), 4);
    expect(get('Pz-A1A2')).toBeCloseTo(v('Pz') - (v('A1') + v('A2')) / 2, 4);
  });

  it('marks channels with missing electrodes unavailable (zero data, same place)', () => {
    const partial = constantRecording({ Fp1: 1, F7: 2, T7: 3, Cz: 4 });
    const lb = deriveChannels(partial, MONTAGE_LB);
    expect(lb.map((c) => c.available)).toEqual([true, true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]);
    expect(lb[2].data.every((x) => x === 0)).toBe(true);
    expect(lb[2].label).toBe('T7-P7');
    // No ears → EAR montage unavailable; CZ needs Cz.
    expect(deriveChannels(partial, MONTAGE_EAR).every((c) => !c.available)).toBe(true);
    expect(deriveChannels(partial, MONTAGE_CZ).find((c) => c.plus === 'F7')!.data[0]).toBe(-2);
    // Average of a single scalp electrode is meaningless → unavailable.
    expect(deriveChannels(constantRecording({ Fp1: 1, A1: 2 }), MONTAGE_AVG).every((c) => !c.available)).toBe(true);
  });

  it('reports availability and the montages a recording supports', () => {
    const noEars = constantRecording(Object.fromEntries(ELECTRODES_10_20.map((e) => [e, 1])));
    expect(montageAvailability(noEars, MONTAGE_EAR)).toEqual({ available: 0, total: 19 });
    expect(availableMontages(noEars).map((m) => m.id)).toEqual(['LB', 'TB', 'AVG', 'CZ', 'NEO']);
    expect(availableMontages(rec).map((m) => m.id)).toEqual(['LB', 'TB', 'AVG', 'CZ', 'EAR', 'NEO']);
    expect(availableMontages(rec, ['AVG', 'LB']).map((m) => m.id)).toEqual(['AVG', 'LB']);
  });

  it('builds a recording-reference montage that passes data through', () => {
    const m = recordedReferenceMontage(rec);
    expect(m.channels[0]).toEqual({ label: 'Fp1-Ref', plus: 'Fp1', minus: 'REF' });
    expect(m.channels.some((c) => c.plus === 'ECG' || c.plus === 'A1')).toBe(false);
    const d = deriveChannels(rec, m);
    expect(d[0].data[0]).toBe(v('Fp1'));
  });
});

describe('deriveChannels (fixed bipolar recording)', () => {
  const rec: DecodedRecording = {
    sampleRate: 100,
    nSamples: 2,
    durationSec: 0.02,
    reference: 'bipolar',
    signals: [
      { label: 'Fp1-F7', data: new Float32Array([1, 2]) },
      { label: 'T7-F7', data: new Float32Array([3, 4]) },
    ],
    annotations: [],
    synthetic: false,
  };

  it('shows stored channels, inverts reversed ones, nothing else', () => {
    const lb = deriveChannels(rec, MONTAGE_LB);
    expect(Array.from(lb[0].data)).toEqual([1, 2]);
    expect(lb[1].label).toBe('F7-T7');
    expect(Array.from(lb[1].data)).toEqual([-3, -4]);
    expect(lb.slice(2).every((c) => !c.available)).toBe(true);
    expect(deriveChannels(rec, MONTAGE_AVG).every((c) => !c.available)).toBe(true);
  });

  it('offers the native montage first', () => {
    const native = nativeMontage(rec);
    expect(native.id).toBe('NATIVE');
    expect(native.channels.map((c) => c.label)).toEqual(['Fp1-F7', 'T7-F7']);
    // TB's F7-Fp1 is the inversion of the stored Fp1-F7.
    expect(availableMontages(rec).map((m) => m.id)).toEqual(['NATIVE', 'LB', 'TB']);
    expect(deriveChannels(rec, native).every((c) => c.available)).toBe(true);
  });
});

describe('channel electrode helpers', () => {
  it('resolves references', () => {
    expect(channelElectrodes({ label: 'T7-A1', plus: 'T7', minus: 'A1A2_IPSI' })).toEqual(['T7', 'A1']);
    expect(channelElectrodes({ label: 'Cz-A1A2', plus: 'Cz', minus: 'A1A2_IPSI' })).toEqual(['Cz', 'A1', 'A2']);
    expect(channelElectrodes({ label: 'O1-AVG', plus: 'O1', minus: 'AVG' })).toEqual(['O1']);
    expect(channelInvolves(MONTAGE_LB.channels[1], 'T7')).toBe(true);
    expect(channelInvolves(MONTAGE_LB.channels[1], 'P7')).toBe(false);
  });
});
