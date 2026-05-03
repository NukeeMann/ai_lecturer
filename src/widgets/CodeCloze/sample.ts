import type { CodeClozeData } from './schema';

export const SAMPLE_CODE_CLOZE_BOX_BLUR: CodeClozeData = {
  taskMarkdown:
    'Fill in the blanks to compute the mean of a 3-element list. Use `sum` to total the values and divide by the length.',
  template: `def box_blur(values):
    total = {{aggregator}}(values)
    return total / {{divisor}}
`,
  slots: [
    {
      id: 'aggregator',
      hint: 'Use the built-in that totals an iterable.',
      validation: { kind: 'exact', value: 'sum' },
    },
    {
      id: 'divisor',
      hint: 'Divide by the count of values.',
      validation: { kind: 'oneOf', values: ['len(values)', '3'] },
    },
  ],
  finalTests: [
    {
      name: 'returns the mean for a simple triple',
      hidden: true,
      body: 'assert box_blur([1, 2, 3]) == 2',
    },
    {
      name: 'handles negative numbers',
      hidden: true,
      body: 'assert box_blur([-3, 0, 3]) == 0',
    },
  ],
  hints: [
    {
      revealAfterAttempts: 1,
      markdown: 'Each blank takes a single Python expression.',
    },
    {
      revealAfterAttempts: 3,
      markdown: 'The first blank is `sum`; the second is the count of `values`.',
    },
  ],
};
