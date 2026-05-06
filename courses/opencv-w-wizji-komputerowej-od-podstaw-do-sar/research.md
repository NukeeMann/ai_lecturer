# Research: OpenCV w wizji komputerowej: od podstaw do SAR

## Topic summary

A comprehensive Polish-language OpenCV (Python) course for intermediate learners that progresses from the fundamentals of digital images through classical computer-vision pipelines (filtering, edge detection, feature matching, segmentation, tracking, 3D geometry, frequency analysis, GPU acceleration) and culminates in synthetic-aperture-radar (SAR) image processing — speckle filtering, radiometric/geometric calibration, GLCM textures, CFAR ship detection, and change detection on Sentinel-1 floods. The learner already has intermediate Python (per Q2) and works on CPU plus an optional GPU (per Q5).

The course balances theory and practice 50/50 (`theoryPracticeRatio = 0.5`). Mathematics is introduced *only where necessary* (per Q7 "tam gdzie konieczne") — e.g. the Gaussian kernel in filtering, projective geometry behind homography, Rayleigh statistics for speckle, and the CFAR threshold derivation. Deep-learning integration is deliberately scoped (per Q4) to ≤ 3 lessons total comparing or hybridising OpenCV with `cv2.dnn`. Real-time video processing (per Q6) is concentrated into 1–2 lessons inside the tracking/background-subtraction module.

The defining motivation is satellite SAR (per Q9). The final 10-lesson module is dedicated end-to-end: Sentinel-1 ingestion, dB / sigma0 calibration, Lee / Frost / Kuan / Refined-Lee speckle filters, GLCM texture features, CFAR ship detection, and a flood-mapping mini-project. Earlier modules deliberately seed concepts (CLAHE for low-contrast SAR, ratio-edge detection, log-ratio change detection) that the SAR module reuses.

**All generated lesson content must be authored in Polish.** Section titles, theory bodies, quiz questions/options/explanations, code task briefs, sandbox encouragement, and inline comments are Polish; only Python identifiers and library/function names stay in English (`cv2.GaussianBlur`, `np.array`, `findContours`).

## Prerequisites

- Intermediate Python: list/dict/array operations, function definitions, decorators, `with` blocks, basic OOP.
- NumPy basics: creating arrays, slicing/indexing, broadcasting, dtype awareness (`uint8`, `float32`, `float64`).
- Comfort installing packages with `pip` and using virtual environments (`venv`, `conda`).
- High-school linear algebra (vectors, matrix multiplication) and basic calculus (partial derivatives) — used sparsely.
- Familiarity with Cartesian coordinates and basic geometry (used in transformations and 3D module).
- Working development environment: Linux/macOS/Windows with Python 3.10+, internet access for pulling sample images and a small Sentinel-1 subset.

Not required: prior OpenCV exposure, deep-learning frameworks, GIS tooling, signal-processing background — the course introduces what it needs.

## Key concepts

