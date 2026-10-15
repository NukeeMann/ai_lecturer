import { describe, expect, it } from 'vitest';

import { decodeRecording } from './recording';
import { EdfError, decimate, edfToRecording, microvoltFactor, parseEdfHeader, parseSeizureList, readEdfAnnotations, readEdfSignal } from './edf';

interface TestSignal {
  label: string;
  dim?: string;
  fs: number;
  /** value(tSec) in physical units */
  f: (t: number) => number;
  physMin?: number;
  physMax?: number;
}

/** Build a minimal EDF (or EDF+ with annotations) in memory. */
function buildEdf(signals: TestSignal[], seconds: number, recordSec = 1, annotations?: { onset: number; dur: number; text: string }[]): Uint8Array {
  const all = annotations ? [...signals, { label: 'EDF Annotations', dim: '', fs: 60 / recordSec, f: () => 0 }] : signals;
  const ns = all.length;
  const headerBytes = 256 + 256 * ns;
  const spr = all.map((s) => Math.round(s.fs * recordSec));
  const nRec = Math.ceil(seconds / recordSec);
  const recordBytes = spr.reduce((a, n) => a + 2 * n, 0);
  const buf = new Uint8Array(headerBytes + nRec * recordBytes);
  const put = (off: number, width: number, s: string) => {
    const t = s.padEnd(width, ' ').slice(0, width);
    for (let i = 0; i < width; i++) buf[off + i] = t.charCodeAt(i);
  };
  put(0, 8, '0');
  put(8, 80, 'X X X X');
  put(88, 80, 'Startdate X');
  put(168, 8, '01.01.20');
  put(176, 8, '00.00.00');
  put(184, 8, String(headerBytes));
  put(192, 44, annotations ? 'EDF+C' : '');
  put(236, 8, String(nRec));
  put(244, 8, String(recordSec));
  put(252, 4, String(ns));
  const widths = [16, 80, 8, 8, 8, 8, 8, 80, 8, 32];
  let col = 256;
  const cols: number[] = [];
  for (const w of widths) {
    cols.push(col);
    col += w * ns;
  }
  all.forEach((s, i) => {
    const isAnn = s.label === 'EDF Annotations';
    put(cols[0] + i * 16, 16, s.label);
    put(cols[2] + i * 8, 8, s.dim ?? 'uV');
    put(cols[3] + i * 8, 8, String(isAnn ? -1 : s.physMin ?? -3276.8));
    put(cols[4] + i * 8, 8, String(isAnn ? 1 : s.physMax ?? 3276.7));
    put(cols[5] + i * 8, 8, '-32768');
    put(cols[6] + i * 8, 8, '32767');
    put(cols[8] + i * 8, 8, String(spr[i]));
  });
  const view = new DataView(buf.buffer);
  for (let r = 0; r < nRec; r++) {
    let pos = headerBytes + r * recordBytes;
    all.forEach((s, i) => {
      if (s.label === 'EDF Annotations') {
        let tal = `+${r * recordSec}\u0014\u0014\u0000`;
        if (r === 0) for (const a of annotations ?? []) tal += `+${a.onset}\u0015${a.dur}\u0014${a.text}\u0014\u0000`;
        for (let k = 0; k < 2 * spr[i]; k++) buf[pos + k] = k < tal.length ? tal.charCodeAt(k) : 0;
        pos += 2 * spr[i];
        return;
      }
      const pMin = s.physMin ?? -3276.8;
      const pMax = s.physMax ?? 3276.7;
      for (let k = 0; k < spr[i]; k++) {
        const t = r * recordSec + k / s.fs;
        const dig = Math.round(-32768 + ((s.f(t) - pMin) / (pMax - pMin)) * 65535);
        view.setInt16(pos, Math.max(-32768, Math.min(32767, dig)), true);
        pos += 2;
      }
    });
  }
  return buf;
}

const sine = (hz: number, uv: number) => (t: number) => uv * Math.sin(2 * Math.PI * hz * t);

