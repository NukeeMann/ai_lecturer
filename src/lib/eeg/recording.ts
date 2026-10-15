// `ai-lecturer-eeg@1` — the on-disk format of an EEG segment used by the
// widgets, plus decode/encode helpers.
//
// A recording is stored as one JSON asset under
// `courses/<slug>/assets/eeg/<name>.json` (≲ 1 MB). Each signal is Int16
// little-endian samples, base64-encoded, with a per-channel scale
// (`uvPerUnit`, µV per LSB). Decoding yields Float32 µV arrays.
//
// Pure TypeScript, Node-safe: works in the browser (atob/btoa) and in Node
// (Buffer) so the converter, tests and print page share it.

import { z } from 'zod';

import { normalizeElectrode, parseChannelLabel } from './electrodes';

export const EEG_FORMAT_ID = 'ai-lecturer-eeg@1';

export const EegAnnotationSchema = z.object({
  onsetSec: z.number().nonnegative(),
  durationSec: z.number().nonnegative().default(0),
  label: z.string().min(1),
  /** Electrodes or derivation labels the event involves (informative). */
  channels: z.array(z.string().min(1)).optional(),
  /** Who annotated it, e.g. "expert consensus (3 raters)" or "simulation". */
  source: z.string().optional(),
});
export type EegAnnotation = z.infer<typeof EegAnnotationSchema>;

export const EegSourceSchema = z.object({
  dataset: z.string().optional(),
  record: z.string().optional(),
  segmentStartSec: z.number().nonnegative().optional(),
  url: z.string().optional(),
  license: z.string().optional(),
  citation: z.string().optional(),
});
export type EegSource = z.infer<typeof EegSourceSchema>;

export const EegSubjectSchema = z.object({
  age: z.string().optional(),
  state: z.string().optional(),
  notes: z.string().optional(),
});
export type EegSubject = z.infer<typeof EegSubjectSchema>;

export const EegReferenceKindSchema = z.enum(['common', 'bipolar']);
/**
 * `common`: each signal is one electrode's potential against a single
 * recording reference (any montage can be re-derived).
 * `bipolar`: signals are fixed derivations such as "Fp1-F7" (only the
 * native montage — and channels that are exact matches or inversions — can
 * be shown).
 */
export type EegReferenceKind = z.infer<typeof EegReferenceKindSchema>;

export const EegSignalFileSchema = z.object({
  /** Canonical electrode ("Fp1") for `common`, derivation ("Fp1-F7") for `bipolar`. */
  label: z.string().min(1),
  /** µV represented by one Int16 step. */
  uvPerUnit: z.number().positive(),
  /** Int16 little-endian samples, base64. */
  data: z.string(),
});

export const EegRecordingFileSchema = z.object({
  format: z.literal(EEG_FORMAT_ID),
  sampleRate: z.number().positive().max(10_000),
  durationSec: z.number().positive(),
  reference: EegReferenceKindSchema,
  signals: z.array(EegSignalFileSchema).min(1),
  annotations: z.array(EegAnnotationSchema).default([]),
  source: EegSourceSchema.optional(),
  subject: EegSubjectSchema.optional(),
  /** True for synthetic (simulated) signals — widgets must show a badge. */
  synthetic: z.boolean().optional(),
});
/** Parsed file (defaults applied). */
export type EegRecordingFile = z.infer<typeof EegRecordingFileSchema>;
/** File as written to disk / accepted on input (defaults optional). */
export type EegRecordingFileInput = z.input<typeof EegRecordingFileSchema>;

export interface EegSignal {
  /** Canonical label (electrode or `plus-minus` derivation). */
  label: string;
  /** Samples in µV. */
  data: Float32Array;
}

/** In-memory recording, the input of every montage / DSP / render function. */
export interface DecodedRecording {
  sampleRate: number;
  /** Number of samples per signal (all signals share it). */
  nSamples: number;
  durationSec: number;
  reference: EegReferenceKind;
  signals: EegSignal[];
  annotations: EegAnnotation[];
  source?: EegSource;
  subject?: EegSubject;
  /** True for simulated data (widgets must show the SimulationBadge). */
  synthetic: boolean;
}

