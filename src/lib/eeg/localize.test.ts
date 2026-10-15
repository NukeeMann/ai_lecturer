import { describe, expect, it } from 'vitest';

import {
  analyzeChains,
  detectPhaseReversals,
  findChains,
  maxAmplitudeChannel,
  peakSampleIndex,
  valuesAt,
} from './localize';
import { MONTAGE_AVG, MONTAGE_LB, MONTAGE_NEO, MONTAGE_TB, type DerivedChannel, type Montage } from './montages';

/** One-sample derived channels with the given values (NaN = unavailable). */
function channels(montage: Montage, values: number[]): DerivedChannel[] {
  return montage.channels.map((c, i) => ({
    ...c,
    data: new Float32Array([Number.isNaN(values[i]) ? 0 : values[i]]),
    available: !Number.isNaN(values[i]),
    group: 0,
  }));
}

const zeros = (k: number) => new Array<number>(k).fill(0);

describe('findChains', () => {
  it('splits the double banana into its five chains', () => {
    expect(findChains(MONTAGE_LB)).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9], [10, 11, 12, 13], [14, 15, 16, 17]]);
  });

  it('links transverse rows and neonatal pairs; referential channels stay single', () => {
    expect(findChains(MONTAGE_TB)).toEqual([[0, 1, 2], [3, 4, 5, 6], [7, 8, 9, 10], [11, 12, 13, 14], [15, 16, 17]]);
    expect(findChains(MONTAGE_NEO)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7], [8, 9, 10, 11]]);
    expect(findChains(MONTAGE_AVG)).toHaveLength(19);
  });
});

describe('analyzeChains', () => {
  it('finds a negative phase reversal (deflections point towards each other)', () => {
    const v = zeros(18);
    v[14] = 120; // Fp2-F8 > 0 → down
    v[15] = -110; // F8-T8 < 0 → up
    const r = detectPhaseReversals(MONTAGE_LB, channels(MONTAGE_LB, v), 0);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'negative', electrodes: ['F8'], upperIndex: 14, lowerIndex: 15, isoelectricIndices: [] });
  });

  it('finds a positive phase reversal (pointing away)', () => {
    const v = zeros(18);
    v[2] = -150; // T7-P7
    v[3] = 160; // P7-O1
    expect(detectPhaseReversals(MONTAGE_LB, channels(MONTAGE_LB, v), 0)[0]).toMatchObject({ kind: 'positive', electrodes: ['P7'] });
  });

  it('localises across an isoelectric channel (in-phase cancellation)', () => {
    const v = zeros(18);
    v[14] = 80; // Fp2-F8
    v[15] = 3; // F8-T8 ≈ 0
    v[16] = -75; // T8-P8
    const r = detectPhaseReversals(MONTAGE_LB, channels(MONTAGE_LB, v), 0);
    expect(r[0]).toMatchObject({ kind: 'negative', electrodes: ['F8', 'T8'], isoelectricIndices: [15] });
  });

  it('reports an end-of-chain maximum without reversal, with polarity', () => {
    const v = zeros(18);
    v[0] = -130; // Fp1-F7: Fp1 most negative
    v[1] = -25;
    v[2] = -5;
    const chains = analyzeChains(MONTAGE_LB, channels(MONTAGE_LB, v), 0);
    expect(chains[0].reversals).toEqual([]);
    expect(chains[0].endMaximum).toMatchObject({ electrode: 'Fp1', end: 'start', polarity: 'negative' });
    const w = zeros(18);
    w[3] = 90; // P7-O1 > 0 → O1 more negative than P7
    expect(analyzeChains(MONTAGE_LB, channels(MONTAGE_LB, w), 0)[0].endMaximum).toMatchObject({
      electrode: 'O1',
      end: 'end',
      polarity: 'negative',
    });
    const p = zeros(18);
    p[0] = 100; // Fp1 most positive (blink)
    expect(analyzeChains(MONTAGE_LB, channels(MONTAGE_LB, p), 0)[0].endMaximum).toMatchObject({ electrode: 'Fp1', polarity: 'positive' });
  });

  it('ignores deflections below threshold and missing channels break chains', () => {
    const v = zeros(18);
    v[0] = 100;
    v[1] = -8; // below 10 µV absolute minimum
    expect(detectPhaseReversals(MONTAGE_LB, channels(MONTAGE_LB, v), 0)).toEqual([]);
    const w = zeros(18);
    w[0] = 100;
    w[1] = Number.NaN;
    w[2] = -100;
    expect(detectPhaseReversals(MONTAGE_LB, channels(MONTAGE_LB, w), 0)).toEqual([]);
    expect(detectPhaseReversals(MONTAGE_LB, channels(MONTAGE_LB, zeros(18)), 0)).toEqual([]);
  });
});

describe('referential helpers', () => {
  it('finds the channel with the largest |value|', () => {
    const v = zeros(19);
    v[15] = -140;
    v[3] = 90;
    expect(maxAmplitudeChannel(channels(MONTAGE_AVG, v), 0)).toEqual({ index: 15, value: -140 });
    expect(maxAmplitudeChannel([], 0)).toBeNull();
  });

  it('finds the peak sample over a window and reads values', () => {
    const ch: DerivedChannel[] = [
      { label: 'a', plus: 'Fp1', minus: 'F7', data: new Float32Array([0, 1, -9, 2]), available: true, group: 0 },
      { label: 'b', plus: 'F7', minus: 'T7', data: new Float32Array([0, 5, 0, 7]), available: true, group: 0 },
      { label: 'c', plus: 'T7', minus: 'P7', data: new Float32Array([99, 99, 99, 99]), available: false, group: 0 },
    ];
    expect(peakSampleIndex(ch, 0, 4)).toBe(2);
    expect(peakSampleIndex(ch, 3, 4)).toBe(3);
    expect(valuesAt(ch, 2)).toEqual([-9, 0, NaN]);
  });
});
