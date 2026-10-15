// patternDrill — rapid pattern-recognition deck on REAL figures (spec §3.4).
// Node-safe: schema + helpers (session logic lives in ./session.ts).

import { z } from 'zod';

import { FigureRefSchema, NormRectSchema, uniqueIdIssues } from '@/widgets/common/eeg/figure';

/** IFCN operational criteria for epileptiform discharges (Kane et al., Clin Neurophysiol Pract 2017;2:170–185). */
export const IFCN_IED_CRITERIA_EN = [
  'Di- or triphasic wave with sharp or spiky morphology (pointed peak)',
  'Different wave duration than the ongoing background activity (shorter or longer)',
  'Asymmetry of the waveform: sharply rising ascending phase and more slowly decaying descending phase, or vice versa',
  'Followed by an associated slow after-wave',
  'The background activity surrounding the discharge is disrupted by its presence',
  'Distribution of negative and positive potentials on the scalp suggests a source in the brain (radial, oblique or tangential orientation)',
] as const;

export const PatternDrillCategorySchema = z.object({
  id: z.string().min(1),
  /** Button label, e.g. "Wyładowanie padaczkowe". */
  label: z.string().min(1),
  description: z.string().optional(),
});

export const PatternDrillItemSchema = z.object({
  id: z.string().min(1),
  figure: FigureRefSchema,
  /** Show only this region of the figure (normalised); "Show whole figure" reveals the rest. */
  crop: NormRectSchema.optional(),
  /** Category id of the correct answer. */
  answer: z.string().min(1),
  /** Markdown shown after answering. */
  explanation: z.string().min(1),
  /** Item to show side by side when the learner chose wrongly (confusion pair). */
  contrastItemId: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const PatternDrillDataSchema = z
  .object({
    prompt: z.string().optional(),
    categories: z.array(PatternDrillCategorySchema).min(2).max(9),
    items: z.array(PatternDrillItemSchema).min(1),
    session: z
      .object({
        length: z.number().int().positive().optional(),
        interleave: z.boolean().default(true),
        requeueMissed: z.boolean().default(true),
        showCriteriaChecklist: z.boolean().default(false),
      })
      .default({}),
    /** Override labels for the six IFCN criteria (e.g. Polish wording). */
    criteriaLabels: z.array(z.string().min(1)).length(6).optional(),
    /** Fraction of cards that must be recognised (first try, across retries) for completion. */
    passThreshold: z.number().min(0).max(1).default(0.8),
  })
  .superRefine((d, ctx) => {
    for (const issue of uniqueIdIssues(d.categories, ['categories'])) ctx.addIssue(issue);
    for (const issue of uniqueIdIssues(d.items, ['items'])) ctx.addIssue(issue);
    const cats = new Set(d.categories.map((c) => c.id));
    const ids = new Set(d.items.map((i) => i.id));
    d.items.forEach((it, i) => {
      if (!cats.has(it.answer)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i, 'answer'], message: `Unknown category "${it.answer}"` });
      if (it.contrastItemId && !ids.has(it.contrastItemId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i, 'contrastItemId'], message: `Unknown item "${it.contrastItemId}"` });
      }
      if (it.contrastItemId === it.id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i, 'contrastItemId'], message: 'An item cannot contrast with itself' });
    });
  });

export type PatternDrillData = z.infer<typeof PatternDrillDataSchema>;
export type PatternDrillDataInput = z.input<typeof PatternDrillDataSchema>;
export type PatternDrillItem = z.infer<typeof PatternDrillItemSchema>;

export function patternDrillAssetPaths(d: PatternDrillData): string[] {
  return Array.from(new Set(d.items.map((i) => i.figure.src)));
}

/** Persisted progress: which cards were recognised (first try in some session). */
export const PatternDrillStateSchema = z.object({
  v: z.literal(1),
  learned: z.array(z.string()).default([]),
  sessions: z.number().int().nonnegative().default(0),
  lastAccuracy: z.number().min(0).max(1).nullable().default(null),
});
export type PatternDrillState = z.infer<typeof PatternDrillStateSchema>;

/** Ids recognised so far, merged with a finished session's first-try hits. */
export function mergeLearned(previous: readonly string[], sessionCorrectFirst: readonly string[]): string[] {
  return Array.from(new Set([...previous, ...sessionCorrectFirst]));
}

export function describeDrillState(i: {
  cardIndex: number;
  remaining: number;
  figureAlt: string;
  attribution: string;
  answered: { choice: string; correct: boolean; correctLabel: string } | null;
  learned: number;
  total: number;
  criteriaTicked?: number | null;
}): string {
  const lines = [
    `Pattern-recognition drill on REAL EEG figures. Card ${i.cardIndex} (${i.remaining} left incl. repeats): ${i.figureAlt} (${i.attribution}).`,
    i.answered
      ? `Learner chose "${i.answered.choice}" — ${i.answered.correct ? 'correct' : `incorrect; the answer is "${i.answered.correctLabel}"`}.`
      : 'Not answered yet — do not reveal the category.',
    `Recognised so far: ${i.learned}/${i.total} cards.`,
  ];
  if (i.criteriaTicked != null) lines.push(`IFCN criteria ticked by the learner: ${i.criteriaTicked}/6.`);
  const text = lines.join('\n');
  return text.length > 2000 ? `${text.slice(0, 1997)}…` : text;
}