export class EegRecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EegRecordingError';
  }
}

// ---------------------------------------------------------------------------
// base64 helpers (browser + Node)
// ---------------------------------------------------------------------------

interface BufferLike {
  from(input: string, encoding: 'base64'): Uint8Array;
  from(input: Uint8Array): { toString(encoding: 'base64'): string };
}

function nodeBuffer(): BufferLike | null {
  const b = (globalThis as { Buffer?: unknown }).Buffer;
  return typeof b === 'function' ? (b as unknown as BufferLike) : null;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const buf = nodeBuffer();
  if (buf) {
    const out = buf.from(clean, 'base64');
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const buf = nodeBuffer();
  if (buf) return buf.from(bytes).toString('base64');
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(bytes.length, i + CHUNK))),
    );
  }
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

function canonicalLabel(raw: string, reference: EegReferenceKind): string {
  if (reference === 'common') return normalizeElectrode(raw) ?? raw.trim();
  const parsed = parseChannelLabel(raw);
  if (parsed?.kind === 'derivation') return parsed.label;
  return raw.trim();
}

function decodeInt16(b64: string, uvPerUnit: number, label: string): Float32Array {
  const bytes = base64ToBytes(b64);
  if (bytes.length % 2 !== 0) {
    throw new EegRecordingError(`Signal "${label}": odd byte count ${bytes.length} (expected Int16 samples)`);
  }
  const n = bytes.length / 2;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) * uvPerUnit;
  return out;
}

/**
 * Validate and decode an `ai-lecturer-eeg@1` JSON object.
 *
 * Labels are canonicalised (old names → new, case fixed); every signal must
 * have the same number of samples and `durationSec` must agree with
 * `samples / sampleRate` (± 1 sample). Throws {@link EegRecordingError} with a
 * readable message on any problem.
 */
export function decodeRecording(json: unknown): DecodedRecording {
  const parsed = EegRecordingFileSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') || '(root)';
    throw new EegRecordingError(`Invalid EEG recording at ${path}: ${issue?.message ?? 'unknown error'}`);
  }
  const file = parsed.data;
  const seen = new Set<string>();
  const signals: EegSignal[] = [];
  let nSamples = -1;
  for (const s of file.signals) {
    const label = canonicalLabel(s.label, file.reference);
    if (seen.has(label)) throw new EegRecordingError(`Duplicate signal label "${label}"`);
    seen.add(label);
    const data = decodeInt16(s.data, s.uvPerUnit, label);
    if (nSamples < 0) nSamples = data.length;
    else if (data.length !== nSamples) {
      throw new EegRecordingError(
        `Signal "${label}" has ${data.length} samples, expected ${nSamples} like the first signal`,
      );
    }
    signals.push({ label, data });
  }
  const expected = file.durationSec * file.sampleRate;
  if (nSamples <= 0 || Math.abs(expected - nSamples) > 1) {
    throw new EegRecordingError(
      `durationSec × sampleRate = ${expected.toFixed(1)} samples but the signals hold ${nSamples}`,
    );
  }
  return {
    sampleRate: file.sampleRate,
    nSamples,
    durationSec: nSamples / file.sampleRate,
    reference: file.reference,
    signals,
    annotations: file.annotations,
    source: file.source,
    subject: file.subject,
    synthetic: file.synthetic === true,
  };
}

export type SafeDecodeResult =
  | { ok: true; recording: DecodedRecording }
  | { ok: false; error: string };

