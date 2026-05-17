import type { SandboxData } from './schema';

export const SAMPLE_SANDBOX_GAUSS: SandboxData = {
  starterCode: `import math

# A 1-D Gaussian kernel — try changing sigma and see how the values shift.
def gaussian(sigma, radius=2):
    weights = []
    for i in range(-radius, radius + 1):
        weights.append(math.exp(-(i * i) / (2 * sigma * sigma)))
    total = sum(weights)
    return [w / total for w in weights]


for sigma in (0.5, 1.0, 2.0):
    print(f"sigma={sigma}: {[round(w, 3) for w in gaussian(sigma)]}")
`,
  encouragement: '',
};

// Sandbox variant that mirrors Code's `inputs[]` + `outputMedia` contract:
// the input image is mounted by the worker at /inputs/cameraman.jpg (basename
// derived from `src`) and the matplotlib figure produced by Run replaces the
// placeholder image because `outputMedia.live === true`. Lesson-authoring
// agents can use this as a reference for sandbox sections that should
// explore image processing.
export const SAMPLE_SANDBOX_BLUR_PLAYGROUND: SandboxData = {
  starterCode: `import cv2
import numpy as np
import matplotlib.pyplot as plt

img = cv2.imread('/inputs/cameraman.jpg', cv2.IMREAD_GRAYSCALE)

# Tweak the kernel size and rerun to see how the blur changes.
ksize = 5
blurred = cv2.blur(img, (ksize, ksize))

plt.imshow(blurred, cmap='gray')
plt.title(f'box blur, ksize={ksize}')
plt.axis('off')
`,
  encouragement: 'Change ksize and rerun — the output image updates live.',
  requiresPackages: ['cv2', 'matplotlib'],
  inputs: [
    {
      kind: 'image',
      src: '/demo-images/cameraman.jpg',
      alt: 'Grayscale 8-bit photograph of a cameraman against a bright sky.',
      caption: 'Input frame — grayscale, 8-bit.',
    },
  ],
  outputMedia: {
    kind: 'image',
    src: '/demo-images/cameraman.jpg',
    alt: 'Placeholder showing the input image; Run replaces it with your blurred figure.',
    caption: 'Output — your matplotlib figure appears here after Run.',
    live: true,
  },
};