- **Image as an array** — an image is an `H × W × C` ndarray of pixel intensities; channel order in OpenCV is BGR, not RGB.
- **Color space** — a coordinate system for representing colour (BGR, HSV, LAB, Gray); choosing the right one is half of a segmentation problem.
- **Convolution** — weighted neighbourhood average; the foundational operation behind blurring, gradients, and edge detection.
- **Kernel / filter** — small matrix (3×3, 5×5) that defines how each pixel is combined with neighbours.
- **Histogram & equalization** — per-bin pixel-count distribution; equalisation stretches it for contrast — CLAHE applies it adaptively per tile.
- **Image gradient** — discrete approximation of partial derivatives (Sobel/Scharr); magnitude and orientation feed every edge detector.
- **Edge detector (Canny)** — pipeline of Gaussian blur → gradient → non-maximum suppression → hysteresis thresholding.
- **Contour** — ordered list of boundary points around a connected region in a binary image; supports area, perimeter, hull, polygonal approximation, Hu moments.
- **Hough transform** — vote-based detector for parameterised shapes (lines, circles); robust to gaps and noise.
- **Local feature** — a (keypoint, descriptor) pair that lets two images be matched without a global registration; SIFT/SURF/ORB/BRISK/AKAZE differ in invariance and licensing.
- **RANSAC + homography** — outlier-robust fitting that yields the 3×3 projective transform between two views.
- **Morphology** — set-theoretic operations on binary masks (erosion, dilation, opening, closing, top-hat) shaped by a structuring element.
- **Thresholding (Otsu, adaptive)** — choosing one (or a local) cut-off in pixel intensity to binarise the image.
- **Segmentation** — partitioning the image into regions: k-means in colour space, Watershed with markers, GrabCut interactive, SLIC superpixels, mean shift.
- **Optical flow** — per-pixel (Farnebäck dense) or sparse-keypoint (Lucas-Kanade) motion estimate between consecutive frames.
- **Background subtraction** — Gaussian-mixture model (MOG2/KNN) per pixel separates static background from moving foreground.
- **Tracker** — stateful estimator that follows one bounding box across frames (KCF, CSRT, MOSSE) — often filtered with Kalman to smooth jitter.
- **Camera intrinsics & extrinsics** — calibration matrix `K` (focal length, principal point) and per-image pose `[R|t]` recovered from a chessboard.
- **Stereo disparity / depth** — pixel offset between rectified views; proportional to inverse depth.
- **Pose estimation (PnP)** — 6-DoF rigid pose of a known 3D object from 2D image points.
- **Frequency-domain filtering** — 2-D FFT moves the image into `(u, v)` coordinates where low/high-pass masking is straightforward.
- **DCT and wavelets** — real-valued cousins of the FFT used in JPEG compression, denoising, and SAR multi-resolution analysis.
- **Vectorisation & GPU** — replacing per-pixel Python loops with NumPy / UMat / CUDA primitives is the difference between 30 s and 30 ms.
- **`cv2.dnn`** — lightweight inference runtime inside OpenCV that loads ONNX / Caffe / TensorFlow graphs without dragging in PyTorch.
- **SAR (Synthetic Aperture Radar)** — side-looking active radar that synthesises a long aperture from satellite motion; produces complex (SLC) or detected-amplitude (GRD) imagery.
- **Polarisation (HH/HV/VV/VH) & band (C/L/X)** — which transmit/receive polarisation pair and microwave band the sensor uses; controls what the imagery is sensitive to.
- **Speckle** — multiplicative interference-pattern noise that follows Rayleigh / Gamma statistics — *not* additive Gaussian.
- **dB scaling & sigma0** — log-amplitude domain and radiometrically-calibrated backscatter coefficient — the "physical" pixel value for analysis.
- **Adaptive speckle filter (Lee, Frost, Kuan, Refined Lee)** — locally-weighted filters that respect the multiplicative-noise model and preserve edges.
- **GLCM (Haralick textures)** — grey-level co-occurrence matrix; yields contrast, dissimilarity, homogeneity, energy, correlation features for texture classification.
- **CFAR (Constant False-Alarm Rate)** — adaptive thresholding for bright targets (e.g. ships) on a noisy background.
- **Change detection (log-ratio, mean-ratio)** — ratio of two co-registered SAR scenes flags areas of significant backscatter change (floods, deforestation, construction).

## Common misconceptions

