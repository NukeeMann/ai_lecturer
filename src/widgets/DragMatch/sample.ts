import type { DragMatchData } from './schema';

export const SAMPLE_DRAG_MATCH: DragMatchData = {
  prompt: 'Match each programming term to its definition.',
  items: [
    { id: 'i-var', label: 'Variable' },
    { id: 'i-fn', label: 'Function' },
    { id: 'i-loop', label: 'Loop' },
  ],
  zones: [
    {
      id: 'z-var',
      label: 'A named storage for values',
      accepts: ['i-var'],
    },
    {
      id: 'z-fn',
      label: 'A reusable block of code',
      accepts: ['i-fn'],
    },
    {
      id: 'z-loop',
      label: 'A control flow that repeats',
      accepts: ['i-loop'],
    },
  ],
  multipleItemsPerZone: false,
  requireAll: true,
  explanation:
    'A variable stores data; a function bundles reusable behaviour; a loop repeats a block of code.',
};
