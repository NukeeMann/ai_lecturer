"""cv2 shim for Pyodide.

This is a SHIM, not real OpenCV. Pyodide has no native OpenCV port, so we
re-expose the small subset of the cv2 API used by lessons on top of
scipy.ndimage + scikit-image. After this module is imported (or the worker
runs it), `import cv2` resolves to this shim.

NUMERICAL CAVEATS — NOT 1:1 with OpenCV:
  * cv2.Canny in OpenCV applies a fixed 5x5 Gaussian (sigma~1.4) and uses
    L2 gradient magnitude with its own quantization; skimage.feature.canny
    here uses sigma=1.0 by default and a different aperture. Edge maps look
    visually similar but pixel-exact comparisons will differ.
  * cv2.Sobel returns scaled gradients (the OpenCV 3x3 kernel sums to 0 but
    the row weights are [1, 2, 1] times +/-1); scipy.ndimage.sobel uses a
    different separable kernel and is NOT identically scaled. Sign and
    direction match; absolute magnitudes do not.

API SUBSET implemented here:
  Constants: IMREAD_GRAYSCALE, IMREAD_COLOR, CV_8U, CV_64F.
  Functions: imread, imwrite, Sobel, Canny.
Anything else (e.g. cv2.GaussianBlur, cv2.cvtColor, cv2.findContours) is
NOT implemented — adding new functions requires extending this file.

KSIZE: cv2.Sobel here only supports ksize=3. scipy.ndimage.sobel is fixed
at a 3x3 kernel and there is no parameter for larger apertures.

CONSUMERS: this module is intended to be loaded by the Pyodide worker via
`ensureCv2Shim(py)` — see `src/lib/pyodide/CLAUDE.md` for how lesson code
opts in (Code widget `requiresPackages: ['cv2']`).
"""

import sys

import numpy as np
import scipy.ndimage as _ndimage
import skimage.color as _color
import skimage.feature as _feature
import skimage.io as _skio

IMREAD_GRAYSCALE = 0
IMREAD_COLOR = 1
CV_8U = 0
CV_64F = 6


def imread(path, flags=IMREAD_COLOR):
    img = _skio.imread(path)
    if flags == IMREAD_GRAYSCALE:
        if img.ndim == 3:
            img = _color.rgb2gray(img)
        img = (np.asarray(img) * 255).astype(np.uint8) if img.dtype != np.uint8 else img
    return img


def imwrite(path, img):
    _skio.imsave(path, img)
    return True


def Sobel(src, ddepth, dx, dy, ksize=3):
    if ksize != 3:
        raise ValueError("cv2 shim Sobel only supports ksize=3")
    arr = src.astype(np.float64)
    if dx == 1 and dy == 0:
        return _ndimage.sobel(arr, axis=1)
    if dx == 0 and dy == 1:
        return _ndimage.sobel(arr, axis=0)
    raise ValueError("cv2 shim Sobel only supports (dx=1,dy=0) or (dx=0,dy=1)")


def Canny(image, threshold1, threshold2):
    edges = _feature.canny(
        image.astype(np.float64) / 255.0,
        low_threshold=threshold1 / 255.0,
        high_threshold=threshold2 / 255.0,
    )
    return (edges.astype(np.uint8)) * 255


sys.modules['cv2'] = sys.modules[__name__]