- *"OpenCV reads images in RGB"* — it reads in **BGR**. Forgetting this corrupts every matplotlib visualisation, every model that expects RGB, and every colour-based threshold.
- *"`cv2.imshow` works inside Jupyter"* — it relies on a native window manager. In notebooks use `matplotlib.pyplot.imshow` after `cv2.cvtColor(img, cv2.COLOR_BGR2RGB)`.
- *"Histogram equalization always improves contrast"* — globally, it can wash out evenly-exposed regions. CLAHE exists exactly because the global form fails on locally-varied imagery (medical, SAR).
- *"Convolution and correlation are the same"* — OpenCV's `filter2D` is correlation (the kernel is **not** flipped). For symmetric kernels (Gaussian, box) the distinction vanishes; for asymmetric kernels it bites.
- *"Bigger kernel always blurs more"* — what matters for Gaussian blur is σ, not just the kernel side length; kernel size should be ≈ 6σ + 1 to capture the relevant tail.
- *"A median filter is just a slow blur"* — it is **not** a linear filter; it preserves edges that a Gaussian blur smears, which is why it shines on impulse / salt-and-pepper noise.
- *"Canny needs one threshold"* — it uses **two** (low and high) for hysteresis. Tuning only one ignores half the algorithm.
- *"`findContours` returns regions"* — it returns **boundaries** (lists of points). The hierarchy parameter encodes how those boundaries nest.
- *"SIFT is patented and unusable"* — the Lowe patent **expired in March 2020**; SIFT is now free in the OpenCV main module (`cv2.SIFT_create`).
- *"More feature matches always means a better homography"* — outliers wreck `findHomography` if you skip RANSAC. Quality > quantity.
- *"`cv2.dnn` is a deep-learning framework"* — it is an **inference-only** runtime; you train your model elsewhere (PyTorch / TensorFlow) and export to ONNX or Caffe to run it here.
- *"GPU is always faster than CPU"* — for small images, kernel-launch and memory-transfer overhead dominates; CUDA wins on big batches and heavy operations (deep nets, large convolutions), not always on a single 640 × 480 frame.
- *"SAR speckle is just noise — apply a Gaussian blur"* — a Gaussian blur destroys edges and ignores the multiplicative noise model. Use Lee / Frost / Kuan / Refined-Lee filters, which were designed for SAR.
- *"SAR pixels are intensities like a photo"* — they are **calibrated radar backscatter** in dB. Operating in linear amplitude vs sigma0 dB changes the answer of every threshold-based step.
- *"CFAR is a fixed threshold"* — its whole point is that the threshold **adapts** to the local clutter statistics so the false-alarm rate stays constant regardless of background.
- *"Polarisation HV and VH are interchangeable"* — for monostatic SAR they almost are (Sentinel-1 typically transmits one and receives both), but they are **not** the same as HH / VV; cross-pol vs co-pol carry different physical information.
- *"Stereo disparity equals depth"* — disparity is **inversely** proportional to depth and only after the views are **rectified** (epipolar lines aligned).
- *"More iterations of `cv2.calcOpticalFlowPyrLK` always improve accuracy"* — beyond a small number, additional iterations chase noise; the pyramid level count matters more.

## Suggested ordering

1. **Module 1 — Fundamenty OpenCV** (6 lessons): the unmissable basics — what OpenCV is, environment setup, NumPy ↔ image, I/O, video, colour spaces. Everything downstream assumes BGR vs RGB has been internalised.
2. **Module 2 — Operacje obrazowe i poprawa kontrastu** (8 lessons): pixel-level arithmetic, histograms, CLAHE, geometric transforms (scale/rotate/affine/perspective), unsharp masking. Closes with a *document-scanner* mini-project that uses perspective + threshold — a satisfying first end-to-end pipeline.
3. **Module 3 — Filtracja, gradienty, morfologia** (9 lessons): linear and non-linear filters, gradients, Laplacian, both flavours of thresholding, morphology, distance transform. This is the toolbox the rest of the course composes.
4. **Module 4 — Krawędzie, kontury i Hough** (7 lessons): Canny, contour analysis (hierarchy, approximation, hull, Hu moments), and Hough for lines and circles — the classical "find geometric structure" set.
5. **Module 5 — Cechy lokalne i dopasowanie** (7 lessons): Harris/Shi-Tomasi, SIFT, ORB/BRISK/AKAZE, BFMatcher/FLANN, RANSAC + homography, stitching. Closes with a *panorama stitcher* mini-project.
6. **Module 6 — Detekcja klasyczna, segmentacja i tracking** (10 lessons): Haar Cascades, HOG+SVM, k-means / Watershed / GrabCut, optical flow, BG subtraction, OpenCV trackers, Kalman. Closes with a *MOT* mini-project tying tracker + Kalman + counting together.
7. **Module 7 — Geometria 3D, FFT i wydajność** (10 lessons): pinhole + chessboard calibration, undistort, stereo disparity, solvePnP, FFT/DCT/wavelets, profiling, NumPy vectorisation, CUDA + UMat, and the ≤ 1 lesson on `cv2.dnn` + classical-with-DL hybrids.
8. **Module 8 — Przetwarzanie i analiza obrazów satelitarnych SAR** (10 lessons): SAR fundamentals, ingestion, dB / sigma0, speckle filters, geometric / radiometric calibration, ratio-edge detection, GLCM textures, CFAR ship detection, and a flood change-detection mini-project. Reuses concepts from CLAHE, morphology, edge detection, feature matching, and FFT.

