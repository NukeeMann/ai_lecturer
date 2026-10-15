// EDF / EDF+ reader and conversion to the ai-lecturer-eeg@1 asset format
// (spec §2.4). Pure TypeScript on Uint8Array — runs in Node (the CLI in
// tools/eeg-convert) and in tests; no dependencies.
//
// EDF layout: a 256-byte fixed header, then 256 bytes per signal (fields
// stored column-wise: all labels, all transducers, …), then data records,
// each holding `samplesPerRecord[i]` little-endian Int16 samples of signal i
// in signal order. EDF+ adds an "EDF Annotations" signal with TALs.

import { lowpass, filtfilt } from './dsp';
import { normalizeElectrode, parseChannelLabel } from './electrodes';
import { encodeRecording, type EegAnnotation, type EegRecordingFileInput, type EegSource, type EegSubject } from './recording';

export interface EdfSignalHeader {
  label: string;
  transducer: string;
  physicalDimension: string;
  physicalMin: number;
  physicalMax: number;
  digitalMin: number;
  digitalMax: number;
  prefiltering: string;
  samplesPerRecord: number;
}

export interface EdfHeader {
  version: string;
  patient: string;
  recording: string;
  startDate: string;
  startTime: string;
  headerBytes: number;
  /** "EDF+C" / "EDF+D" for EDF+, else "". */
  reserved: string;
  numRecords: number;
  recordDurationSec: number;
  signals: EdfSignalHeader[];
}

export class EdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EdfError';
  }
}

