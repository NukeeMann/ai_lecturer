// Scoring of learner marks against expert answer keys.
//
//   • Time marks on an EEG trace (eegViewer): points or ranges in seconds,
//     optionally tied to a channel.
//   • Figure marks on an image (eegFigureMark / eegCase): points or boxes in
//     normalised image coordinates (0..1, origin top-left).
//
// Both use GREEDY ONE-TO-ONE matching: all eligible (mark, target) pairs are
// sorted best-first and accepted when neither side is taken yet, so two marks
// on one target give one hit + one false mark ("duplicate"), and a mark in
// two overlapping targets satisfies only the closer one.
//
// Pure TypeScript, Node-safe.

import { normalizeElectrode } from './electrodes';

// ---------------------------------------------------------------------------
// Time marks
// ---------------------------------------------------------------------------

export interface TimeTarget {
  id: string;
  onsetSec: number;
  /** End of the target interval; omitted = point event at `onsetSec`. */
  offsetSec?: number;
  /** Electrodes ("T7") or channel labels ("F7-T7") where the event is seen. */
  channels?: string[];
  label?: string;
  /** Default true. Optional targets count for precision but not for `allRequiredHit`. */
  required?: boolean;
}

export interface PointTimeMark {
  t: number;
  channel?: string | null;
}

export interface RangeTimeMark {
  t0: number;
  t1: number;
  channel?: string | null;
}

export type TimeMark = PointTimeMark | RangeTimeMark;

export interface ScoreTimeMarksOptions {
  /** When true, a mark only counts on one of the target's channels (if the target lists any). */
  requireChannel?: boolean;
  /** Custom channel matcher (default {@link channelMatchesTarget}). */
  channelMatches?: (markChannel: string, targetChannels: readonly string[]) => boolean;
}

export type MarkReason = 'matched' | 'duplicate' | 'wrongChannel' | 'distractor' | 'noTarget';

export interface TargetOutcome {
  id: string;
  hit: boolean;
  required: boolean;
  /** Index of the matched mark, or null. */
  markIndex: number | null;
}

export interface TimeTargetOutcome extends TargetOutcome {
  /** Time gap between the matched mark and the target (s), 0 when overlapping. */
  distanceSec: number | null;
}

export interface MarkOutcome {
  index: number;
  targetId: string | null;
  /**
   * `duplicate`: on a target another mark already claimed; `wrongChannel`:
   * right time, wrong channel; `distractor`: in a known confusable region
   * (figures); `noTarget`: nothing there.
   */
  reason: MarkReason;
}

interface ScoreSummary {
  /** Indices of marks that matched no target. */
  falseMarks: number[];
  hits: number;
  misses: number;
  /** hits / marks (1 when there are neither marks nor targets, 0 when only targets). */
  precision: number;
  /** hits / targets (1 when there are no targets). */
  recall: number;
  /** Every target with `required !== false` was hit. */
  allRequiredHit: boolean;
}

export interface TimeScore extends ScoreSummary {
  targets: TimeTargetOutcome[];
  marks: MarkOutcome[];
}

function isRange(m: TimeMark): m is RangeTimeMark {
  return typeof (m as RangeTimeMark).t0 === 'number' && typeof (m as RangeTimeMark).t1 === 'number';
}

const REFERENCE_TOKENS = new Set(['avg', 'ave', 'ref', 'a1a2', 'a1a2_ipsi', 'car']);

