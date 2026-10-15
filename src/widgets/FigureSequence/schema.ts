// figureSequence — step-through, slider (e.g. maturation by age) and
// side-by-side comparison of REAL figures (spec §3.6). Node-safe.

import { z } from 'zod';

import { FigureRefSchema, uniqueIdIssues } from '@/widgets/common/eeg/figure';

export const FigureSequenceFrameSchema = z.object({
  id: z.string().min(1),
  /** Short label, e.g. "6 mies.", "Montaż poprzeczny". */
  label: z.string().min(1),
  figure: FigureRefSchema,
  /** Markdown shown under the frame (falls back to figure.caption). */
  caption: z.string().optional(),
});

export const FigureSequenceDataSchema = z
  .object({
    prompt: z.string().optional(),
    layout: z.enum(['stepper', 'slider', 'compare']).default('stepper'),
    frames: z.array(FigureSequenceFrameSchema).min(2),
    /** Slider axis name, e.g. "Wiek". */
    sliderLabel: z.string().optional(),
    initialFrame: z.string().optional(),
    /** Frame ids shown first in `compare`. */
    compareDefaults: z.tuple([z.string(), z.string()]).optional(),
  })
  .superRefine((d, ctx) => {
    for (const issue of uniqueIdIssues(d.frames, ['frames'])) ctx.addIssue(issue);
    const ids = new Set(d.frames.map((f) => f.id));
    if (d.initialFrame && !ids.has(d.initialFrame)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['initialFrame'], message: `Unknown frame "${d.initialFrame}"` });
    d.compareDefaults?.forEach((id, i) => {
      if (!ids.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['compareDefaults', i], message: `Unknown frame "${id}"` });
    });
  });

export type FigureSequenceData = z.infer<typeof FigureSequenceDataSchema>;
export type FigureSequenceDataInput = z.input<typeof FigureSequenceDataSchema>;

export function figureSequenceAssetPaths(d: FigureSequenceData): string[] {
  return Array.from(new Set(d.frames.map((f) => f.figure.src)));
}

export const FigureSequenceStateSchema = z.object({
  v: z.literal(1),
  seen: z.array(z.string()).default([]),
});
export type FigureSequenceState = z.infer<typeof FigureSequenceStateSchema>;

export function initialIndex(d: FigureSequenceData): number {
  const i = d.initialFrame ? d.frames.findIndex((f) => f.id === d.initialFrame) : 0;
  return i < 0 ? 0 : i;
}

export function compareInitial(d: FigureSequenceData): [number, number] {
  if (d.compareDefaults) {
    const a = d.frames.findIndex((f) => f.id === d.compareDefaults![0]);
    const b = d.frames.findIndex((f) => f.id === d.compareDefaults![1]);
    if (a >= 0 && b >= 0) return [a, b];
  }
  return [0, 1];
}

/** Completion: every frame seen (stepper/slider) or any interaction (compare). */
export function isSequenceComplete(layout: FigureSequenceData['layout'], seen: readonly string[], total: number, interacted: boolean): boolean {
  return layout === 'compare' ? interacted : new Set(seen).size >= total;
}

/** Indices of slider ticks to label so labels never crowd (≤ maxLabels, first and last always). */
export function tickLabelIndices(n: number, maxLabels: number): number[] {
  if (n <= maxLabels) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (maxLabels - 1);
  return Array.from(new Set(Array.from({ length: maxLabels }, (_, k) => Math.round(k * step))));
}

export function describeSequenceState(i: { layout: string; current: string[]; seen: number; total: number }): string {
  return `Figure sequence (${i.layout}) of REAL EEG figures. Showing: ${i.current.join(' | ')}. Seen ${i.seen}/${i.total} frames.`.slice(0, 2000);
}
