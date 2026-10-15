// Montage definitions (ACNS Guideline 3, 2016; modern electrode names) and
// derivation of display channels from a recording.
//
// Pure TypeScript, Node-safe.
//
// Sign convention: a channel "plus-minus" (G1-G2) carries V(plus) − V(minus).
// The renderer draws NEGATIVE UP (see POLARITY_NEGATIVE_UP in dsp.ts): when
// G1 is more negative than G2 the trace deflects upwards.

import { electrodeSide, isScalpElectrode } from './electrodes';
import { signalMap, type DecodedRecording } from './recording';

/** Common average of the scalp electrodes (see `excludeFromAverage`). */
export const REF_AVG = 'AVG';
/** Ipsilateral ear: left − A1, right − A2, midline − (A1 + A2) / 2. */
export const REF_EAR_IPSI = 'A1A2_IPSI';
/** "As recorded" — no re-referencing (potential vs the recording reference). */
export const REF_RECORDING = 'REF';

export interface MontageChannel {
  /** Display label, e.g. "Fp1-F7", "T7-AVG", "Cz-A1A2". */
  label: string;
  /** G1 (input 1) electrode. */
  plus: string;
  /** G2: an electrode, {@link REF_AVG}, {@link REF_EAR_IPSI} or {@link REF_RECORDING}. */
  minus: string;
}

export interface Montage {
  id: string;
  label: string;
  kind: 'bipolar' | 'referential';
  channels: MontageChannel[];
  /** Indices AFTER which the renderer leaves a visual gap between chains. */
  groupBreaks?: number[];
  /** Electrodes left out of the common average (e.g. blink-contaminated Fp1/Fp2). */
  excludeFromAverage?: string[];
}

export interface DerivedChannel {
  label: string;
  plus: string;
  minus: string;
  /** µV. Read-only by convention (may alias recording data). Zeros when unavailable. */
  data: Float32Array;
  /** False when an electrode the channel needs is missing from the recording. */
  available: boolean;
  /** Chain / group index derived from `groupBreaks` (0-based). */
  group: number;
}

const bip = (pairs: string[]): MontageChannel[] =>
  pairs.map((p) => {
    const [plus, minus] = p.split('-');
    return { label: p, plus, minus };
  });

/** Referential display order: chains as in the double banana, left above right. */
export const REFERENTIAL_ORDER: readonly string[] = [
  'Fp1', 'F7', 'T7', 'P7', 'O1',
  'F3', 'C3', 'P3',
  'Fz', 'Cz', 'Pz',
  'F4', 'C4', 'P4',
  'Fp2', 'F8', 'T8', 'P8', 'O2',
];
const REFERENTIAL_BREAKS = [4, 7, 10, 13];

/** Longitudinal bipolar ("double banana"), 18 channels. */
export const MONTAGE_LB: Montage = {
  id: 'LB',
  label: 'Longitudinal bipolar',
  kind: 'bipolar',
  channels: bip([
    'Fp1-F7', 'F7-T7', 'T7-P7', 'P7-O1',
    'Fp1-F3', 'F3-C3', 'C3-P3', 'P3-O1',
    'Fz-Cz', 'Cz-Pz',
    'Fp2-F4', 'F4-C4', 'C4-P4', 'P4-O2',
    'Fp2-F8', 'F8-T8', 'T8-P8', 'P8-O2',
  ]),
  groupBreaks: [3, 7, 9, 13],
};

/** Transverse bipolar, 18 channels, left to right within each row. */
export const MONTAGE_TB: Montage = {
  id: 'TB',
  label: 'Transverse bipolar',
  kind: 'bipolar',
  channels: bip([
    'F7-Fp1', 'Fp1-Fp2', 'Fp2-F8',
    'F7-F3', 'F3-Fz', 'Fz-F4', 'F4-F8',
    'T7-C3', 'C3-Cz', 'Cz-C4', 'C4-T8',
    'P7-P3', 'P3-Pz', 'Pz-P4', 'P4-P8',
    'P7-O1', 'O1-O2', 'O2-P8',
  ]),
  groupBreaks: [2, 6, 10, 14],
};

/** Common average reference over the available scalp electrodes. */
export const MONTAGE_AVG: Montage = {
  id: 'AVG',
  label: 'Average reference',
  kind: 'referential',
  channels: REFERENTIAL_ORDER.map((e) => ({ label: `${e}-AVG`, plus: e, minus: REF_AVG })),
  groupBreaks: REFERENTIAL_BREAKS,
};

const CZ_ORDER = REFERENTIAL_ORDER.filter((e) => e !== 'Cz');

/** Cz (vertex) reference. Cz itself is omitted (it would be flat). */
export const MONTAGE_CZ: Montage = {
  id: 'CZ',
  label: 'Cz reference',
  kind: 'referential',
  channels: CZ_ORDER.map((e) => ({ label: `${e}-Cz`, plus: e, minus: 'Cz' })),
  groupBreaks: [4, 7, 9, 12],
};

function earLabel(e: string): string {
  const side = electrodeSide(e);
  return side === 'left' ? `${e}-A1` : side === 'right' ? `${e}-A2` : `${e}-A1A2`;
}

