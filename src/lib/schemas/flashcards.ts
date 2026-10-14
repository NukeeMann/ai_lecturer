import { z } from 'zod';

// Flashcards for one course module, written by the generate_flashcards skill
// to /courses/<slug>/flashcards/<moduleId>.json. The server turns every
// module file into one Anki subdeck and bundles them into a single .apkg
// (see src/lib/flashcards/apkg.ts).
//
// `id` is part of the Anki note GUID (course slug + module id + card id), so
// it must stay stable across regenerations: same id → Anki updates the note
// in place and keeps the learner's review history; new id → a new note.
export const FlashcardIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'card id must be a lowercase slug ([a-z0-9-])')
  .max(80);

const cardBase = {
  id: FlashcardIdSchema,
  // Optional line under the answer: a mnemonic, the "why", or a contrast
  // with an easily-confused fact. Markdown subset + $math$.
  extra: z.string().optional(),
  // Lesson the fact comes from. Becomes an Anki tag and the small source
  // line on the answer side.
  lessonSlug: z.string().optional(),
};

export const BasicFlashcardSchema = z.object({
  ...cardBase,
  kind: z.literal('basic'),
  front: z.string().min(1),
  back: z.string().min(1),
  // true → Anki also generates the back→front card. Only for pairs that
  // make sense both ways (term ↔ definition, country ↔ capital).
  reverse: z.boolean().optional(),
});

export const CLOZE_DELETION_RE = /\{\{c(\d+)::([\s\S]+?)\}\}/g;

export const ClozeFlashcardSchema = z.object({
  ...cardBase,
  kind: z.literal('cloze'),
  // Anki cloze syntax: "Stolicą Polski jest {{c1::Warszawa}}." Optional hint
  // after a second `::` ({{c1::Warszawa::miasto}}).
  text: z
    .string()
    .min(1)
    .refine((t) => new RegExp(CLOZE_DELETION_RE.source).test(t), {
      message: 'cloze text needs at least one {{c1::…}} deletion',
    }),
});

export const FlashcardSchema = z.discriminatedUnion('kind', [
  BasicFlashcardSchema,
  ClozeFlashcardSchema,
]);

export const FlashcardDeckSchema = z
  .object({
    schemaVersion: z.number().int().default(1),
    courseSlug: z.string(),
    moduleId: z.string(),
    cards: z.array(FlashcardSchema).min(1),
  })
  .superRefine((deck, ctx) => {
    const seen = new Set<string>();
    deck.cards.forEach((card, i) => {
      if (seen.has(card.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cards', i, 'id'],
          message: `duplicate card id ${JSON.stringify(card.id)}`,
        });
      }
      seen.add(card.id);
    });
  });

export type BasicFlashcard = z.infer<typeof BasicFlashcardSchema>;
export type ClozeFlashcard = z.infer<typeof ClozeFlashcardSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type FlashcardDeck = z.infer<typeof FlashcardDeckSchema>;

// GET /api/courses/<slug>/flashcards
export interface FlashcardsSummary {
  // At least one module has a valid flashcards file → the deck can be built.
  available: boolean;
  totalCards: number;
  // Course modules in course order; `cards` is 0 when the module has no
  // (valid) flashcards file yet.
  modules: { moduleId: string; title: string; cards: number }[];
  // Modules that have lessons but no valid flashcards yet (what an on-demand
  // "generate" job would fill in).
  missingModules: number;
  job: FlashcardsJobStatus | null;
}

export interface FlashcardsJobStatus {
  state: 'running' | 'done' | 'error';
  // Modules processed so far / modules to process in this job.
  current: number;
  total: number;
  failedModules: string[];
  message?: string;
}
