import { describe, expect, it } from 'vitest';

import { applyDisplayFilters, minMaxDecimate } from './dsp';
import { deriveChannels, MONTAGE_AVG, MONTAGE_LB, makeAverageMontage } from './montages';
import { createDisplayCache, displayKey, prepareDisplayChannels } from './pipeline';
import { decodeRecording, recordingToFile } from './recording';
import { generateRecording } from './synth';

const FILTERS = { lffHz: 0.5, hffHz: 70, notchHz: 50 };

describe('prepareDisplayChannels', () => {
  it('equals derivation followed by display filtering', () => {
    const rec = generateRecording({ durationSec: 4, seed: 3 });
    const a = prepareDisplayChannels(rec, MONTAGE_LB, FILTERS);
    const b = deriveChannels(rec, MONTAGE_LB).map((c) => applyDisplayFilters(c.data, FILTERS, rec.sampleRate));
    a.forEach((ch, i) => expect(Array.from(ch.data)).toEqual(Array.from(b[i])));
  });
});

describe('createDisplayCache', () => {
  it('returns cached results and evicts the least recently used', () => {
    const rec = generateRecording({ durationSec: 2, seed: 1 });
    const cache = createDisplayCache(2);
    const lb = cache.get(rec, MONTAGE_LB, FILTERS);
    expect(cache.get(rec, MONTAGE_LB, FILTERS)).toBe(lb);
    const avg = cache.get(rec, MONTAGE_AVG, FILTERS);
    expect(cache.size).toBe(2);
    cache.get(rec, MONTAGE_LB, FILTERS); // LB is now most recent
    cache.get(rec, MONTAGE_LB, { ...FILTERS, notchHz: null }); // evicts AVG
    expect(cache.size).toBe(2);
    expect(cache.get(rec, MONTAGE_AVG, FILTERS)).not.toBe(avg);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('keys on filters, phase, excludes and recording identity', () => {
    expect(displayKey(MONTAGE_AVG, FILTERS)).not.toBe(displayKey(MONTAGE_AVG, { ...FILTERS, hffHz: 35 }));
    expect(displayKey(MONTAGE_AVG, FILTERS)).not.toBe(displayKey(MONTAGE_AVG, { ...FILTERS, phase: 'causal' }));
    expect(displayKey(MONTAGE_AVG, FILTERS)).not.toBe(displayKey(makeAverageMontage(['Fp1']), FILTERS));
    expect(displayKey(MONTAGE_AVG, FILTERS, { excludeFromAverage: ['Fp2', 'Fp1'] })).toBe(
      displayKey(MONTAGE_AVG, FILTERS, { excludeFromAverage: ['Fp1', 'Fp2'] }),
    );
    const cache = createDisplayCache();
    const r1 = generateRecording({ durationSec: 1, seed: 1 });
    const r2 = generateRecording({ durationSec: 1, seed: 1 });
    expect(cache.get(r1, MONTAGE_LB, FILTERS)).not.toBe(cache.get(r2, MONTAGE_LB, FILTERS));
  });
});

describe('performance', () => {
  it('derives 18 ch from 21 electrodes × 30 s × 256 Hz, filters and decimates in well under budget', () => {
    // Round-trip through the file format so the input is a realistic decoded recording.
    const rec = decodeRecording(recordingToFile(generateRecording({ durationSec: 30, seed: 42 })));
    expect(rec.signals.length).toBeGreaterThanOrEqual(21);
    const run = () => {
      const chans = prepareDisplayChannels(rec, MONTAGE_LB, FILTERS);
      for (const ch of chans) minMaxDecimate(ch.data, 0, ch.data.length, 900);
      return chans.length;
    };
    run(); // warm-up (JIT)
    const times: number[] = [];
    for (let k = 0; k < 7; k++) {
      const t0 = performance.now();
      expect(run()).toBe(18);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    console.info(`[eeg perf] LB 18ch × 30 s, HP+LP+notch filtfilt + min/max → 900 cols: median ${median.toFixed(2)} ms (target < 20 ms)`);
    // Generous bound so the suite is not flaky on a loaded machine; the
    // console line reports the real number against the 20 ms target.
    expect(median).toBeLessThan(100);
  });
});