/** Ipsilateral ear reference (left − A1, right − A2, midline − mean(A1, A2)). */
export const MONTAGE_EAR: Montage = {
  id: 'EAR',
  label: 'Ipsilateral ear reference',
  kind: 'referential',
  channels: REFERENTIAL_ORDER.map((e) => ({ label: earLabel(e), plus: e, minus: REF_EAR_IPSI })),
  groupBreaks: REFERENTIAL_BREAKS,
};

/** ACNS neonatal reduced double banana (12 channels). */
export const MONTAGE_NEO: Montage = {
  id: 'NEO',
  label: 'Neonatal bipolar',
  kind: 'bipolar',
  channels: bip([
    'Fp1-T7', 'T7-O1',
    'Fp2-T8', 'T8-O2',
    'Fp1-C3', 'C3-O1',
    'Fp2-C4', 'C4-O2',
    'T7-C3', 'C3-Cz', 'Cz-C4', 'C4-T8',
  ]),
  groupBreaks: [1, 3, 5, 7],
};

export const BUILTIN_MONTAGES: Readonly<Record<string, Montage>> = {
  LB: MONTAGE_LB,
  TB: MONTAGE_TB,
  AVG: MONTAGE_AVG,
  CZ: MONTAGE_CZ,
  EAR: MONTAGE_EAR,
  NEO: MONTAGE_NEO,
};

export const MONTAGE_IDS = ['LB', 'TB', 'AVG', 'CZ', 'EAR', 'NEO'] as const;
export type BuiltinMontageId = (typeof MONTAGE_IDS)[number];

/** Built-in montage by id (case-insensitive), or null. */
export function getMontage(id: string): Montage | null {
  return BUILTIN_MONTAGES[id.toUpperCase()] ?? null;
}

/** AVG montage that leaves `exclude` out of the average (labelled accordingly). */
export function makeAverageMontage(exclude: readonly string[] = []): Montage {
  if (exclude.length === 0) return MONTAGE_AVG;
  return {
    ...MONTAGE_AVG,
    label: `Average reference (without ${exclude.join(', ')})`,
    excludeFromAverage: [...exclude],
  };
}

/** Referential montage "as recorded" (no re-referencing) for a common-reference recording. */
export function recordedReferenceMontage(rec: DecodedRecording): Montage {
  const labels = new Set(rec.signals.map((s) => s.label));
  const ordered = REFERENTIAL_ORDER.filter((e) => labels.has(e));
  const rest = rec.signals.map((s) => s.label).filter((l) => !ordered.includes(l) && isScalpElectrode(l));
  return {
    id: 'REF',
    label: 'Recording reference',
    kind: 'referential',
    channels: [...ordered, ...rest].map((e) => ({ label: `${e}-Ref`, plus: e, minus: REF_RECORDING })),
  };
}

/** The montage a fixed-bipolar recording was stored in (channel order kept). */
export function nativeMontage(rec: DecodedRecording): Montage {
  if (rec.reference !== 'bipolar') return recordedReferenceMontage(rec);
  return {
    id: 'NATIVE',
    label: 'Recorded montage',
    kind: 'bipolar',
    channels: rec.signals
      .map((s) => {
        const i = s.label.indexOf('-');
        if (i <= 0) return null;
        return { label: s.label, plus: s.label.slice(0, i), minus: s.label.slice(i + 1) };
      })
      .filter((c): c is MontageChannel => c !== null),
  };
}

/** Group (chain) index of every channel from `groupBreaks`. */
export function channelGroups(montage: Montage): number[] {
  const breaks = new Set(montage.groupBreaks ?? []);
  const out: number[] = [];
  let g = 0;
  for (let i = 0; i < montage.channels.length; i++) {
    out.push(g);
    if (breaks.has(i)) g++;
  }
  return out;
}

/** Electrodes a channel physically uses (references resolved; AVG → plus only). */
export function channelElectrodes(ch: MontageChannel): string[] {
  if (ch.minus === REF_AVG || ch.minus === REF_RECORDING) return [ch.plus];
  if (ch.minus === REF_EAR_IPSI) {
    const side = electrodeSide(ch.plus);
    if (side === 'left') return [ch.plus, 'A1'];
    if (side === 'right') return [ch.plus, 'A2'];
    return [ch.plus, 'A1', 'A2'];
  }
  return [ch.plus, ch.minus];
}

/** True when `electrode` is one of the channel's inputs (for "highlight channels with X"). */
export function channelInvolves(ch: MontageChannel, electrode: string): boolean {
  return channelElectrodes(ch).includes(electrode);
}

export interface DeriveOptions {
  /** Overrides `montage.excludeFromAverage`. */
  excludeFromAverage?: readonly string[];
}

/** Scalp electrodes that enter the common average for this recording. */
export function averagePool(
  rec: DecodedRecording,
  exclude: readonly string[] = [],
): string[] {
  if (rec.reference !== 'common') return [];
  const ex = new Set(exclude);
  return rec.signals.map((s) => s.label).filter((l) => isScalpElectrode(l) && !ex.has(l));
}