describe('EDF reader', () => {
  const edf = buildEdf(
    [
      { label: 'EEG Fp1-REF', fs: 256, f: sine(10, 50) },
      { label: 'EEG T3-REF', fs: 256, f: sine(5, 30) },
      { label: 'ECG', fs: 256, f: sine(1, 1) , dim: 'mV' },
    ],
    6,
    1,
    [{ onset: 2.5, dur: 1.5, text: 'seizure' }],
  );

  it('parses the header and scales physical values (incl. mV → µV)', () => {
    const h = parseEdfHeader(edf);
    expect(h.signals.map((s) => s.label)).toEqual(['EEG Fp1-REF', 'EEG T3-REF', 'ECG', 'EDF Annotations']);
    expect(h.numRecords).toBe(6);
    const fp1 = readEdfSignal(edf, h, 0, 0, 1);
    expect(fp1.length).toBe(256);
    expect(Math.max(...fp1)).toBeCloseTo(50, 0);
    const ecg = readEdfSignal(edf, h, 2, 0, 1);
    expect(Math.max(...ecg)).toBeCloseTo(1000, -1);
  });

  it('reads EDF+ annotations', () => {
    const ann = readEdfAnnotations(edf, parseEdfHeader(edf));
    expect(ann).toEqual([{ onsetSec: 2.5, durationSec: 1.5, label: 'seizure', source: 'EDF+ annotation' }]);
  });

  it('converts a referential segment with normalised labels, cut annotations and metadata', () => {
    const r = edfToRecording(edf, { startSec: 2, durationSec: 3, source: { dataset: 'Test', license: 'CC BY 4.0' } });
    expect(r.reference).toBe('common');
    expect(r.kept.map((k) => k.to)).toEqual(['Fp1', 'T7', 'ECG']);
    const rec = decodeRecording(r.file);
    expect(rec.durationSec).toBeCloseTo(3, 5);
    expect(rec.signals.map((s) => s.label)).toEqual(['Fp1', 'T7', 'ECG']);
    expect(rec.annotations[0]).toMatchObject({ onsetSec: 0.5, durationSec: 1.5, label: 'seizure' });
    expect(rec.source).toMatchObject({ dataset: 'Test', segmentStartSec: 2 });
    // Int16 quantisation keeps the amplitude within ~1 %.
    expect(Math.max(...rec.signals[0].data)).toBeGreaterThan(49);
  });

  it('detects bipolar CHB-MIT-style files and drops duplicates', () => {
    const chb = buildEdf(
      [
        { label: 'FP1-F7', fs: 256, f: sine(8, 40) },
        { label: 'F7-T7', fs: 256, f: sine(8, 40) },
        { label: 'T8-P8-0', fs: 256, f: sine(8, 40) },
        { label: 'T8-P8-1', fs: 256, f: sine(8, 40) },
        { label: '-', fs: 256, f: () => 0 },
      ],
      2,
    );
    const r = edfToRecording(chb, { startSec: 0, durationSec: 2 });
    expect(r.reference).toBe('bipolar');
    expect(r.kept.map((k) => k.to)).toEqual(['Fp1-F7', 'F7-T7', 'T8-P8']);
    expect(r.skipped.map((s) => s.reason)).toEqual(expect.arrayContaining(['duplicate of T8-P8', 'not an EEG electrode or derivation']));
  });

  it('decimates 1024 → 256 Hz with anti-aliasing', () => {
    const hi = buildEdf([{ label: 'Cz', fs: 1024, f: (t) => sine(5, 50)(t) + sine(300, 50)(t) }], 2);
    const r = edfToRecording(hi, { startSec: 0, durationSec: 2, targetRate: 256 });
    const rec = decodeRecording(r.file);
    expect(rec.sampleRate).toBe(256);
    expect(rec.signals[0].data.length).toBe(512);
    // The 300 Hz component (above the new Nyquist) is removed; the 5 Hz wave survives.
    const mid = rec.signals[0].data.subarray(64, 448);
    expect(Math.max(...mid)).toBeLessThan(60);
    expect(Math.max(...mid)).toBeGreaterThan(40);
    expect(() => edfToRecording(hi, { startSec: 0, durationSec: 2, targetRate: 300 })).toThrow(EdfError);
  });

  it('rejects segments outside the file and bad seizure specs', () => {
    expect(() => edfToRecording(edf, { startSec: 100, durationSec: 5 })).toThrow(EdfError);
    expect(parseSeizureList('10:5, 30:12.5')).toEqual([
      { onsetSec: 10, durationSec: 5, label: 'seizure', source: 'dataset annotation' },
      { onsetSec: 30, durationSec: 12.5, label: 'seizure', source: 'dataset annotation' },
    ]);
    expect(() => parseSeizureList('10-5')).toThrow(EdfError);
  });

  it('helpers', () => {
    expect(microvoltFactor('uV')).toBe(1);
    expect(microvoltFactor('mV')).toBe(1000);
    expect(microvoltFactor('%')).toBeNull();
    const x = new Float32Array(100).fill(1);
    expect(decimate(x, 100, 1)).toBe(x);
    expect(() => decimate(x, 100, 1.5)).toThrow(EdfError);
  });
});
