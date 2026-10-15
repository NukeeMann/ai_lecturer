import { afterEach, describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  bytesToBase64,
  chooseUvPerUnit,
  decodeRecording,
  EEG_FORMAT_ID,
  encodeRecording,
  EegRecordingError,
  getSignal,
  recordingLabels,
  recordingToFile,
  safeDecodeRecording,
} from './recording';

function sine(n: number, fs: number, f: number, amp: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * f * i) / fs);
  return out;
}

describe('encode/decode round trip', () => {
  it('reproduces samples within half a quantisation step', () => {
    const fs = 256;
    const a = sine(fs * 2, fs, 10, 87.3);
    const b = sine(fs * 2, fs, 3, -412.9);
    const file = encodeRecording({
      sampleRate: fs,
      reference: 'common',
      signals: [
        { label: 'Fp1', data: a },
        { label: 'T3', data: b },
      ],
      annotations: [{ onsetSec: 0.5, label: 'event' }],
      source: { dataset: 'unit test', license: 'CC0' },
    });
    expect(file.format).toBe(EEG_FORMAT_ID);
    expect(file.durationSec).toBe(2);
    const rec = decodeRecording(JSON.parse(JSON.stringify(file)));
    expect(rec.nSamples).toBe(512);
    expect(rec.sampleRate).toBe(256);
    expect(recordingLabels(rec)).toEqual(['Fp1', 'T7']); // T3 → T7
    expect(rec.annotations).toEqual([{ onsetSec: 0.5, durationSec: 0, label: 'event' }]);
    expect(rec.synthetic).toBe(false);
    const [sa, sb] = file.signals;
    const da = getSignal(rec, 'Fp1')!;
    const db = getSignal(rec, 'T7')!;
    for (let i = 0; i < a.length; i++) {
      expect(Math.abs(da[i] - a[i])).toBeLessThanOrEqual(sa.uvPerUnit / 2 + 1e-4);
      expect(Math.abs(db[i] - b[i])).toBeLessThanOrEqual(sb.uvPerUnit / 2 + 1e-4);
    }
  });

  it('chooses a scale that never clips', () => {
    const data = [0, 1000.4, -1234.56, 3];
    const k = chooseUvPerUnit(data);
    expect(Math.round(1234.56 / k)).toBeLessThanOrEqual(32767);
    expect(chooseUvPerUnit([0, 0])).toBe(0.01);
    expect(chooseUvPerUnit([1e-3])).toBe(0.01);
  });

  it('clamps explicit scales that would overflow Int16', () => {
    const file = encodeRecording({
      sampleRate: 100,
      reference: 'common',
      signals: [{ label: 'Cz', data: [5000, -5000], uvPerUnit: 0.1 }],
    });
    const rec = decodeRecording(file);
    expect(rec.signals[0].data[0]).toBeCloseTo(3276.7, 3);
    expect(rec.signals[0].data[1]).toBeCloseTo(-3276.8, 3);
  });

  it('keeps the synthetic flag and canonicalises bipolar labels', () => {
    const file = encodeRecording({
      sampleRate: 100,
      reference: 'bipolar',
      synthetic: true,
      signals: [
        { label: 'EEG FP1-F7', data: [1, 2] },
        { label: 'T3-T5', data: [3, 4] },
      ],
    });
    const rec = decodeRecording(file);
    expect(rec.synthetic).toBe(true);
    expect(recordingLabels(rec)).toEqual(['Fp1-F7', 'T7-P7']);
  });

  it('round-trips a decoded recording back to a file', () => {
    const rec = decodeRecording(
      encodeRecording({ sampleRate: 10, reference: 'common', signals: [{ label: 'O1', data: [1, -1, 2, -2] }] }),
    );
    const again = decodeRecording(recordingToFile(rec));
    expect(Array.from(again.signals[0].data)).toEqual(Array.from(rec.signals[0].data));
  });
});

describe('decodeRecording validation', () => {
  const base = () =>
    encodeRecording({
      sampleRate: 4,
      reference: 'common',
      signals: [
        { label: 'Fp1', data: [1, 2, 3, 4] },
        { label: 'Fp2', data: [1, 2, 3, 4] },
      ],
    });

  it('rejects a wrong format id', () => {
    expect(() => decodeRecording({ ...base(), format: 'edf' })).toThrow(EegRecordingError);
  });

  it('rejects duplicate labels after canonicalisation', () => {
    const f = base();
    f.signals[1].label = 'FP1';
    expect(() => decodeRecording(f)).toThrow(/Duplicate signal label "Fp1"/);
  });

  it('rejects signals of different length', () => {
    const f = base();
    f.signals[1].data = bytesToBase64(new Uint8Array(6));
    expect(() => decodeRecording(f)).toThrow(/has 3 samples, expected 4/);
  });

  it('rejects an odd byte count', () => {
    const f = base();
    f.signals[0].data = bytesToBase64(new Uint8Array(7));
    expect(() => decodeRecording(f)).toThrow(/odd byte count/);
  });

  it('rejects a duration that does not match the samples', () => {
    expect(() => decodeRecording({ ...base(), durationSec: 3 })).toThrow(/durationSec/);
  });

  it('safeDecodeRecording reports instead of throwing', () => {
    const r = safeDecodeRecording({ nope: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invalid EEG recording/);
    expect(safeDecodeRecording(base()).ok).toBe(true);
  });
});

describe('base64 without Node Buffer (browser path)', () => {
  const g = globalThis as { Buffer?: unknown };
  const saved = g.Buffer;
  afterEach(() => {
    g.Buffer = saved;
  });

  it('decodes and encodes with atob/btoa', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    const viaNode = bytesToBase64(bytes);
    g.Buffer = undefined;
    expect(bytesToBase64(bytes)).toBe(viaNode);
    expect(Array.from(base64ToBytes(viaNode))).toEqual(Array.from(bytes));
    const file = encodeRecording({ sampleRate: 2, reference: 'common', signals: [{ label: 'Cz', data: [10, -20] }] });
    expect(Array.from(decodeRecording(file).signals[0].data)).toEqual([10, -20]);
  });
});
