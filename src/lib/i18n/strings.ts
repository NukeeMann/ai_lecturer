/**
 * Single source-of-truth for chrome / UI strings (English).
 *
 * Course content (lesson titles, widget content, generated text) is NOT
 * stored here — that comes from the per-course JSON authored at generation
 * time and is intentionally allowed to be in any language.
 *
 * Introduced in US-119 to consolidate hard-coded UI strings in one place so
 * US-121's PL toggle can swap them by replacing this module's exports.
 */
export const strings = {
  dashboard: {
    newCourse: 'New course',
  },
  resumeBanner: {
    generatingPrefix: 'Generating course',
    inQueueSuffix: 'in queue',
    resumeCta: 'Back to generation',
  },
  generation: {
    queuedHeading: 'Your generation is queued',
    queuedDescription:
      'Another course is currently being generated. Yours will start automatically as soon as that one finishes.',
    queuePositionPrefix: 'In queue —',
  },
  sources: {
    heading: 'Sources',
  },
  flashcards: {
    heading: 'Anki flashcards',
    download: 'Download deck',
    cards: (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`,
    subdecks: (n: number) => `${n} ${n === 1 ? 'subdeck' : 'subdecks'}`,
    empty: 'No flashcards for this course yet.',
    generate: 'Generate flashcards',
    generateMissing: (n: number) => `Generate missing (${n})`,
    regenerate: 'Regenerate',
    regenerateConfirm:
      'Regenerate the flashcards for every module? Cards that still cover the same fact keep their identity, so re-importing updates them without losing review progress.',
    generating: (done: number, total: number) => `Generating… ${done}/${total} modules`,
    failed: 'Some modules failed — try again.',
    howTo: 'How to import',
    howToSteps: [
      'Computer: install Anki (free, apps.ankiweb.net) and open the downloaded file.',
      'Android: open the file with AnkiDroid (free).',
      'iPhone / iPad: open the file and pick AnkiMobile. Without it, import on a computer, sync, then study at ankiweb.net.',
      'Downloading again later updates the cards and keeps your progress.',
    ],
  },
} as const;
