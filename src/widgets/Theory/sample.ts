export const SAMPLE_THEORY_MARKDOWN = `## What is a convolution?

A **convolution** smooths a signal by replacing each sample with a weighted average of its neighbours. In image processing the weights live in a small grid called a *kernel* — for a Gaussian blur with standard deviation \\(\\sigma\\), the kernel weights follow

\\[
G(x, y) = \\frac{1}{2\\pi\\sigma^{2}} \\, e^{-\\frac{x^{2} + y^{2}}{2\\sigma^{2}}}
\\]

Larger \\(\\sigma\\) means a wider kernel, so more pixels contribute to the average — which means more blur. The 1D analogue, useful for separable implementations, is

$$
G(x) = \\frac{1}{\\sqrt{2\\pi}\\sigma} \\, e^{-\\frac{x^{2}}{2\\sigma^{2}}}
$$

You can compute a 2D Gaussian as the outer product of two 1D Gaussians, which is why scipy's \`gaussian_filter\` is fast even on large images.

:::callout{type="info" title="Why this matters"}
Almost every image-processing pipeline starts with a smoothing pass. Edge detectors, feature descriptors, and noise-reduction filters all assume the input has been pre-blurred enough to suppress sensor noise but not so much that real edges disappear.
:::

:::callout{type="insight" title="Mental model"}
Think of \\(\\sigma\\) as the *spatial scale* of the filter. Structures smaller than \\(\\sigma\\) get washed out; structures larger than \\(\\sigma\\) survive. Picking \\(\\sigma\\) is picking *what counts as detail*.
:::

A minimal NumPy implementation looks like:

\`\`\`python
import numpy as np
from scipy.ndimage import gaussian_filter

def blur(img: np.ndarray, sigma: float) -> np.ndarray:
    return gaussian_filter(img, sigma=sigma)
\`\`\`

Use \`mode="reflect"\` at the borders if you want to avoid darkening near the image edges — the default \`"reflect"\` already does this.

:::callout{type="warning" title="Watch the kernel size"}
A kernel that's too narrow relative to \\(\\sigma\\) (say, a 3×3 kernel with \\(\\sigma > 1.5\\)) truncates the tails of the Gaussian and introduces ringing. Use a kernel radius of at least \\(3\\sigma\\) on each side.
:::

:::callout{type="danger" title="Don't blur in sRGB"}
Standard image files are stored in *gamma-encoded* sRGB, but Gaussian averaging only makes physical sense in *linear* light. Converting to linear, blurring, and converting back avoids the muddy halos you'd otherwise see around bright highlights.
:::
`;
