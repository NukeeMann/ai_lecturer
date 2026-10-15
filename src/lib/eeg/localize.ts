// Localisation analysis computed FROM THE DATA (never hard-coded per preset):
// phase reversals in bipolar chains, end-of-chain maxima and referential
// amplitude maxima. Used by montageLab's "Highlight phase reversal" and by
// tests that verify the synthetic presets.
//
// Pure TypeScript, Node-safe.
//
// Conventions: a channel value is V(plus) − V(minus). In a bipolar chain
// X-E, E-Y sharing electrode E:
//   • NEGATIVE phase reversal (E most negative): X-E > 0 and E-Y < 0. Drawn
//     negative-up, the upper channel deflects down and the lower one up —
//     the deflections "point towards each other".
//   • POSITIVE phase reversal (E most positive): X-E < 0 and E-Y > 0 — the
//     deflections point away from each other.

import type { DerivedChannel, Montage } from './montages';

/**
 * Chains of a montage: maximal runs of consecutive channels where each
 * channel's `minus` is the next channel's `plus` (e.g. Fp1-F7, F7-T7, T7-P7,
 * P7-O1). Referential channels never link, so they form 1-channel chains.
 */
export function findChains(montage: Montage): number[][] {
  const chains: number[][] = [];
  let current: number[] = [];
  montage.channels.forEach((ch, i) => {
    const prev = i > 0 ? montage.channels[i - 1] : null;
    if (current.length > 0 && prev && prev.minus === ch.plus) {
      current.push(i);
    } else {
      if (current.length > 0) chains.push(current);
      current = [i];
    }
  });
  if (current.length > 0) chains.push(current);
  return chains;
}

/** Channel values (µV) at one sample index; NaN for unavailable channels. */
export function valuesAt(channels: readonly DerivedChannel[], sampleIdx: number): number[] {
  return channels.map((ch) => {
    if (!ch.available) return NaN;
    const i = Math.max(0, Math.min(ch.data.length - 1, Math.round(sampleIdx)));
    return ch.data[i];
  });
}

/**
 * Sample index in [start, end) where the largest absolute deflection across
 * all available channels occurs (the instant a reader would look at).
 */
