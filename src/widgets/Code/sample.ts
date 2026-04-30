import type { CodeData } from './schema';

export const SAMPLE_CODE_BOX_BLUR: CodeData = {
  taskMarkdown:
    'Write a function `box_blur(values)` that returns the average of a 3-element list.',
  starterCode: `def box_blur(values):
    # TODO: return the average of values
    return 0
`,
  tests: [
    {
      name: 'returns the mean for a simple triple',
      hidden: true,
      body: `assert box_blur([1, 2, 3]) == 2, f"expected 2, got {box_blur([1, 2, 3])}"`,
    },
    {
      name: 'handles negative numbers',
      hidden: true,
      body: `assert box_blur([-3, 0, 3]) == 0, f"expected 0, got {box_blur([-3, 0, 3])}"`,
    },
    {
      name: 'handles all zeros',
      hidden: true,
      body: `assert box_blur([0, 0, 0]) == 0, f"expected 0, got {box_blur([0, 0, 0])}"`,
    },
  ],
};
