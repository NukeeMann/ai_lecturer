import type { QuizData } from './schema';

export const SAMPLE_QUIZ_SINGLE: QuizData = {
  question: 'Which kernel best detects vertical edges in a grayscale image?',
  options: [
    'A 3×3 box of all 1/9 — uniform average',
    'Sobel-x: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]',
    'A Gaussian kernel centered at the origin',
    'Sobel-y: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]]',
  ],
  correct: [1],
  explanation:
    'Sobel-x has positive weights on the right column and negative weights on the left, so it produces large magnitudes when intensity changes horizontally — i.e. across a vertical edge. Sobel-y is its transpose and detects horizontal edges; the box and Gaussian are smoothing filters and cannot localize edges.',
  multiSelect: false,
};