Within each module, lessons go from concept → mechanism → OpenCV API → exercise. Mini-projects close modules 2, 5, 6, and 8 (per Q8 "wiele mniejszych i średniej wielkości na koniec moduły"). Modules 1, 3, 4, 7 stay technique-focused.

## Notes for lesson generation

The widget reference is `docs/widgets.md`. Recommendations below match the registered widget types; do not invent new ones.

**Theory placement.**

- Open every lesson with one Theory section that frames the concept, motivates it relative to a previous lesson, and points forward.
- Use KaTeX (`$...$`, `$$...$$`) for the genuinely-mathematical lessons: convolution sums, Gaussian kernel, gradient magnitude, FFT, homography, Lee / Frost filter formulas, CFAR threshold equation, GLCM definitions, Kalman update equations. Do **not** lard pure-API lessons (BGR/HSV, install) with formulas.
- Inline images (`![alt](url)`) are encouraged for any Theory section over ~300 characters of prose.

**PlotImage vs Histogram.**

- Use **PlotImage** when the figure has quantitative axes (gradient magnitude across a step edge, FFT magnitude spectrum, dB histogram of a SAR scene, Sobel response curve). Always include axis labels with units, ticks, and a caption "Figure N. …".
- Use **Histogram** when the figure *is* the bar-chart distribution (brightness histogram before/after CLAHE, GLCM texture-feature histogram).
- Do **not** use PlotImage for a kernel-layout sketch or a flowchart — those belong in a Theory inline image.

**Demo widget.**

- Currently only `demoType: "gauss"` is registered. Use it at most **once** in the entire course, and only in the Module 3 lesson on the Gaussian blur. Any other "interactive demo" idea must use ParametricExplorer.

**ParametricExplorer (live Pyodide).**

- Strong fit for: σ-vs-blur, Sobel kernel size, Canny low/high thresholds, Otsu threshold visualisation, k-means K, Watershed marker count, Lucas-Kanade pyramid levels, Lee filter window size, CFAR guard / training cell sizes, FFT low-pass radius, CLAHE clipLimit and tileGridSize, log-ratio threshold for change detection.
- Not a fit for OpenCV calls that depend on building OpenCV from source (CUDA module) or large datasets — keep `setupCode` cheap and `renderCode` fast.
- One ParametricExplorer per lesson at most; otherwise the page becomes hard to follow.

**Code (graded Python).**

- Best in mechanism-heavy lessons: implement a 3×3 box blur, a Gaussian kernel, Sobel from scratch, the NMS step inside Canny, k-means in colour space, a Lee-filter inner loop, log-ratio for two SAR scenes.
- Tests: 2–4 per exercise; default `hidden: true`; one visible smoke test (`hidden: false`) is fine. Always populate `solution`.
- Per Q7, the math-heavy code exercises should isolate one math idea each — not five in one cell.

**CodeCloze (fill-in-the-blank).**

- Use as a gentler alternative to Code in lessons where the algorithm is short and the learner just needs to plug in the right OpenCV call: `cv2.GaussianBlur`, `cv2.threshold(..., cv2.THRESH_OTSU)`, `cv2.findContours(..., cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)`, `cv2.findHomography(..., cv2.RANSAC, 5.0)`. Validation: `oneOf` if multiple equivalent calls work, `exact` if only one is correct.

**DragMatch.**

- Excellent for vocabulary lessons: kernel ↔ effect, colour space ↔ best use, feature detector ↔ invariance property, polarisation ↔ what it measures, speckle filter ↔ assumption. Use as a quick concept check before a quiz.

**DataTable.**

