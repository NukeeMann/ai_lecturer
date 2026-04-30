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