function meanOf(arrays: Float32Array[], n: number): Float32Array {
  const out = new Float32Array(n);
  if (arrays.length === 0) return out;
  const acc = new Float64Array(n);
  for (const a of arrays) for (let i = 0; i < n; i++) acc[i] += a[i];
  const k = 1 / arrays.length;
  for (let i = 0; i < n; i++) out[i] = acc[i] * k;
  return out;
}

function subtract(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
  return out;
}

function negate(a: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = -a[i];
  return out;
}

/**
 * Derive the channels of `montage` from a recording.
 *
 * - `common` recordings: any channel whose electrodes exist is computed as
 *   V(plus) − V(minus) (AVG = mean of {@link averagePool}; ear reference
 *   resolved per hemisphere).
 * - `bipolar` recordings: a channel is available only when the recording
 *   holds that exact derivation, or its inversion (returned negated).
 *
 * Missing channels are returned with `available: false` and zero data so the
 * renderer can show them greyed out ("n/a") in their usual place.
 */
export function deriveChannels(
  rec: DecodedRecording,
  montage: Montage,
  opts: DeriveOptions = {},
): DerivedChannel[] {
  const map = signalMap(rec);
  const n = rec.nSamples;
  const groups = channelGroups(montage);
  let zeros: Float32Array | null = null;
  const unavailable = (ch: MontageChannel, i: number): DerivedChannel => {
    if (!zeros) zeros = new Float32Array(n);
    return { ...ch, data: zeros, available: false, group: groups[i] };
  };

  if (rec.reference === 'bipolar') {
    return montage.channels.map((ch, i) => {
      const direct = map.get(`${ch.plus}-${ch.minus}`);
      if (direct) return { ...ch, data: direct, available: true, group: groups[i] };
      const inverse = map.get(`${ch.minus}-${ch.plus}`);
      if (inverse) return { ...ch, data: negate(inverse), available: true, group: groups[i] };
      return unavailable(ch, i);
    });
  }

  let avg: Float32Array | null | undefined;
  const getAvg = (): Float32Array | null => {
    if (avg === undefined) {
      const pool = averagePool(rec, opts.excludeFromAverage ?? montage.excludeFromAverage ?? []);
      avg = pool.length >= 2 ? meanOf(pool.map((l) => map.get(l)!), n) : null;
    }
    return avg;
  };
  let linkedEars: Float32Array | null | undefined;
  const getLinkedEars = (): Float32Array | null => {
    if (linkedEars === undefined) {
      const a1 = map.get('A1');
      const a2 = map.get('A2');
      linkedEars = a1 && a2 ? meanOf([a1, a2], n) : null;
    }
    return linkedEars;
  };

  return montage.channels.map((ch, i) => {
    const plus = map.get(ch.plus);
    if (!plus) return unavailable(ch, i);
    let ref: Float32Array | null | undefined;
    if (ch.minus === REF_RECORDING) {
      return { ...ch, data: plus, available: true, group: groups[i] };
    } else if (ch.minus === REF_AVG) {
      ref = getAvg();
    } else if (ch.minus === REF_EAR_IPSI) {
      const side = electrodeSide(ch.plus);
      ref = side === 'left' ? map.get('A1') : side === 'right' ? map.get('A2') : getLinkedEars();
    } else {
      ref = map.get(ch.minus);
    }
    if (!ref) return unavailable(ch, i);
    return { ...ch, data: subtract(plus, ref), available: true, group: groups[i] };
  });
}

/** How many of the montage's channels this recording can show. */
export function montageAvailability(
  rec: DecodedRecording,
  montage: Montage,
): { available: number; total: number } {
  const map = signalMap(rec);
  let available = 0;
  for (const ch of montage.channels) {
    if (rec.reference === 'bipolar') {
      if (map.has(`${ch.plus}-${ch.minus}`) || map.has(`${ch.minus}-${ch.plus}`)) available++;
      continue;
    }
    if (!map.has(ch.plus)) continue;
    if (ch.minus === REF_RECORDING) available++;
    else if (ch.minus === REF_AVG) {
      if (averagePool(rec, montage.excludeFromAverage).length >= 2) available++;
    } else if (ch.minus === REF_EAR_IPSI) {
      const side = electrodeSide(ch.plus);
      const ok =
        side === 'left' ? map.has('A1') : side === 'right' ? map.has('A2') : map.has('A1') && map.has('A2');
      if (ok) available++;
    } else if (map.has(ch.minus)) available++;
  }
  return { available, total: montage.channels.length };
}

/**
 * Montages that can show at least one channel of `rec`, in `ids` order
 * (default: all built-ins). For fixed-bipolar recordings the native montage
 * comes first.
 */
export function availableMontages(
  rec: DecodedRecording,
  ids: readonly string[] = MONTAGE_IDS,
): Montage[] {
  const out: Montage[] = [];
  if (rec.reference === 'bipolar') out.push(nativeMontage(rec));
  for (const id of ids) {
    const m = getMontage(id);
    if (m && montageAvailability(rec, m).available > 0) out.push(m);
  }
  return out;
}
