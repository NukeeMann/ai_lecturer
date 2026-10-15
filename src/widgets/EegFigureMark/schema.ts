// eegFigureMark — "mark the fragment" on a REAL EEG figure (spec §3.3).
// Node-safe: schema + pure helpers.

import { z } from 'zod';

import {
  FigureCalibrationSchema,
  FigureDistractorSchema,
  FigureMarksSnapshotSchema,
  FigureRefSchema,
  FigureTargetSchema,
  uniqueIdIssues,
} from '@/widgets/common/eeg/figure';

export const EegFigureMarkDataSchema = z
  .object({
    /** Markdown task, e.g. "Zaznacz wszystkie iglice". */
    prompt: z.string().min(1),
    figure: FigureRefSchema,
    mode: z.enum(['point', 'box']).default('point'),
    /** Expert answer key (normalised 0..1 of the image). */
    targets: z.array(FigureTargetSchema).min(1),
    /** Common wrong clicks with specific feedback. */
    distractors: z.array(FigureDistractorSchema).optional(),
    maxMarks: z.number().int().positive().optional(),
    /** Box mode: minimum IoU with a target (default 0.3; a box whose centre lies in the target also counts). */
    boxIoU: z.number().min(0.05).max(1).optional(),
    /** Natural-pixel calibration — enables the caliper (Δt, Hz, µV, row name). */
    calibration: FigureCalibrationSchema.optional(),
    /** Markdown shown after Check. */
    explanation: z.string().min(1),
    /** Show the expert overlay after Check (default true). */
    revealKey: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    for (const issue of uniqueIdIssues(d.targets, ['targets'])) ctx.addIssue(issue);
  });

export type EegFigureMarkData = z.infer<typeof EegFigureMarkDataSchema>;
export type EegFigureMarkDataInput = z.input<typeof EegFigureMarkDataSchema>;

export function eegFigureMarkAssetPaths(d: EegFigureMarkData): string[] {
  return [d.figure.src];
}

export const EegFigureMarkStateSchema = FigureMarksSnapshotSchema.extend({ v: z.literal(1) });
export type EegFigureMarkState = z.infer<typeof EegFigureMarkStateSchema>;

/** Tutor live state (≤ 2000 chars); never names the key before Check. */
export function describeFigureMarkState(i: {
  prompt: string;
  figureAlt: string;
  attribution: string;
  marks: number;
  checked: boolean;
  feedback?: { found: string[]; missed: string[]; falseCount: number; distractorNotes: string[] } | null;
  caliper?: string | null;
}): string {
  const lines = [
    `Mark-the-fragment exercise on a REAL EEG figure: ${i.figureAlt} (${i.attribution}).`,
    `Task: ${i.prompt}`,
    `Learner has placed ${i.marks} mark${i.marks === 1 ? '' : 's'}.`,
  ];
  if (i.caliper) lines.push(`Caliper: ${i.caliper}.`);
  if (i.checked && i.feedback) {
    lines.push(`Checked — found: ${i.feedback.found.join('; ') || 'none'}; missed: ${i.feedback.missed.join('; ') || 'none'}; false marks: ${i.feedback.falseCount}.`);
    if (i.feedback.distractorNotes.length) lines.push(`Fell for: ${i.feedback.distractorNotes.join(' | ')}`);
  } else {
    lines.push('Not checked yet — do not reveal where the targets are.');
  }
  const text = lines.join('\n');
  return text.length > 2000 ? `${text.slice(0, 1997)}…` : text;
}
