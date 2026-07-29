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

// Demonstrates the optional `inputs[]` and `outputMedia` fields for
// image-processing exercises: the learner sees an input frame and the
// expected output frame side by side; tests still verify numerically.
//
// Also demonstrates the lesson-authoring contract for the input-mounting
// feature: any `inputs[]` entry with a resolvable filename is fetched once
// per lesson and written into the kernel runtime's filesystem at
// `/inputs/<filename>` before user code runs. Here the `/cameraman.png` URL
// has basename `cameraman.png` (no explicit `filename` field needed), so the
// starter code can call `cv2.imread('/inputs/cameraman.png', ...)` directly
// against real OpenCV. Lesson-authoring agents should mirror this pattern:
// declare the file in `inputs[]` and reference it in `starterCode` via the
// `/inputs/<basename>` path.
export const SAMPLE_CODE_THRESHOLD_WITH_MEDIA: CodeData = {
  taskMarkdown:
    'Write `binarise(img)` that returns a 0/255 mask separating foreground from background. Match the expected-output figure shown alongside the editor.',
  starterCode: `import cv2
import numpy as np

# The cameraman PNG declared in inputs[] is auto-mounted by the runtime at
# /inputs/cameraman.png — load it the same way you would on disk.
img = cv2.imread('/inputs/cameraman.png', cv2.IMREAD_GRAYSCALE)

def binarise(img):
    # img: 2D uint8 array
    # return: same-shape uint8 mask whose values are only 0 or 255
    return img

mask = binarise(img)
`,
  tests: [
    {
      name: 'returns uint8 mask of 0/255 only',
      hidden: false,
      body: `import numpy as np
out = binarise(np.array([[10, 200], [30, 220]], dtype=np.uint8))
assert out.dtype == np.uint8, f"expected uint8, got {out.dtype}"
assert set(out.flatten().tolist()) <= {0, 255}, f"unexpected values: {set(out.flatten().tolist())}"`,
    },
    {
      name: 'preserves shape',
      hidden: true,
      body: `import numpy as np
img = np.zeros((4, 5), dtype=np.uint8)
assert binarise(img).shape == (4, 5)`,
    },
  ],
  solution: `import cv2
import numpy as np

img = cv2.imread('/inputs/cameraman.png', cv2.IMREAD_GRAYSCALE)

def binarise(img):
    return ((img > 127).astype(np.uint8) * 255)

mask = binarise(img)
`,
  requiresPackages: ['cv2'],
  inputs: [
    {
      kind: 'image',
      src: '/cameraman.png',
      alt: 'Grayscale 8-bit photograph of a cameraman against a bright sky.',
      caption: 'Input frame — grayscale, 8-bit.',
    },
  ],
  outputMedia: {
    kind: 'image',
    src: '/cameraman-binarised.png',
    alt: 'Binary mask of the cameraman scene with foreground in white and background in black.',
    caption: 'Expected output — global threshold at 127.',
  },
};
