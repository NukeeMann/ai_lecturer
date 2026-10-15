// Pure, seeded session logic of the pattern-recognition drill (perceptual
// learning): interleaved order, re-queue of missed cards a few cards later,
// first-attempt accuracy, confusion counts and response times. Node-safe.
//
// Evidence base (lit-overread report): interleaving look-alike patterns and
// immediate feedback improve visual diagnosis (ECG / radiology / IED rating
// studies) — so categories are interleaved, never blocked.

import { mulberry32 } from '@/lib/eeg';

export interface DrillItemRef {
  id: string;
  /** Category id of the correct answer. */
  answer: string;
}

export interface DrillAnswer {
  itemId: string;
  choice: string;
  correct: boolean;
  rtMs: number;
  /** True on the first attempt at this card in this session. */
  firstAttempt: boolean;
}

export interface DrillSession {
  /** Card ids still to show, in order (index 0 = current). */
  queue: string[];
  history: DrillAnswer[];
  /** Ids already answered correctly in this session. */
  correctIds: string[];
  /** Ids re-queued after a miss and not yet answered correctly. */
  pendingRequeue: string[];
  /** Number of distinct cards in the session. */
  total: number;
  seed: number;
}

/** Stable 32-bit hash of a string (FNV-1a). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded Fisher–Yates. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rnd = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Reorder so that no category appears more than `maxRun` times in a row,
 * when possible (greedy: pick the next card whose category differs from the
 * current run; fall back to the next card when none does).
 */
export function interleave<T extends DrillItemRef>(items: readonly T[], maxRun = 2): T[] {
  const rest = items.slice();
  const out: T[] = [];
  while (rest.length > 0) {
    const n = out.length;
    const runCat = n > 0 ? out[n - 1].answer : null;
    let run = 0;
    for (let k = n - 1; k >= 0 && out[k].answer === runCat; k--) run++;
    let idx = 0;
    if (run >= maxRun) {
      const alt = rest.findIndex((it) => it.answer !== runCat);
      if (alt >= 0) idx = alt;
    }
    out.push(rest.splice(idx, 1)[0]);
  }
  return out;
}

export interface StartOptions {
  seed: number;
  /** Cards to draw (default all). */
  length?: number;
  interleave?: boolean;
  /** Restrict to these ids (e.g. "Retry missed"). */
  onlyIds?: readonly string[];
}

export function startSession(items: readonly DrillItemRef[], opts: StartOptions): DrillSession {
  const pool = opts.onlyIds ? items.filter((it) => opts.onlyIds!.includes(it.id)) : items.slice();
  let order = seededShuffle(pool, opts.seed);
  if (opts.length !== undefined) order = order.slice(0, Math.max(1, Math.min(order.length, opts.length)));
  if (opts.interleave !== false) order = interleave(order);
  return { queue: order.map((it) => it.id), history: [], correctIds: [], pendingRequeue: [], total: order.length, seed: opts.seed };
}

export const REQUEUE_MIN_GAP = 3;
export const REQUEUE_MAX_GAP = 5;

/**
 * Record an answer to the CURRENT card (queue[0]) and advance. A missed card
 * is re-inserted 3–5 positions later (seeded), until answered correctly.
 */
export function answerCurrent(
  s: DrillSession,
  items: readonly DrillItemRef[],
  choice: string,
  rtMs: number,
  requeueMissed = true,
): DrillSession {
  const id = s.queue[0];
  if (id === undefined) return s;
  const item = items.find((it) => it.id === id);
  if (!item) return { ...s, queue: s.queue.slice(1) };
  const correct = item.answer === choice;
  const firstAttempt = !s.history.some((h) => h.itemId === id);
  const history = [...s.history, { itemId: id, choice, correct, rtMs: Math.max(0, Math.round(rtMs)), firstAttempt }];
  let queue = s.queue.slice(1);
  let pendingRequeue = s.pendingRequeue.filter((p) => p !== id);
  const correctIds = correct && !s.correctIds.includes(id) ? [...s.correctIds, id] : s.correctIds;
  if (!correct && requeueMissed) {
    const rnd = mulberry32((s.seed ^ (history.length * 0x9e3779b1)) >>> 0);
    const gap = REQUEUE_MIN_GAP + Math.floor(rnd() * (REQUEUE_MAX_GAP - REQUEUE_MIN_GAP + 1));
    const at = Math.min(queue.length, gap - 1);
    queue = [...queue.slice(0, at), id, ...queue.slice(at)];
    pendingRequeue = [...pendingRequeue, id];
  }
  return { ...s, queue, history, correctIds, pendingRequeue };
}

export function isFinished(s: DrillSession): boolean {
  return s.queue.length === 0;
}

export interface DrillSummary {
  /** Cards answered correctly on the first attempt / distinct cards. */
  firstAttemptCorrect: number;
  total: number;
  accuracy: number;
  /** Ids missed on the first attempt. */
  missedIds: string[];
  /** confusion[expected][chosen] counts over first attempts. */
  confusion: Record<string, Record<string, number>>;
  perCategory: Record<string, { correct: number; total: number }>;
  medianRtMs: number | null;
}

export function summarize(s: DrillSession, items: readonly DrillItemRef[]): DrillSummary {
  const first = s.history.filter((h) => h.firstAttempt);
  const confusion: DrillSummary['confusion'] = {};
  const perCategory: DrillSummary['perCategory'] = {};
  const missedIds: string[] = [];
  for (const h of first) {
    const expected = items.find((it) => it.id === h.itemId)?.answer ?? '?';
    (confusion[expected] ??= {})[h.choice] = (confusion[expected][h.choice] ?? 0) + 1;
    const pc = (perCategory[expected] ??= { correct: 0, total: 0 });
    pc.total++;
    if (h.correct) pc.correct++;
    else missedIds.push(h.itemId);
  }
  const rts = s.history.map((h) => h.rtMs).sort((a, b) => a - b);
  const medianRtMs = rts.length === 0 ? null : rts.length % 2 ? rts[(rts.length - 1) / 2] : Math.round((rts[rts.length / 2 - 1] + rts[rts.length / 2]) / 2);
  const firstAttemptCorrect = first.filter((h) => h.correct).length;
  return {
    firstAttemptCorrect,
    total: s.total,
    accuracy: s.total > 0 ? firstAttemptCorrect / s.total : 0,
    missedIds,
    confusion,
    perCategory,
    medianRtMs,
  };
}

/** Most frequent confusions (expected → chosen), most common first. */
export function topConfusions(summary: DrillSummary, limit = 3): { expected: string; chosen: string; count: number }[] {
  const out: { expected: string; chosen: string; count: number }[] = [];
  for (const [expected, row] of Object.entries(summary.confusion)) {
    for (const [chosen, count] of Object.entries(row)) if (chosen !== expected) out.push({ expected, chosen, count });
  }
  return out.sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected)).slice(0, limit);
}
