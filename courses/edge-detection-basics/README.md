# Edge Detection with OpenCV — Hands-On Basics (bundled fixture course)

This is a bundled demo course (US-169) that ships with the AI Lecturer repo. It
showcases the Code widget alongside paired Image widgets (input photo + output
edge map) using a simple Python + OpenCV pipeline.

## Assets — source and licensing

All four images under `assets/` are **synthetic, procedurally generated** with
NumPy + Pillow. There are no third-party photographs, so no licensing
restrictions apply: the assets are released under the same license as the rest
of the repository.

- `input-sobel.png` — 256×256 grayscale geometric scene (filled rectangle,
  outlined square, disk, diagonal line, bright square, gradient sky). Generated
  to give Sobel a variety of edge types.
- `output-sobel.png` — Sobel gradient magnitude $\sqrt{G_x^2 + G_y^2}$ of the
  above, computed with the same 3×3 kernels OpenCV uses, then normalised to
  `uint8`. Matches what `cv2.Sobel(img, cv2.CV_64F, ...)` + `np.sqrt(...)`
  would produce.
- `input-canny.png` — 256×256 grayscale "houses + checkered floor" scene with
  Gaussian blur and additive noise. Chosen to highlight Canny's behaviour
  versus Sobel: a smooth sky gradient (Canny correctly ignores it), crisp
  object boundaries (Canny keeps them), and a high-frequency texture region
  (Canny reduces it to tile boundaries).
- `output-canny.png` — Binary Canny edge map of the above, computed with a
  faithful four-step implementation (Gaussian blur → Sobel → non-maximum
  suppression → hysteresis with `low=60`, `high=150`). Matches what
  `cv2.Canny(img, 100, 200)` would produce up to small numerical differences
  in border handling.

The generation script lives at `/tmp/gen_edge_images.py` in the worktree where
this fixture was created; it is not committed because the images themselves
are the durable artefact and the script depends only on NumPy + Pillow which
are not project dev dependencies. To regenerate, the script's algorithm is
documented inline in its module docstring.

## Runtime environment

The two lessons execute their Python on the lesson's **IPython kernel
runtime** (US-196/US-201), which has **real OpenCV** (`opencv-python`)
installed. So `import cv2` resolves to genuine OpenCV: `cv2.Sobel`,
`cv2.Canny`, `cv2.imread`, etc. produce exactly the pixel values a learner
would get running the same code in a regular Python env with
`opencv-python` installed.

> Historical note: earlier revisions of this course ran under **Pyodide**
> with a hand-written `cv2` *shim* over `scipy.ndimage` + `scikit-image`,
> which diverged numerically from OpenCV (different Sobel kernel, different
> Canny sigma). That shim was removed in US-206. The lesson tests were
> written as **structural** checks (`dtype`, `shape`, binary edge map,
> `max == 255`) precisely so they hold under either backend — and they pass
> against real OpenCV unchanged. See `src/lib/pyodide/CLAUDE.md` for details.

The synthetic input images each lesson builds in Python (`img = np.zeros…`)
are constructed to be visually similar to the reference PNGs in `assets/`
but are NOT pixel-exact copies. They exist so the lesson player can
execute the code without doing file I/O against Pyodide's virtual
filesystem.

## Asset images

The pre-rendered PNGs under `assets/` are used as static reference images
shown alongside the live Code widget — the input image is rendered in
the Code widget's Inputs panel; the output image acts as a placeholder
below the editor until the learner presses Submit, at which point the
matplotlib figure produced by their code replaces it.