/** Non-throwing {@link decodeRecording} for UI code. */
export function safeDecodeRecording(json: unknown): SafeDecodeResult {
  try {
    return { ok: true, recording: decodeRecording(json) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

export interface EncodeSignalInput {
  label: string;
  data: ArrayLike<number>;
  /** Fixed scale; default: smallest "nice" scale that avoids clipping. */
  uvPerUnit?: number;
}

export interface EncodeRecordingInput {
  sampleRate: number;
  reference: EegReferenceKind;
  signals: EncodeSignalInput[];
  annotations?: z.input<typeof EegAnnotationSchema>[];
  source?: EegSource;
  subject?: EegSubject;
  synthetic?: boolean;
  /** Finest allowed resolution in µV/LSB when auto-scaling (default 0.01). */
  minUvPerUnit?: number;
}

const INT16_MAX = 32767;

/** Round `x` up to 3 significant digits (keeps JSON tidy, never clips). */
function ceil3(x: number): number {
  if (!(x > 0)) return x;
  const e = Math.floor(Math.log10(x)) - 2;
  const f = Math.pow(10, e);
  return Math.ceil(x / f - 1e-9) * f;
}

/** Choose a per-channel µV/LSB that covers the signal's range without clipping. */
export function chooseUvPerUnit(data: ArrayLike<number>, minUvPerUnit = 0.01): number {
  let maxAbs = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > maxAbs && Number.isFinite(a)) maxAbs = a;
  }
  const raw = maxAbs / INT16_MAX;
  return Math.max(minUvPerUnit, ceil3(raw));
}

function encodeInt16(data: ArrayLike<number>, uvPerUnit: number): string {
  const bytes = new Uint8Array(data.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    let q = Number.isFinite(v) ? Math.round(v / uvPerUnit) : 0;
    if (q > INT16_MAX) q = INT16_MAX;
    else if (q < -32768) q = -32768;
    view.setInt16(i * 2, q, true);
  }
  return bytesToBase64(bytes);
}

/**
 * Build an `ai-lecturer-eeg@1` JSON object from µV samples (used by the EDF
 * converter, tests and fixtures). All signals must have the same length.
 */
export function encodeRecording(input: EncodeRecordingInput): EegRecordingFileInput {
  if (input.signals.length === 0) throw new EegRecordingError('encodeRecording: no signals');
  const n = input.signals[0].data.length;
  if (n === 0) throw new EegRecordingError('encodeRecording: empty signals');
  for (const s of input.signals) {
    if (s.data.length !== n) {
      throw new EegRecordingError(`encodeRecording: signal "${s.label}" has ${s.data.length} samples, expected ${n}`);
    }
  }
  const signals = input.signals.map((s) => {
    const uvPerUnit = s.uvPerUnit ?? chooseUvPerUnit(s.data, input.minUvPerUnit);
    return { label: s.label, uvPerUnit, data: encodeInt16(s.data, uvPerUnit) };
  });
  const out: EegRecordingFileInput = {
    format: EEG_FORMAT_ID,
    sampleRate: input.sampleRate,
    durationSec: n / input.sampleRate,
    reference: input.reference,
    signals,
    annotations: input.annotations ?? [],
  };
  if (input.source) out.source = input.source;
  if (input.subject) out.subject = input.subject;
  if (input.synthetic) out.synthetic = true;
  return out;
}

/** Encode an in-memory recording back to the file format (e.g. for fixtures). */
export function recordingToFile(rec: DecodedRecording): EegRecordingFileInput {
  return encodeRecording({
    sampleRate: rec.sampleRate,
    reference: rec.reference,
    signals: rec.signals.map((s) => ({ label: s.label, data: s.data })),
    annotations: rec.annotations,
    source: rec.source,
    subject: rec.subject,
    synthetic: rec.synthetic,
  });
}

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

const signalMaps = new WeakMap<DecodedRecording, Map<string, Float32Array>>();

/** Label → samples map of a recording (cached per recording object). */
export function signalMap(rec: DecodedRecording): Map<string, Float32Array> {
  let m = signalMaps.get(rec);
  if (!m) {
    m = new Map(rec.signals.map((s) => [s.label, s.data] as const));
    signalMaps.set(rec, m);
  }
  return m;
}

export function getSignal(rec: DecodedRecording, label: string): Float32Array | null {
  return signalMap(rec).get(label) ?? null;
}

/** Labels of the recording (canonical, in file order). */
export function recordingLabels(rec: DecodedRecording): string[] {
  return rec.signals.map((s) => s.label);
}