- Reach for it when comparing parameter ranges or operator behaviour: Sobel/Scharr/Prewitt kernels side-by-side, KCF/CSRT/MOSSE speed-vs-accuracy, Sentinel-1 polarisations, Lee/Frost/Kuan/Refined-Lee parameter sets, contour-retrieval modes (`RETR_*`). Don't use for editable data.

**Sandbox (open-ended Pyodide).**

- Use as the final section of hands-on lessons (filtering, colour-space conversion, contour analysis, k-means, Lee filter) — invite the learner to swap parameters and see the change. No correctness gate, no cheerleading.

**Quiz.**

- Distractors should come from the *Common misconceptions* list above. Every lesson with a non-trivial concept should end with one. `multiSelect: true` only when "select all that apply" genuinely makes sense (e.g. "which colour spaces are useful for skin segmentation").

**Video.**

- Sparingly. Reach for a video only when an external creator (3Blue1Brown for math intuition, Computerphile for Canny, the official OpenCV YouTube channel for `cv2.dnn`) does it better than text would. Never rely on a video for the core argument of a lesson — provide a text equivalent.

**Custom.**

- Treat as a TODO marker for a widget that does not yet exist. Do not ship a lesson whose teaching point depends on a Custom section.

**Hands-on density (theoryPracticeRatio = 0.5).**

- Each lesson: 1 Theory + 2–3 hands-on widgets (Code / CodeCloze / ParametricExplorer / Sandbox / DragMatch) + 1 Quiz is a good baseline shape. Mini-project lessons skew further toward Code (one large exercise + Theory framing).

**Math depth (Q7 "tam gdzie konieczne").**

- Derive the Gaussian-kernel formula in Module 3 lesson 2.
- Derive the homography matrix structure in Module 5 lesson 5.
- State (without re-deriving) the Kalman update equations in Module 6 lesson 10.
- State the Lee filter formula in Module 8 lesson 4 with a one-line intuition.
- Derive the CFAR threshold for the Gaussian / Rayleigh case in Module 8 lesson 9.
- Everywhere else: skip the maths and rely on a worked numerical example or a ParametricExplorer.

**SAR module specifics.**

- Use a small Sentinel-1 GRD subset (e.g. a 1024 × 1024 patch around a port like Gdańsk or Rotterdam) as the running dataset. Do **not** ship multi-GB SLC products in the course; either link to ASF DAAC for download or include a pre-cropped sample.
- Prefer `rasterio` for reading; OpenCV (`cv2`) for filtering / morphology / edge detection. The hand-off pattern is `with rasterio.open(...) as src: arr = src.read(1)` → `arr_db = 10 * np.log10(arr.astype(np.float32) + eps)` → `cv2.GaussianBlur(arr_db, ...)`.
- Speckle-filter code should run in linear amplitude (or intensity); apply dB *after* filtering for visualisation only.

**Comparisons with deep learning (Q4).**

- Restrict to Module 7 lesson 10. Compare runtime, dataset cost, and interpretability for one concrete task (face detection: Haar vs `cv2.dnn` ResNet-SSD; pedestrian: HOG+SVM vs YOLO via `cv2.dnn`). Do not try to teach DL; the user is here for OpenCV.

**Real-time video (Q6).**

- Concentrate in Module 6 lessons 7–9 (optical flow, BG subtraction, trackers). One end-to-end live-camera example in the MOT mini-project is enough; do not duplicate it elsewhere.

**Mini-projects (Q8).**

- Module 2 — document scanner (perspective + threshold + clean).
- Module 5 — multi-image panorama stitcher (features + RANSAC + homography + `cv2.Stitcher`).
- Module 6 — multi-object tracker on a video (BG sub + tracker + Kalman + counting).
- Module 8 — flood change detection from two Sentinel-1 GRDs (log-ratio + water mask + morphology).
- Each mini-project is **one** lesson at the *end* of its module, not a separate module.

**Sources usage.**

- The bibliography in `sources.md` is grouped by lesson title. When `generate_lesson` populates `lesson.sources`, it copies ≥ 3 entries from the matching `## <Lesson title>` block (plus, optionally, course-wide references). If a lesson is renamed in `course.json`, update the corresponding `sources.md` heading too — that is how the resolver finds the right section.
