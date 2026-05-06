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
} as const;
