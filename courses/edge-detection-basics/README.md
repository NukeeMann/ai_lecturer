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

## Out of scope

The Code widget snippets in both lessons are **illustrative**: the lesson
player does not execute them. The output images are pre-rendered fixtures, not
the live result of running the Python code. This mirrors how other Code widget
instances behave in fixture courses (e.g. `tts-demo-fixture`,
`stt-demo-fixture`).
