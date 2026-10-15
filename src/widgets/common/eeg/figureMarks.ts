// Pure state machine + overlay builder for "mark the fragment" on a figure,
// shared by eegFigureMark and eegCase (via useFigureMarks). Node-safe.

import {
  clampRect,
  rectCenter,
  scoreFigureMarks,
  type FigureDistractor,
  type FigureMarkShape,
  type FigureScore,
  type FigureTarget,
  type NormPoint,
  type NormRect,
} from '@/lib/eeg/scoring';

import type { FigureOverlayItem, FigureOverlayTone } from './figureMath';

export type FigureMark = FigureMarkShape & { id: string };

export interface FigureMarksState {
  marks: FigureMark[];
  /** True after Check; marks are locked until reset. */
  checked: boolean;
  nextId: number;
}

export interface FigureMarksConfig {
  mode: 'point' | 'box';
  maxMarks?: number;
  /** Size of the box created by a tap in box mode (default 0.05 × 0.07). */
  defaultBox?: { w: number; h: number };
  /** Boxes smaller than this (normalised) are treated as taps (default 0.006). */
  minBoxSize?: number;
}

export type FigureMarksAction =
  | { type: 'addPoint'; p: NormPoint }
  | { type: 'addBox'; rect: NormRect }
  | { type: 'remove'; id: string }
  | { type: 'clear' }
  | { type: 'check' }
  | { type: 'reset' }
  | { type: 'restore'; marks: FigureMarkShape[]; checked: boolean };

export const EMPTY_FIGURE_MARKS: FigureMarksState = { marks: [], checked: false, nextId: 1 };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function boxAround(p: NormPoint, size: { w: number; h: number }): NormRect {
  return clampRect({ x: p.x - size.w / 2, y: p.y - size.h / 2, w: size.w, h: size.h });
}

/** Turn any input into the shape the mode expects (or null if degenerate). */
function toShape(input: { p?: NormPoint; rect?: NormRect }, cfg: FigureMarksConfig): FigureMarkShape | null {
  const min = cfg.minBoxSize ?? 0.006;
  if (cfg.mode === 'point') {
    const c = input.p ?? (input.rect ? rectCenter(input.rect) : null);
    return c ? { kind: 'point', x: clamp01(c.x), y: clamp01(c.y) } : null;
  }
  if (input.rect && input.rect.w >= min && input.rect.h >= min) return { kind: 'box', ...clampRect(input.rect) };
  const c = input.p ?? (input.rect ? rectCenter(input.rect) : null);
  return c ? { kind: 'box', ...boxAround(c, cfg.defaultBox ?? { w: 0.05, h: 0.07 }) } : null;
}

export function figureMarksReducer(
  state: FigureMarksState,
  action: FigureMarksAction,
  cfg: FigureMarksConfig,
): FigureMarksState {
  switch (action.type) {
    case 'addPoint':
    case 'addBox': {
      if (state.checked) return state;
      if (cfg.maxMarks !== undefined && state.marks.length >= cfg.maxMarks) return state;
      const shape = toShape(action.type === 'addPoint' ? { p: action.p } : { rect: action.rect }, cfg);
      if (!shape) return state;
      return { ...state, marks: [...state.marks, { ...shape, id: `m${state.nextId}` }], nextId: state.nextId + 1 };
    }
    case 'remove':
      if (state.checked) return state;
      return { ...state, marks: state.marks.filter((m) => m.id !== action.id) };
    case 'clear':
      if (state.checked) return state;
      return { ...state, marks: [] };
    case 'check':
      return { ...state, checked: true };
    case 'reset':
      return { ...state, marks: [], checked: false };
    case 'restore': {
      let next = 1;
      const marks: FigureMark[] = [];
      for (const m of action.marks) {
        const shape = toShape(m.kind === 'point' ? { p: m } : { rect: m }, cfg);
        if (shape) marks.push({ ...shape, id: `m${next++}` });
      }
      return { marks, checked: action.checked && marks.length > 0, nextId: next };
    }
  }
}

export interface FigureScoringInput {
  mode: 'point' | 'box';
  targets: readonly FigureTarget[];
  distractors?: readonly FigureDistractor[];
  boxIoU?: number;
}

export function scoreMarks(marks: readonly FigureMark[], input: FigureScoringInput): FigureScore {
  return scoreFigureMarks(marks, input.targets, {
    mode: input.mode,
    boxIoU: input.boxIoU,
    distractors: input.distractors,
  });
}

function markItem(m: FigureMark, tone: FigureOverlayTone, label?: string): FigureOverlayItem {
  return m.kind === 'point'
    ? { kind: 'point', id: m.id, x: m.x, y: m.y, tone, label }
    : { kind: 'rect', id: m.id, rect: { x: m.x, y: m.y, w: m.w, h: m.h }, tone, label };
}

/**
 * Overlay for FigureCanvas. Before checking: numbered learner marks. After:
 * marks as hit / false / distractor, and (when `revealKey`) the expert
 * targets as `key` (found) or `miss` (not found) with their labels.
 * Distractor regions are only drawn where the learner fell into them.
 */
export function buildFigureOverlay(
  state: Pick<FigureMarksState, 'marks' | 'checked'>,
  input: FigureScoringInput & { targets: readonly (FigureTarget & { label?: string })[] },
  result: FigureScore | null,
  opts: { revealKey?: boolean } = {},
): FigureOverlayItem[] {
  if (!state.checked || !result) return state.marks.map((m, i) => markItem(m, 'mark', String(i + 1)));
  const items: FigureOverlayItem[] = [];
  if (opts.revealKey !== false) {
    input.targets.forEach((t, j) => {
      const hit = result.targets[j]?.hit;
      items.push({ kind: 'rect', id: `target:${t.id}`, rect: t.rect, tone: hit ? 'key' : 'miss', label: t.label });
    });
  }
  const shown = new Set<number>();
  for (const d of result.distractorHits) {
    if (shown.has(d.distractorIndex) || !input.distractors) continue;
    shown.add(d.distractorIndex);
    const note = input.distractors[d.distractorIndex].note;
    items.push({
      kind: 'rect',
      id: `distractor:${d.distractorIndex}`,
      rect: input.distractors[d.distractorIndex].rect,
      tone: 'distractor',
      label: note.length > 48 ? `${note.slice(0, 47)}…` : note,
    });
  }
  state.marks.forEach((m, i) => {
    const r = result.marks[i];
    const tone: FigureOverlayTone = r?.reason === 'matched' ? 'hit' : r?.reason === 'distractor' ? 'distractor' : 'false';
    items.push(markItem(m, tone, String(i + 1)));
  });
  return items;
}

/** Plain marks (without ids) for persistence in widgetState. */
export function marksForStorage(marks: readonly FigureMark[]): FigureMarkShape[] {
  return marks.map((m) => {
    if (m.kind === 'point') return { kind: 'point', x: m.x, y: m.y };
    return { kind: 'box', x: m.x, y: m.y, w: m.w, h: m.h };
  });
}
