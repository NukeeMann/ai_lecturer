# Pyodide worker notes

This module hosts the legacy **Pyodide** Web Worker. It still powers the three
self-contained Pyodide widgets — **GaussDemo**, **ParametricExplorer**, and
**PlotImage** (plus the pure-client **CodeCloze**). The Code and Sandbox
widgets do NOT use this worker anymore: they execute on the real per-lesson
IPython kernel runtime (US-196/US-201/US-202), which ships genuine scientific
libraries (numpy, scipy, matplotlib, **real OpenCV (`cv2`)**, torch,
tensorflow, …).

## No more cv2 shim (US-206)

Earlier (US-173) this worker carried a hand-written `cv2` *shim* built on
`scipy.ndimage` + `scikit-image`, because Pyodide has no native OpenCV port.
That shim has been **removed** in US-206 — real OpenCV is now available in the
kernel runtime, so the divergent code path is gone. The deleted pieces were:
the standalone shim source file under `scripts/pyodide/`, its inlined copy and
loader function in `worker.ts`, and the `'cv2'` preload hook those drove.

If a lesson needs OpenCV it runs on the kernel via the Code/Sandbox widgets;
`requiresPackages` (e.g. `['cv2']`) is a **precondition check** against the
kernel runtime (US-202/US-203), not a request to install or shim anything in
this worker. The `requiresPackages` field still rides along in the worker's
`run` / `runWithTests` payload for wire-compat, but the worker ignores it.

### Pixel-value divergence — re-verify lesson tests

The old shim produced *different pixel values* than OpenCV:

- **Canny** — the shim used `skimage.feature.canny` (default `sigma=1.0`,
  different aperture); real OpenCV uses a fixed 5×5 Gaussian (`sigma ≈ 1.4`)
  with L2 gradient quantization. Edge maps land in different places at the
  pixel level.
- **Sobel** — the shim used `scipy.ndimage.sobel` (a different separable
  kernel); real OpenCV's 3×3 Sobel has `[1, 2, 1]` row weights. Direction
  matches, absolute magnitudes do not.

So **moving to real OpenCV changes pixel values**. Any lesson test that
asserts on `cv2` output must use *structural* checks (dtype, shape, that the
edge map is binary, that the magnitude max is 255), NOT pixel-exact
comparisons against the old shim output. The bundled `edge-detection-basics`
course (`sobel-gradients`, `canny-edges`) already does exactly this — its
tests check `dtype` / `shape` / `max`, all of which hold under real OpenCV.

## Still-live Pyodide internals

The remaining worker routines are lazy-installed on first use:

- `ensureRunner` — the per-lesson namespace runner (`RUNNER_PY`).
- `ensureGauss` — GaussDemo's blur routine (loads Pillow).
- `ensurePexp` — ParametricExplorer's setup/render harness (loads matplotlib).
- `ensureLivePngCapture` — live matplotlib figure capture for legacy paths.

## Pointers

- Worker: `src/lib/pyodide/worker.ts`
- Client API: `src/lib/pyodide/client.ts`
- Kernel runtime (where real `cv2` lives): `src/lib/kernel/`,
  `scripts/kernel/kernel_bridge.py`, `scripts/setup-kernel.sh`
- Kernel end-to-end suite (real `import cv2`):
  `src/lib/server/kernelE2E.e2e.test.ts`
- Tests: `src/lib/pyodide/runner.test.ts`