export function peakSampleIndex(
  channels: readonly DerivedChannel[],
  start: number,
  end: number,
): number {
  let best = Math.max(0, Math.floor(start));
  let bestV = -1;
  for (const ch of channels) {
    if (!ch.available) continue;
    const a = Math.max(0, Math.floor(start));
    const b = Math.min(ch.data.length, Math.ceil(end));
    for (let i = a; i < b; i++) {
      const v = Math.abs(ch.data[i]);
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
  }
  return best;
}

export interface PhaseReversal {
  kind: 'negative' | 'positive';
  /** Upper channel of the reversing pair (index into the montage). */
  upperIndex: number;
  /** Lower channel of the reversing pair. */
  lowerIndex: number;
  /**
   * Where the reversal localises: the shared electrode for adjacent
   * channels, or both electrodes of the isoelectric channel(s) between them
   * (in-phase cancellation: the maximum lies between those electrodes).
   */
  electrodes: string[];
  /** Indices of near-zero channels between the pair (empty for adjacent). */
  isoelectricIndices: number[];
  upperValue: number;
  lowerValue: number;
}

export interface ChainEndMaximum {
  /** Electrode at the end of the chain where the field is maximal. */
  electrode: string;
  end: 'start' | 'end';
  /** Sign of the potential at that electrode. */
  polarity: 'negative' | 'positive';
  channelIndex: number;
  value: number;
}

export interface ChainAnalysis {
  indices: number[];
  values: number[];
  reversals: PhaseReversal[];
  /** Set when the chain shows no reversal and peaks at its first/last channel. */
  endMaximum: ChainEndMaximum | null;
}

export interface LocalizeOptions {
  /**
   * Minimum |value| relative to the largest |value| at that instant for a
   * channel to count as deflected (default 0.25; smaller ones are treated
   * as isoelectric).
   */
  minRelative?: number;
  /** Absolute minimum |value| in µV (default 10 — above background noise). */
  minAbsUv?: number;
}

function threshold(values: number[], opts: LocalizeOptions): number {
  let maxAbs = 0;
  for (const v of values) if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
  return Math.max(opts.minAbsUv ?? 10, (opts.minRelative ?? 0.25) * maxAbs);
}

/**
 * Analyse every chain of a bipolar montage at one instant: phase reversals
 * (adjacent, or across isoelectric channels) and end-of-chain maxima.
 */
export function analyzeChains(
  montage: Montage,
  channels: readonly DerivedChannel[],
  sampleIdx: number,
  opts: LocalizeOptions = {},
): ChainAnalysis[] {
  const all = valuesAt(channels, sampleIdx);
  const thr = threshold(all, opts);
  return findChains(montage).map((indices) => {
    const values = indices.map((i) => all[i]);
    const reversals: PhaseReversal[] = [];
    if (indices.length >= 2) {
      // Walk significant channels; a sign change between consecutive
      // significant channels is a reversal.
      let prevK = -1;
      for (let k = 0; k < indices.length; k++) {
        const v = values[k];
        if (!Number.isFinite(v)) {
          prevK = -1; // a missing channel breaks the chain
          continue;
        }
        if (Math.abs(v) < thr) continue;
        if (prevK >= 0 && Math.sign(values[prevK]) !== Math.sign(v)) {
          const between = indices.slice(prevK + 1, k);
          const upper = montage.channels[indices[prevK]];
          const electrodes =
            between.length === 0
              ? [upper.minus]
              : Array.from(new Set(between.flatMap((i) => [montage.channels[i].plus, montage.channels[i].minus])));
          reversals.push({
            kind: values[prevK] > 0 ? 'negative' : 'positive',
            upperIndex: indices[prevK],
            lowerIndex: indices[k],
            electrodes,
            isoelectricIndices: between,
            upperValue: values[prevK],
            lowerValue: v,
          });
        }
        prevK = k;
      }
    }
    let endMaximum: ChainEndMaximum | null = null;
    if (reversals.length === 0) {
      let bestK = -1;
      let bestAbs = 0;
      values.forEach((v, k) => {
        if (Number.isFinite(v) && Math.abs(v) > bestAbs) {
          bestAbs = Math.abs(v);
          bestK = k;
        }
      });
      const last = indices.length - 1;
      if (bestK >= 0 && bestAbs >= thr && (bestK === 0 || bestK === last) && indices.length >= 2) {
        const ch = montage.channels[indices[bestK]];
        const v = values[bestK];
        const atStart = bestK === 0;
        endMaximum = {
          electrode: atStart ? ch.plus : ch.minus,
          end: atStart ? 'start' : 'end',
          // Start: V(plus) dominates → sign of v. End: V(minus) dominates → −sign.
          polarity: (atStart ? v < 0 : v > 0) ? 'negative' : 'positive',
          channelIndex: indices[bestK],
          value: v,
        };
      }
    }
    return { indices, values, reversals, endMaximum };
  });
}

/** All phase reversals of a bipolar montage at one instant (see {@link analyzeChains}). */
export function detectPhaseReversals(
  montage: Montage,
  channels: readonly DerivedChannel[],
  sampleIdx: number,
  opts: LocalizeOptions = {},
): PhaseReversal[] {
  return analyzeChains(montage, channels, sampleIdx, opts).flatMap((c) => c.reversals);
}

/**
 * Referential localisation: the available channel with the largest |value|
 * at `sampleIdx` (with its sign), or null when nothing is available.
 */
export function maxAmplitudeChannel(
  channels: readonly DerivedChannel[],
  sampleIdx: number,
): { index: number; value: number } | null {
  const vals = valuesAt(channels, sampleIdx);
  let best: { index: number; value: number } | null = null;
  vals.forEach((v, i) => {
    if (Number.isFinite(v) && (!best || Math.abs(v) > Math.abs(best.value))) best = { index: i, value: v };
  });
  return best;
}
