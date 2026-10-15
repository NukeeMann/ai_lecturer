// Shared Zod schemas for figure-based EEG widgets (eegFigureMark, eegCase,
// patternDrill, figureSequence).
//
// Node-safe: no React, no DOM. Widget `schema.ts` files import from THIS
// module (not from the `index.ts` barrel, which also exports components).

import { z } from 'zod';

export type { NormPoint, NormRect } from '@/lib/eeg/scoring';

/** Credit line for a figure or recording. `restricted` = private use only (never publish). */
export const AttributionSchema = z.object({
  /** e.g. "St. Louis EK, Frey LC (eds). Electroencephalography… AES 2016, Fig. 84" (markdown allowed). */
  text: z.string().min(1),
  /** e.g. "CC BY-NC-SA 4.0" or "© Springer 2021 — private use". */
  license: z.string().min(1),
  url: z.string().url().optional(),
  /** Copyrighted material kept for private study: shows a lock + "Private use only". */
  restricted: z.boolean().optional(),
});
export type Attribution = z.infer<typeof AttributionSchema>;

/** Normalised rectangle (0..1 of the image, origin top-left). */
export const NormRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().positive().max(1),
    h: z.number().positive().max(1),
  })
  .refine((r) => r.x + r.w <= 1 + 1e-6 && r.y + r.h <= 1 + 1e-6, {
    message: 'Rectangle must lie inside the image (x + w ≤ 1, y + h ≤ 1)',
  });

/** Normalised point (0..1 of the image, origin top-left). */
export const NormPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

/** A figure (image asset) with its mandatory attribution. */
export const FigureRefSchema = z.object({
  /** Full asset path, e.g. `/api/courses/<slug>/assets/figures/fig84.png` (never built at runtime). */
  src: z.string().min(1),
  /** Plain-text description (not markdown). */
  alt: z.string().min(1),
  /** Markdown caption under the figure. */
  caption: z.string().optional(),
  /** Natural size in px — lets the viewer reserve space before the image loads. */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  attribution: AttributionSchema,
});
export type FigureRef = z.infer<typeof FigureRefSchema>;

/** Expert answer-key region on a figure. */
export const FigureTargetSchema = z.object({
  id: z.string().min(1),
  rect: NormRectSchema,
  /** Short markdown label shown after Check, e.g. "Spike F8". */
  label: z.string().min(1),
  /** Default true. */
  required: z.boolean().optional(),
});
export type FigureTargetData = z.infer<typeof FigureTargetSchema>;

/** A common wrong click with specific feedback ("eye blink, not a spike"). */
export const FigureDistractorSchema = z.object({
  rect: NormRectSchema,
  note: z.string().min(1),
});
export type FigureDistractorData = z.infer<typeof FigureDistractorSchema>;

/**
 * Calibration of a figure in NATURAL image pixels — enables the caliper
 * (Δt from horizontal distance; ΔV from vertical distance; row names).
 */
export const FigureCalibrationSchema = z.object({
  /** Horizontal pixels per second of EEG (e.g. 30 mm/s paper scanned at …). */
  pxPerSecond: z.number().positive(),
  /** Microvolts per vertical pixel (optional). */
  uvPerPx: z.number().positive().optional(),
  /** Channel rows: label and baseline y (natural px), top to bottom. */
  rows: z.array(z.object({ label: z.string().min(1), yPx: z.number().nonnegative() })).optional(),
});
export type FigureCalibration = z.infer<typeof FigureCalibrationSchema>;

/** A learner mark on a figure (normalised), as persisted in widgetState. */
export const FigureMarkShapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('point'), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.object({
    kind: z.literal('box'),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  }),
]);

/** `useFigureMarks().snapshot` — validate restored widgetState with this. */
export const FigureMarksSnapshotSchema = z.object({
  marks: z.array(FigureMarkShapeSchema).max(200),
  checked: z.boolean(),
});
export type FigureMarksSnapshot = z.infer<typeof FigureMarksSnapshotSchema>;

/** Check that target ids are unique (use inside a widget schema's superRefine). */
export function uniqueIdIssues(items: readonly { id: string }[], path: (string | number)[]): z.IssueData[] {
  const seen = new Set<string>();
  const issues: z.IssueData[] = [];
  items.forEach((it, i) => {
    if (seen.has(it.id)) {
      issues.push({ code: z.ZodIssueCode.custom, path: [...path, i, 'id'], message: `Duplicate id "${it.id}"` });
    }
    seen.add(it.id);
  });
  return issues;
}
