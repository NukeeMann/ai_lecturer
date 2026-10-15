// eegCase — staged case: vignette → systematic reading → expert report
// (spec §3.5). Node-safe: schema + pure grading helpers.

import { z } from 'zod';

import {
  FigureCalibrationSchema,
  FigureDistractorSchema,
  FigureMarksSnapshotSchema,
  FigureRefSchema,
  FigureTargetSchema,
  uniqueIdIssues,
} from '@/widgets/common/eeg/figure';
import { EegViewerInitialSchema, EegViewerSourceSchema } from '@/widgets/EegViewer/schema';

const ChoiceStepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['choice', 'multi']),
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(8),
  /** Indices into `options`. */
  correct: z.array(z.number().int().nonnegative()).min(1),
  explanation: z.string().min(1),
});

const MarkStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('mark'),
  prompt: z.string().min(1),
  mode: z.enum(['point', 'box']).default('point'),
  targets: z.array(FigureTargetSchema).min(1),
  distractors: z.array(FigureDistractorSchema).optional(),
  explanation: z.string().min(1),
});

export const MEASURE_UNITS = { frequencyHz: 'Hz', durationMs: 'ms', amplitudeUv: 'µV' } as const;

const MeasureStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('measure'),
  prompt: z.string().min(1),
  quantity: z.enum(['frequencyHz', 'durationMs', 'amplitudeUv']),
  expected: z.number(),
  /** Accepted absolute deviation (same unit). */
  tolerance: z.number().positive(),
  explanation: z.string().min(1),
});

const RevealStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('reveal'),
  /** "Think first" question. */
  prompt: z.string().min(1),
  /** Expert description revealed on demand (markdown). */
  content: z.string().min(1),
});

export const EegCaseStepSchema = z.discriminatedUnion('kind', [ChoiceStepSchema, MarkStepSchema, MeasureStepSchema, RevealStepSchema]);
export type EegCaseStep = z.infer<typeof EegCaseStepSchema>;

export const EegCaseDataSchema = z
  .object({
    /** Markdown clinical vignette. */
    vignette: z.string().min(1),
    /** The EEG of the case (real figure). */
    figure: FigureRefSchema.optional(),
    /** Alternative: an interactive recording / simulation shown in the EEG viewer. */
    viewer: z
      .object({
        source: EegViewerSourceSchema,
        initial: EegViewerInitialSchema.optional(),
      })
      .optional(),
    steps: z.array(EegCaseStepSchema).min(1),
    /** Caliper calibration of `figure` (natural px). */
    calibration: FigureCalibrationSchema.optional(),
    /** Expert report / take-home message (markdown), shown at the end. */
    summary: z.string().min(1),
  })
  .superRefine((d, ctx) => {
    for (const issue of uniqueIdIssues(d.steps, ['steps'])) ctx.addIssue(issue);
    if (d.figure && d.viewer) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['viewer'], message: 'Use either `figure` or `viewer`, not both' });
    d.steps.forEach((s, i) => {
      if (s.kind === 'choice' || s.kind === 'multi') {
        s.correct.forEach((c, j) => {
          if (c >= s.options.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps', i, 'correct', j], message: 'Index out of range' });
        });
        if (new Set(s.correct).size !== s.correct.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps', i, 'correct'], message: 'Duplicate indices' });
        if (s.kind === 'choice' && s.correct.length !== 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps', i, 'correct'], message: 'A single-choice step needs exactly one correct option' });
        }
      }
      if (s.kind === 'mark') {
        if (!d.figure) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps', i], message: 'A mark step needs the case `figure`' });
        for (const issue of uniqueIdIssues(s.targets, ['steps', i, 'targets'])) ctx.addIssue(issue);
      }
    });
  });

export type EegCaseData = z.infer<typeof EegCaseDataSchema>;
export type EegCaseDataInput = z.input<typeof EegCaseDataSchema>;

export function eegCaseAssetPaths(d: EegCaseData): string[] {
  const out: string[] = [];
  if (d.figure) out.push(d.figure.src);
  if (d.viewer?.source.kind === 'recording') out.push(d.viewer.source.src);
  return out;
}

// ── Grading ──────────────────────────────────────────────────────────────

export const MAX_ATTEMPTS = 2;

export function gradeChoice(step: Extract<EegCaseStep, { kind: 'choice' | 'multi' }>, selected: readonly number[]): boolean {
  const a = new Set(selected);
  return a.size === step.correct.length && step.correct.every((c) => a.has(c));
}

export function gradeMeasure(step: Extract<EegCaseStep, { kind: 'measure' }>, value: number): boolean {
  return Number.isFinite(value) && Math.abs(value - step.expected) <= step.tolerance + 1e-9;
}

/** Parse a learner's number ("9,5" or "9.5 Hz"). */
export function parseNumber(text: string): number {
  const m = text.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

// ── Persisted state ──────────────────────────────────────────────────────

export const StepAnswerSchema = z.object({
  /** Selected indices (choice/multi), number (measure), marks snapshot (mark), or true (reveal). */
  value: z.union([z.array(z.number()), z.number(), z.boolean(), FigureMarksSnapshotSchema]).optional(),
  attempts: z.number().int().nonnegative().default(0),
  /** Correct on the FIRST attempt (scored). */
  firstCorrect: z.boolean().default(false),
  /** Step finished (correct, attempts used up, or revealed). */
  done: z.boolean().default(false),
});
export type StepAnswer = z.infer<typeof StepAnswerSchema>;

export const EegCaseStateSchema = z.object({
  v: z.literal(1),
  answers: z.record(StepAnswerSchema).default({}),
});
export type EegCaseState = z.infer<typeof EegCaseStateSchema>;

export function isGradable(step: EegCaseStep): boolean {
  return step.kind !== 'reveal';
}

/** Index of the first unfinished step (= steps.length when all are done). */
export function currentStepIndex(steps: readonly EegCaseStep[], answers: Readonly<Record<string, StepAnswer>>): number {
  const i = steps.findIndex((s) => !answers[s.id]?.done);
  return i < 0 ? steps.length : i;
}

export function caseScore(steps: readonly EegCaseStep[], answers: Readonly<Record<string, StepAnswer>>): { correct: number; total: number } {
  const gradable = steps.filter(isGradable);
  return { correct: gradable.filter((s) => answers[s.id]?.firstCorrect).length, total: gradable.length };
}

export function describeCaseState(i: {
  vignette: string;
  hasFigure: string | null;
  stepIndex: number;
  total: number;
  current: EegCaseStep | null;
  attempts: number;
  score: { correct: number; total: number };
}): string {
  const lines = [
    `Staged EEG case. Vignette: ${i.vignette.slice(0, 400)}`,
    i.hasFigure ? `EEG shown: ${i.hasFigure}.` : 'EEG shown in the interactive viewer.',
    i.current
      ? `Learner is on step ${i.stepIndex + 1}/${i.total} (${i.current.kind}): ${i.current.prompt}${i.attempts ? ` — ${i.attempts} attempt(s) so far` : ''}. Do not give away the answer to this step; coach with questions.`
      : `All steps done; score ${i.score.correct}/${i.score.total} first-try. The expert summary is visible.`,
  ];
  const text = lines.join('\n');
  return text.length > 2000 ? `${text.slice(0, 1997)}…` : text;
}