const ascii = (bytes: Uint8Array, start: number, len: number): string => {
  let s = '';
  for (let i = start; i < start + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s.trim();
};

const num = (s: string, what: string): number => {
  const v = Number(s);
  if (!Number.isFinite(v)) throw new EdfError(`Invalid ${what}: "${s}"`);
  return v;
};

export function parseEdfHeader(bytes: Uint8Array): EdfHeader {
  if (bytes.length < 256) throw new EdfError('File too short for an EDF header');
  const ns = num(ascii(bytes, 252, 4), 'number of signals');
  const headerBytes = num(ascii(bytes, 184, 8), 'header size');
  if (headerBytes !== 256 + ns * 256) throw new EdfError(`Header size ${headerBytes} does not match ${ns} signals`);
  if (bytes.length < headerBytes) throw new EdfError('File truncated inside the signal headers');
  // Column offsets (in units of ns × width) of the signal header fields.
  const widths = [16, 80, 8, 8, 8, 8, 8, 80, 8, 32];
  const starts: number[] = [];
  widths.reduce((acc, w) => {
    starts.push(acc);
    return acc + w;
  }, 0);
  const at = (k: number, i: number) => ascii(bytes, 256 + starts[k] * ns + i * widths[k], widths[k]);
  const signals: EdfSignalHeader[] = Array.from({ length: ns }, (_, i) => ({
    label: at(0, i),
    transducer: at(1, i),
    physicalDimension: at(2, i),
    physicalMin: num(at(3, i), 'physical minimum'),
    physicalMax: num(at(4, i), 'physical maximum'),
    digitalMin: num(at(5, i), 'digital minimum'),
    digitalMax: num(at(6, i), 'digital maximum'),
    prefiltering: at(7, i),
    samplesPerRecord: num(at(8, i), 'samples per record'),
  }));
  let numRecords = num(ascii(bytes, 236, 8), 'number of records');
  const recordDurationSec = num(ascii(bytes, 244, 8), 'record duration');
  const recordBytes = signals.reduce((a, s) => a + 2 * s.samplesPerRecord, 0);
  if (numRecords < 0) numRecords = Math.floor((bytes.length - headerBytes) / recordBytes);
  return {
    version: ascii(bytes, 0, 8),
    patient: ascii(bytes, 8, 80),
    recording: ascii(bytes, 88, 80),
    startDate: ascii(bytes, 168, 8),
    startTime: ascii(bytes, 176, 8),
    headerBytes,
    reserved: ascii(bytes, 192, 44),
    numRecords,
    recordDurationSec,
    signals,
  };
}

export const isAnnotationSignal = (s: EdfSignalHeader) => s.label.toUpperCase().startsWith('EDF ANNOTATIONS');

/** Multiplier from the signal's physical unit to µV (null = not a voltage). */
export function microvoltFactor(dim: string): number | null {
  const d = dim.replace(/\s+/g, '').toLowerCase();
  if (d === 'uv' || d === 'µv' || d === 'μv' || d === 'microvolt' || d === 'microvolts') return 1;
  if (d === 'mv') return 1e3;
  if (d === 'v') return 1e6;
  if (d === 'nv') return 1e-3;
  return null;
}

/**
 * Physical samples (µV when the unit is a voltage, else the native unit) of
 * signal `index` for whole records covering [startSec, startSec + durSec).
 */
export function readEdfSignal(
  bytes: Uint8Array,
  header: EdfHeader,
  index: number,
  startSec = 0,
  durSec = Infinity,
): Float32Array {
  const s = header.signals[index];
  if (!s) throw new EdfError(`No signal #${index}`);
  const fs = s.samplesPerRecord / header.recordDurationSec;
  const total = header.numRecords * s.samplesPerRecord;
  const i0 = Math.max(0, Math.floor(startSec * fs));
  const i1 = Math.min(total, Number.isFinite(durSec) ? Math.floor((startSec + durSec) * fs) : total);
  if (i1 <= i0) throw new EdfError(`Segment ${startSec}+${durSec} s is outside the recording (${(total / fs).toFixed(1)} s)`);
  const recordBytes = header.signals.reduce((a, x) => a + 2 * x.samplesPerRecord, 0);
  const offsetInRecord = header.signals.slice(0, index).reduce((a, x) => a + 2 * x.samplesPerRecord, 0);
  const gain = (s.physicalMax - s.physicalMin) / (s.digitalMax - s.digitalMin || 1);
  const unit = microvoltFactor(s.physicalDimension) ?? 1;
  const out = new Float32Array(i1 - i0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = i0; i < i1; i++) {
    const rec = Math.floor(i / s.samplesPerRecord);
    const k = i - rec * s.samplesPerRecord;
    const pos = header.headerBytes + rec * recordBytes + offsetInRecord + 2 * k;
    if (pos + 2 > bytes.length) break;
    const dig = view.getInt16(pos, true);
    out[i - i0] = (s.physicalMin + (dig - s.digitalMin) * gain) * unit;
  }
  return out;
}

/** EDF+ annotations (TALs), times relative to the file start. */
export function readEdfAnnotations(bytes: Uint8Array, header: EdfHeader): EegAnnotation[] {
  const idx = header.signals.findIndex(isAnnotationSignal);
  if (idx < 0) return [];
  const s = header.signals[idx];
  const recordBytes = header.signals.reduce((a, x) => a + 2 * x.samplesPerRecord, 0);
  const offsetInRecord = header.signals.slice(0, idx).reduce((a, x) => a + 2 * x.samplesPerRecord, 0);
  const out: EegAnnotation[] = [];
  for (let r = 0; r < header.numRecords; r++) {
    const start = header.headerBytes + r * recordBytes + offsetInRecord;
    const raw = ascii(bytes, start, 2 * s.samplesPerRecord);
    for (const tal of raw.split('\u0000')) {
      if (!tal) continue;
      const parts = tal.split('\u0014');
      const [onsetPart, durPart] = parts[0].split('\u0015');
      const onset = Number(onsetPart);
      if (!Number.isFinite(onset)) continue;
      const duration = durPart ? Number(durPart) : 0;
      for (const text of parts.slice(1)) {
        const label = text.trim();
        if (label) out.push({ onsetSec: onset, durationSec: Number.isFinite(duration) ? duration : 0, label, source: 'EDF+ annotation' });
      }
    }
  }
  return out;
}

/** Integer-factor decimation with a zero-phase anti-alias low-pass (≈ 0.4 × new rate). */
export function decimate(x: Float32Array, fs: number, factor: number): Float32Array {
  if (!Number.isInteger(factor) || factor < 1) throw new EdfError(`Decimation factor must be a positive integer (got ${factor})`);
  if (factor === 1) return x;
  const fc = (0.4 * fs) / factor;
  const lp = filtfilt(x, [lowpass(fc, fs), lowpass(fc, fs)]);
  const out = new Float32Array(Math.floor(lp.length / factor));
  for (let i = 0; i < out.length; i++) out[i] = lp[i * factor];
  return out;
}

export interface EdfConvertOptions {
  startSec: number;
  durationSec: number;
  /** Keep only these channels (any label spelling the normaliser accepts). */
  channels?: readonly string[];
  /** Target sample rate (must divide the native rate). Default: native. */
  targetRate?: number;
  /** Extra annotations in FILE time (seconds from the recording start). */
  extraAnnotations?: readonly EegAnnotation[];
  source?: EegSource;
  subject?: EegSubject;
}

export interface EdfConvertReport {
  file: EegRecordingFileInput;
  reference: 'common' | 'bipolar';
  kept: { from: string; to: string }[];
  skipped: { label: string; reason: string }[];
  sampleRate: number;
}

/** Convert an EDF/EDF+ file segment to the ai-lecturer-eeg@1 asset format. */
export function edfToRecording(bytes: Uint8Array, opts: EdfConvertOptions): EdfConvertReport {
  const header = parseEdfHeader(bytes);
  const wanted = opts.channels ? new Set(opts.channels.map((c) => parseChannelLabel(c)?.label ?? c)) : null;
  const skipped: EdfConvertReport['skipped'] = [];
  const candidates: { index: number; label: string; kind: 'electrode' | 'derivation' | 'nonScalp' }[] = [];
  const seen = new Set<string>();

  header.signals.forEach((s, i) => {
    if (isAnnotationSignal(s)) return;
    const raw = s.label.replace(/-\d+$/, ''); // CHB-MIT duplicates: "T8-P8-0", "T8-P8-1"
    const parsed = parseChannelLabel(raw);
    const nonScalp = !parsed ? normalizeElectrode(raw) : null;
    const label = parsed?.label ?? nonScalp;
    if (!label) return void skipped.push({ label: s.label, reason: 'not an EEG electrode or derivation' });
    if (microvoltFactor(s.physicalDimension) === null) return void skipped.push({ label: s.label, reason: `unit "${s.physicalDimension}" is not a voltage` });
    if (seen.has(label)) return void skipped.push({ label: s.label, reason: `duplicate of ${label}` });
    if (wanted && !wanted.has(label)) return void skipped.push({ label: s.label, reason: 'not requested' });
    seen.add(label);
    candidates.push({ index: i, label, kind: parsed ? parsed.kind : 'nonScalp' });
  });

  const eeg = candidates.filter((c) => c.kind !== 'nonScalp');
  if (eeg.length === 0) throw new EdfError('No EEG channels found');
  const derivations = eeg.filter((c) => c.kind === 'derivation').length;
  const reference: 'common' | 'bipolar' = derivations > eeg.length / 2 ? 'bipolar' : 'common';
  // Mixed files: keep the majority kind (+ ECG-type channels).
  const kept = candidates.filter((c) => c.kind === 'nonScalp' || (reference === 'bipolar' ? c.kind === 'derivation' : c.kind === 'electrode'));
  for (const c of candidates) if (!kept.includes(c)) skipped.push({ label: header.signals[c.index].label, reason: `not a ${reference} channel` });

  const rates = new Set(kept.map((c) => header.signals[c.index].samplesPerRecord / header.recordDurationSec));
  if (rates.size !== 1) throw new EdfError(`Channels have different sample rates (${[...rates].join(', ')} Hz) — select channels with --channels`);
  const fs = [...rates][0];
  const target = opts.targetRate ?? fs;
  const factor = fs / target;
  if (!Number.isInteger(factor)) throw new EdfError(`Target rate ${target} Hz must divide the native ${fs} Hz`);

  const signals = kept.map((c) => ({
    label: c.label,
    data: decimate(readEdfSignal(bytes, header, c.index, opts.startSec, opts.durationSec), fs, factor),
  }));
  const n = Math.min(...signals.map((s) => s.data.length));
  const end = opts.startSec + n / target;

  const annotations = [...readEdfAnnotations(bytes, header), ...(opts.extraAnnotations ?? [])]
    .filter((a) => a.onsetSec + (a.durationSec ?? 0) >= opts.startSec && a.onsetSec < end)
    .map((a) => {
      const on = Math.max(opts.startSec, a.onsetSec);
      const off = Math.min(end, a.onsetSec + (a.durationSec ?? 0));
      return { ...a, onsetSec: +(on - opts.startSec).toFixed(3), durationSec: +Math.max(0, off - on).toFixed(3) };
    });

  const file = encodeRecording({
    sampleRate: target,
    reference,
    signals: signals.map((s) => ({ label: s.label, data: s.data.subarray(0, n) })),
    annotations,
    source: { ...opts.source, segmentStartSec: opts.startSec },
    subject: opts.subject,
  });
  return { file, reference, kept: kept.map((c) => ({ from: header.signals[c.index].label, to: c.label })), skipped, sampleRate: target };
}

/** Parse "onset:duration,onset:duration" (seconds, file time) into annotations. */
export function parseSeizureList(spec: string, label = 'seizure', source = 'dataset annotation'): EegAnnotation[] {
  return spec
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [on, dur] = p.split(':').map(Number);
      if (!Number.isFinite(on) || !Number.isFinite(dur)) throw new EdfError(`Bad seizure spec "${p}" (expected onset:duration)`);
      return { onsetSec: on, durationSec: dur, label, source };
    });
}
