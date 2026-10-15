'use client';

// Shared "mark the fragment" state for eegFigureMark and eegCase `mark` steps.
//
//   const fm = useFigureMarks({ mode, targets, distractors, maxMarks, boxIoU, initial });
//   <FigureCanvas interaction={fm.checked ? 'pan' : mode} overlay={fm.overlay}
//                 onPoint={fm.addPoint} onBox={fm.addBox} … />
//   fm.check() → FigureScore; fm.reset() = "Try again"; fm.snapshot → widgetState.

import { useCallback, useMemo, useReducer } from 'react';

import type { FigureDistractor, FigureMarkShape, FigureScore, FigureTarget, NormPoint, NormRect } from '@/lib/eeg/scoring';

import {
  buildFigureOverlay,
  EMPTY_FIGURE_MARKS,
  figureMarksReducer,
  marksForStorage,
  scoreMarks,
  type FigureMark,
  type FigureMarksAction,
  type FigureMarksConfig,
  type FigureMarksState,
} from './figureMarks';
import type { FigureOverlayItem } from './figureMath';

export interface UseFigureMarksOptions {
  mode: 'point' | 'box';
  targets: readonly (FigureTarget & { label: string })[];
  distractors?: readonly FigureDistractor[];
  maxMarks?: number;
  /** Box mode IoU threshold (default 0.3). */
  boxIoU?: number;
  /** Show the expert key after Check (default true). */
  revealKey?: boolean;
  /** Restored state (e.g. from widgetState) — read on first render only. */
  initial?: { marks: FigureMarkShape[]; checked: boolean } | null;
  /** Default size of a box created by a tap in box mode. */
  defaultBox?: { w: number; h: number };
}

export interface FigureMarksFeedback {
  found: { id: string; label: string }[];
  missed: { id: string; label: string; required: boolean }[];
  /** Notes of distractor regions the learner fell into (deduplicated). */
  distractorNotes: string[];
  falseCount: number;
}

export interface UseFigureMarksResult {
  marks: FigureMark[];
  checked: boolean;
  /** Scoring result once checked, else null. */
  result: FigureScore | null;
  feedback: FigureMarksFeedback | null;
  overlay: FigureOverlayItem[];
  canAddMore: boolean;
  addPoint(p: NormPoint): void;
  addBox(rect: NormRect): void;
  removeMark(id: string): void;
  clearMarks(): void;
  /** Lock the marks and score them; returns the result. */
  check(): FigureScore;
  /** "Try again": clear marks and unlock. */
  reset(): void;
  /** Serializable state for widgetState. */
  snapshot: { marks: FigureMarkShape[]; checked: boolean };
}

export function useFigureMarks(opts: UseFigureMarksOptions): UseFigureMarksResult {
  const { mode, targets, distractors, maxMarks, boxIoU, revealKey, initial, defaultBox } = opts;
  const config: FigureMarksConfig = useMemo(() => ({ mode, maxMarks, defaultBox }), [mode, maxMarks, defaultBox]);

  // Inline reducer: React applies queued actions with the latest render's
  // reducer, so config changes (mode, maxMarks) are honoured.
  const [state, dispatch] = useReducer(
    (s: FigureMarksState, a: FigureMarksAction) => figureMarksReducer(s, a, config),
    undefined,
    () =>
      initial
        ? figureMarksReducer(EMPTY_FIGURE_MARKS, { type: 'restore', marks: initial.marks, checked: initial.checked }, config)
        : EMPTY_FIGURE_MARKS,
  );

  const scoring = useMemo(() => ({ mode, targets, distractors, boxIoU }), [mode, targets, distractors, boxIoU]);
  const result = useMemo(() => (state.checked ? scoreMarks(state.marks, scoring) : null), [state, scoring]);

  const overlay = useMemo(
    () => buildFigureOverlay(state, scoring, result, { revealKey }),
    [state, scoring, result, revealKey],
  );

  const feedback = useMemo<FigureMarksFeedback | null>(() => {
    if (!result) return null;
    return {
      found: targets.filter((_, j) => result.targets[j]?.hit).map((t) => ({ id: t.id, label: t.label })),
      missed: targets
        .filter((_, j) => !result.targets[j]?.hit)
        .map((t) => ({ id: t.id, label: t.label, required: t.required !== false })),
      distractorNotes: Array.from(new Set(result.distractorHits.map((d) => d.note))),
      falseCount: result.falseMarks.length,
    };
  }, [result, targets]);

  const addPoint = useCallback((p: NormPoint) => dispatch({ type: 'addPoint', p }), []);
  const addBox = useCallback((rect: NormRect) => dispatch({ type: 'addBox', rect }), []);
  const removeMark = useCallback((id: string) => dispatch({ type: 'remove', id }), []);
  const clearMarks = useCallback(() => dispatch({ type: 'clear' }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  const check = useCallback(() => {
    dispatch({ type: 'check' });
    return scoreMarks(state.marks, scoring);
  }, [state.marks, scoring]);

  const snapshot = useMemo(() => ({ marks: marksForStorage(state.marks), checked: state.checked }), [state]);

  return {
    marks: state.marks,
    checked: state.checked,
    result,
    feedback,
    overlay,
    canAddMore: !state.checked && (maxMarks === undefined || state.marks.length < maxMarks),
    addPoint,
    addBox,
    removeMark,
    clearMarks,
    check,
    reset,
    snapshot,
  };
}
