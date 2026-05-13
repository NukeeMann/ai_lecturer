# Pyodide worker — cv2 shim notes

`cv2` in this codebase is a SHIM built on `scipy.ndimage` + `scikit-image`, NOT
real OpenCV. Pyodide has no native OpenCV port, so when a lesson's Code widget
declares `requiresPackages: ['cv2']`, the worker loads `scipy` + `scikit-image`
and runs `scripts/pyodide/cv2_shim.py`. That module re-binds itself into
`sys.modules['cv2']`, so user code can `import cv2` and call the implemented
subset as if it were OpenCV.

## Currently implemented

Constants: `IMREAD_GRAYSCALE`, `IMREAD_COLOR`, `CV_8U`, `CV_64F`.

Functions:
- `imread(path, flags=IMREAD_COLOR)` — wraps `skimage.io.imread`; grayscale
  flag routes through `skimage.color.rgb2gray` and returns `uint8`.
- `imwrite(path, img)` — wraps `skimage.io.imsave`; returns `True`.
- `Sobel(src, ddepth, dx, dy, ksize=3)` — wraps `scipy.ndimage.sobel` on
  `axis=1` (dx=1, dy=0) or `axis=0` (dx=0, dy=1). Other dx/dy combinations
  raise `ValueError`. `ksize` only supports `3`.
- `Canny(image, threshold1, threshold2)` — wraps `skimage.feature.canny`;
  returns a `uint8` mask with values in `{0, 255}`.

Anything not on the list above is NOT implemented.

## Known divergences from real OpenCV

These are intentional and pixel-exact comparisons will fail:
- **Canny Gaussian sigma** — real OpenCV uses a fixed 5×5 Gaussian with
  sigma ≈ 1.4 plus L2 gradient quantization; `skimage.feature.canny` uses
  `sigma=1.0` by default and a different aperture.
- **Sobel scaling** — OpenCV's 3×3 Sobel has `[1, 2, 1]` row weights;
  `scipy.ndimage.sobel` is a different separable kernel and is NOT
  identically scaled. Direction/sign match; absolute magnitudes don't.
- **Sobel ksize** — only `ksize=3` is supported (scipy.ndimage.sobel is a
  fixed 3×3 kernel; no parameter for larger apertures).

Visual results are close enough for teaching the concept, but do not write
lesson tests that compare pixel values against `cv2` reference output.

## Extending the shim

To add a new cv2 function:
1. Add the implementation to `scripts/pyodide/cv2_shim.py`.
2. Mirror the change into the `CV2_SHIM_PY` template literal at the top of
   `src/lib/pyodide/worker.ts` (the worker inlines the source at build time
   so a Service Worker can run it without filesystem access — same pattern
   as `PEXP_PY` / `GAUSS_PY`).
3. No further plumbing needed — the shim is a Python module, so new
   functions become available the moment they appear in the module.

If the new function pulls in a package not already loaded (`scipy`,
`scikit-image`), extend the `py.loadPackage([...])` call inside
`ensureCv2Shim`.

## Consuming from a Code widget

```jsonc
{
  "type": "code",
  "data": {
    "starterCode": "import cv2\nimg = cv2.Canny(arr, 100, 200)",
    "requiresPackages": ["cv2"],
    // ...
  }
}
```

`requiresPackages` is the only signal — when the array contains `'cv2'`, the
worker awaits `ensureCv2Shim(py)` before exec'ing user code. The flag is
flat string-array on purpose: a Code widget might want to opt in to other
heavy packages in the future without growing the API surface.

## Pointers

- Shim source: `scripts/pyodide/cv2_shim.py`
- Worker plumbing: `src/lib/pyodide/worker.ts` (`CV2_SHIM_PY`,
  `ensureCv2Shim`)
- Client API: `src/lib/pyodide/client.ts` (`run` / `runWithTests` accept
  `requiresPackages?: string[]`)
- Schema: `src/widgets/Code/schema.ts` (`CodeDataSchema.requiresPackages`)
- Tests: `src/lib/pyodide/runner.test.ts` (`describe('cv2 shim')`)