/** Electrodes named by a label: "F7-T7" → [F7, T7]; "T7-AVG" → [T7]; "T3" → [T7]. */
export function electrodesOfLabel(label: string): string[] {
  const out: string[] = [];
  for (const part of label.split('-')) {
    const token = part.trim();
    if (!token || REFERENCE_TOKENS.has(token.toLowerCase())) continue;
    const e = normalizeElectrode(token);
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

/**
 * Default channel matcher: exact label match (case-insensitive), or the mark's
 * channel shares an electrode with the target's channels/electrodes
 * (a mark on "F7-T7" satisfies a target on ["T7"]).
 */
export function channelMatchesTarget(markChannel: string, targetChannels: readonly string[]): boolean {
  const m = markChannel.trim().toLowerCase();
  if (targetChannels.some((t) => t.trim().toLowerCase() === m)) return true;
  const markEls = electrodesOfLabel(markChannel);
  if (markEls.length === 0) return false;
  const targetEls = new Set(targetChannels.flatMap(electrodesOfLabel));
  return markEls.some((e) => targetEls.has(e));
}

function summarize(hits: number, nMarks: number, targets: { hit: boolean; required: boolean }[]): Omit<ScoreSummary, 'falseMarks'> {
  return {
    hits,
    misses: targets.length - hits,
    precision: nMarks > 0 ? hits / nMarks : targets.length === 0 ? 1 : 0,
    recall: targets.length > 0 ? hits / targets.length : 1,
    allRequiredHit: targets.every((t) => t.hit || !t.required),
  };
}

interface Candidate {
  mark: number;
  target: number;
  primary: number;
  secondary: number;
}

function greedy(cands: Candidate[], nMarks: number, nTargets: number): { markToTarget: number[]; targetToMark: number[] } {
  cands.sort(
    (a, b) => a.primary - b.primary || a.secondary - b.secondary || a.target - b.target || a.mark - b.mark,
  );
  const markToTarget = new Array<number>(nMarks).fill(-1);
  const targetToMark = new Array<number>(nTargets).fill(-1);
  for (const c of cands) {
    if (markToTarget[c.mark] >= 0 || targetToMark[c.target] >= 0) continue;
    markToTarget[c.mark] = c.target;
    targetToMark[c.target] = c.mark;
  }
  return { markToTarget, targetToMark };
}

/**
 * Score time marks against targets.
 *
 * - Point mark vs point target: hit when |t − onset| ≤ tolerance.
 * - Point mark vs interval target: hit when t ∈ [onset − tol, offset + tol].
 * - Range mark: hit when [t0, t1] overlaps the target interval widened by ± tol.
 * Ties are broken by the gap, then by the distance between centres.
 */
export function scoreTimeMarks(
  marks: readonly TimeMark[],
  targets: readonly TimeTarget[],
  toleranceSec = 0.5,
  opts: ScoreTimeMarksOptions = {},
): TimeScore {
  const tol = Math.max(0, toleranceSec);
  const matches = opts.channelMatches ?? channelMatchesTarget;
  const cands: Candidate[] = [];
  const timeOk: boolean[][] = marks.map(() => targets.map(() => false));
  const chanOk: boolean[][] = marks.map(() => targets.map(() => true));

  marks.forEach((m, i) => {
    const [a, b] = isRange(m) ? [Math.min(m.t0, m.t1), Math.max(m.t0, m.t1)] : [m.t, m.t];
    const centre = (a + b) / 2;
    targets.forEach((tg, j) => {
      const on = Math.min(tg.onsetSec, tg.offsetSec ?? tg.onsetSec);
      const off = Math.max(tg.onsetSec, tg.offsetSec ?? tg.onsetSec);
      const gap = Math.max(0, on - b, a - off);
      if (gap > tol + 1e-9) return;
      timeOk[i][j] = true;
      if (opts.requireChannel && tg.channels && tg.channels.length > 0) {
        const ok = !!m.channel && matches(m.channel, tg.channels);
        chanOk[i][j] = ok;
        if (!ok) return;
      }
      cands.push({ mark: i, target: j, primary: gap, secondary: Math.abs(centre - (on + off) / 2) });
    });
  });

  const { markToTarget, targetToMark } = greedy(cands, marks.length, targets.length);

  const targetOutcomes: TimeTargetOutcome[] = targets.map((tg, j) => {
    const mi = targetToMark[j];
    const cand = mi >= 0 ? cands.find((c) => c.mark === mi && c.target === j) : undefined;
    return {
      id: tg.id,
      hit: mi >= 0,
      required: tg.required !== false,
      markIndex: mi >= 0 ? mi : null,
      distanceSec: cand ? cand.primary : null,
    };
  });

  const markOutcomes: MarkOutcome[] = marks.map((_, i) => {
    const j = markToTarget[i];
    if (j >= 0) return { index: i, targetId: targets[j].id, reason: 'matched' };
    const dup = targets.some((_, k) => timeOk[i][k] && chanOk[i][k]);
    const wrongChannel = targets.some((_, k) => timeOk[i][k] && !chanOk[i][k]);
    return { index: i, targetId: null, reason: dup ? 'duplicate' : wrongChannel ? 'wrongChannel' : 'noTarget' };
  });

  const hits = targetOutcomes.filter((t) => t.hit).length;
  return {
    targets: targetOutcomes,
    marks: markOutcomes,
    falseMarks: markOutcomes.filter((m) => m.targetId === null).map((m) => m.index),
    ...summarize(hits, marks.length, targetOutcomes),
  };
}

// ---------------------------------------------------------------------------
// Figure marks (normalised image coordinates)
// ---------------------------------------------------------------------------

export interface NormPoint {
  x: number;
  y: number;
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FigureMarkShape =
  | ({ kind: 'point' } & NormPoint)
  | ({ kind: 'box' } & NormRect);

export interface FigureTarget {
  id: string;
  rect: NormRect;
  label?: string;
  /** Default true. */
  required?: boolean;
}

export interface FigureDistractor {
  rect: NormRect;
  note: string;
}

export interface ScoreFigureMarksOptions {
  mode: 'point' | 'box';
  /** Minimum IoU for a box to hit a target (default 0.3). */
  boxIoU?: number;
  /** Box mode: a box whose centre lies inside the target also hits (default true). */
  centerInRect?: boolean;
  /** Point mode: grow targets by this normalised margin (default 0). */
  pointTolerance?: number;
  distractors?: readonly FigureDistractor[];
}

export interface DistractorHit {
  markIndex: number;
  distractorIndex: number;
  note: string;
}

export interface FigureScore extends ScoreSummary {
  targets: TargetOutcome[];
  marks: (MarkOutcome & { distractorIndex: number | null })[];
  distractorHits: DistractorHit[];
}

export function rectCenter(r: NormRect): NormPoint {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function pointInRect(p: NormPoint, r: NormRect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

/** Intersection-over-union of two rectangles (0 when either is empty). */
export function rectIoU(a: NormRect, b: NormRect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Rectangle spanned by two drag corners (any order), clamped to [0, 1]. */
export function rectFromPoints(a: NormPoint, b: NormPoint): NormRect {
  const x0 = clamp01(Math.min(a.x, b.x));
  const y0 = clamp01(Math.min(a.y, b.y));
  const x1 = clamp01(Math.max(a.x, b.x));
  const y1 = clamp01(Math.max(a.y, b.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Clamp a rectangle into the unit square (keeps its size where possible). */
export function clampRect(r: NormRect): NormRect {
  const w = Math.min(1, Math.max(0, r.w));
  const h = Math.min(1, Math.max(0, r.h));
  return { x: Math.min(1 - w, Math.max(0, r.x)), y: Math.min(1 - h, Math.max(0, r.y)), w, h };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function dist(a: NormPoint, b: NormPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function markCenter(m: FigureMarkShape): NormPoint {
  return m.kind === 'point' ? { x: m.x, y: m.y } : rectCenter(m);
}

/** Does a mark land in a region (point-in-rect / box IoU or centre-in-rect)? Returns a quality key or null. */
function regionMatch(
  m: FigureMarkShape,
  r: NormRect,
  mode: 'point' | 'box',
  opts: ScoreFigureMarksOptions,
): { primary: number; secondary: number } | null {
  const c = markCenter(m);
  const d = dist(c, rectCenter(r));
  if (mode === 'point' || m.kind === 'point') {
    return pointInRect(c, r, opts.pointTolerance ?? 0) ? { primary: d, secondary: 0 } : null;
  }
  const iou = rectIoU(m, r);
  const okIoU = iou >= (opts.boxIoU ?? 0.3);
  const okCentre = (opts.centerInRect ?? true) && pointInRect(c, r);
  if (!okIoU && !okCentre) return null;
  return { primary: -iou, secondary: d };
}

/**
 * Score figure marks against expert target regions. In point mode, box marks
 * are reduced to their centre; in box mode a point mark can only hit via
 * centre-in-rect. Unmatched marks that land in a distractor region are
 * reported in `distractorHits` (they are still false marks).
 */
export function scoreFigureMarks(
  marks: readonly FigureMarkShape[],
  targets: readonly FigureTarget[],
  opts: ScoreFigureMarksOptions,
): FigureScore {
  const cands: Candidate[] = [];
  const eligible: boolean[][] = marks.map(() => targets.map(() => false));
  marks.forEach((m, i) => {
    targets.forEach((t, j) => {
      const q = regionMatch(m, t.rect, opts.mode, opts);
      if (!q) return;
      eligible[i][j] = true;
      cands.push({ mark: i, target: j, ...q });
    });
  });
  const { markToTarget, targetToMark } = greedy(cands, marks.length, targets.length);

  const distractors = opts.distractors ?? [];
  const distractorHits: DistractorHit[] = [];
  const markOutcomes = marks.map((m, i) => {
    const j = markToTarget[i];
    if (j >= 0) return { index: i, targetId: targets[j].id, reason: 'matched' as MarkReason, distractorIndex: null };
    if (eligible[i].some(Boolean)) return { index: i, targetId: null, reason: 'duplicate' as MarkReason, distractorIndex: null };
    let best = -1;
    let bestQ = Infinity;
    distractors.forEach((dstr, k) => {
      const q = regionMatch(m, dstr.rect, opts.mode, opts);
      if (q && q.primary < bestQ) {
        bestQ = q.primary;
        best = k;
      }
    });
    if (best >= 0) {
      distractorHits.push({ markIndex: i, distractorIndex: best, note: distractors[best].note });
      return { index: i, targetId: null, reason: 'distractor' as MarkReason, distractorIndex: best };
    }
    return { index: i, targetId: null, reason: 'noTarget' as MarkReason, distractorIndex: null };
  });

  const targetOutcomes: TargetOutcome[] = targets.map((t, j) => ({
    id: t.id,
    hit: targetToMark[j] >= 0,
    required: t.required !== false,
    markIndex: targetToMark[j] >= 0 ? targetToMark[j] : null,
  }));
  const hits = targetOutcomes.filter((t) => t.hit).length;
  return {
    targets: targetOutcomes,
    marks: markOutcomes,
    distractorHits,
    falseMarks: markOutcomes.filter((m) => m.targetId === null).map((m) => m.index),
    ...summarize(hits, marks.length, targetOutcomes),
  };
}
