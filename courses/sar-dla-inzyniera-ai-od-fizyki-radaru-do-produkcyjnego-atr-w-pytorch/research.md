# Research: SAR dla inżyniera AI: od fizyki radaru do produkcyjnego ATR w PyTorch

## Topic summary

A Polish-language, intermediate-level course that takes a working computer-vision / PyTorch engineer who has **never touched SAR** (per Q2 — "Nie pracowałem z żadnymi") through the full radar pipeline, with an explicit destination: a Senior AI Specialist role at SATIM (per Q1) focused on Automatic Target Recognition (ATR) of ships, aircraft, and ground vehicles (per Q4). The course covers SAR foundations (radar physics, range/azimuth geometry, SLC vs GRD products, polarimetry, speckle as multiplicative noise), Python pre-processing of Sentinel-1 (`sentinelsat`/`asf_search`, SNAP via `snappy`, `xarray-sentinel`, radiometric calibration, multilooking, terrain correction), classical feature engineering and baselines (GLCM/Haralick textures, CFAR ship detection, interferometric coherence, log-ratio change detection), deep-learning-on-SAR in PyTorch (despeckling with ID-CNN / SAR-DRN / Speckle2Void, semantic segmentation on SEN12MS, ship detection on OpenSARShip, vehicle/aircraft classification on MSTAR, SAR-specific augmentation, transfer learning from optical), and production deployment (ONNX export, FP16 / INT8 quantisation, domain-specific evaluation: PSNR, ENL, mAP, F1). The course closes with a capstone end-to-end pipeline `Sentinel-1 scene → detections + classifications` runnable on a local GPU or Google Colab / Kaggle (per Q6).

The `durationTarget` is **standard** (8–12 lessons / 1–3 h on the duration table); the draft structure shipped 18 lessons across 6 modules, which is closer to *extensive*. The architect pass below collapses the draft into **3 modules / 12 lessons** by merging the SAR-foundations module into a single concept lesson, fusing the four speckle filters into one filtering lesson, folding `snappy` + `xarray-sentinel` + calibration into a single ingestion-and-calibration lesson, and merging `Self-supervised despeckling` into the main despeckling lesson. The capstone wrap-up ("Insighty z danych i prezentacja wyników") is folded into the capstone lesson itself rather than spending a slot on a presentation-only lesson.

The course is unapologetically **DL-first** (per Q7 — "działajace modele DL i insight z danych jak wydobyć i co mówi"). PolSAR is treated as a signalling intro inside Module 1; full polarimetric decompositions and interferometry get concept-level coverage but are not full lessons (per Q5 — "sam zdecyduj jak istotne"; SATIM's published role focuses on amplitude-domain ATR, so polarimetry / InSAR carry their weight as background, not as the centre of mass). Production deployment **is** in scope — Q10 explicitly requires it.

`theoryPracticeRatio = 0.62` — slightly theory-leaning. This means lessons should open with a substantial Theory section (radar physics, speckle statistics, network architecture intuition) before the hands-on widget, and Module 3 lessons in particular need enough theory to explain *why* the architecture works on SAR rather than copy-pasting an optical-domain recipe.

**All generated lesson content must be authored in Polish.** Section titles, theory bodies, quiz questions/options/explanations, code task briefs, sandbox encouragement, and inline comments are Polish; only Python identifiers and library/function names stay in English (`torch.nn.Conv2d`, `np.log10`, `rasterio.open`, `cv2.GaussianBlur`).

## Prerequisites

- Daily PyTorch usage: defining `nn.Module`, training loops with `torch.optim`, autograd, `DataLoader`, mixed-precision (`torch.cuda.amp`) — the user already has this (per Q3).
- Solid NumPy / Python: ndarray slicing, broadcasting, dtype awareness (`uint8`, `float32`, `complex64`), `with` blocks, basic OOP, virtualenv / conda.
- Comfort with computer vision in PyTorch: convolutional architectures, transfer learning from ImageNet, common backbones (ResNet, U-Net, YOLO/DETR family).
- High-school complex numbers (modulus, phase) and basic statistics (mean, variance, distribution moments) — used to read SLC data and reason about speckle and ENL.
- High-school linear algebra (matrix multiplication, eigen-decomposition idea) — touched in Pauli decomposition and coherence.
- A working Python 3.10+ environment with internet access (for ASF/Copernicus downloads), a local NVIDIA GPU **or** access to Google Colab / Kaggle (per Q6).
- For one optional pre-processing lesson: ESA SNAP installed locally (the lesson explicitly offers a pre-cropped fallback so a learner without SNAP can still complete it).

Not required: prior `sentinelsat` / `asf_search` / `snappy` / `xarray-sentinel` / `sarpy` exposure (per Q3 — "bibliotek wymienionych nie znam"), prior remote-sensing or geodesy background, signal-processing coursework, or hands-on SAR experience (per Q2). The course introduces what it needs.

## Key concepts

- **Synthetic Aperture Radar (SAR)** — side-looking active microwave imaging that synthesises a long virtual antenna aperture from satellite motion; the result is *not* a Doppler radar product but a 2-D range-azimuth image.
- **Range vs azimuth** — the two image axes; `range` ≈ across-track / sensor-to-ground line-of-sight, `azimuth` ≈ along-track / orbit direction. Range and azimuth resolution are governed by different physics (chirp bandwidth vs synthetic aperture length).
- **Look angle / incidence angle** — the angle between the radar line-of-sight and the local surface normal; controls backscatter, layover, foreshortening, and shadow.
- **Sentinel-1 SLC vs GRD** — Single-Look Complex (preserves complex amplitude + phase, per-pixel `complex64`, used for InSAR and full polarimetric work) vs Ground-Range Detected (multi-looked, real-valued amplitude resampled to ground range, ready for amplitude-domain ML).
- **Polarisation (HH / HV / VH / VV)** — transmit/receive linear-polarisation pair. Sentinel-1 over land typically ships dual-pol VV+VH; co-pol vs cross-pol carry different physical information (volumetric vs surface scattering).
- **Pauli decomposition** — a 3-channel polarimetric visualisation `(|HH-VV|, |HV+VH|, |HH+VV|)` mapping surface, volume, and double-bounce scattering into RGB.
- **Speckle** — multiplicative interference noise inherent to coherent radar imaging; per-pixel intensity follows a Gamma distribution (Rayleigh in amplitude) with mean equal to the underlying backscatter and variance proportional to that mean.
- **Equivalent Number of Looks (ENL)** — empirical estimator `(mean / std)^2` over a homogeneous patch; the standard quality metric for despeckling — bigger ENL = smoother result, with the trade-off that over-smoothing erases structure.
- **Multilooking** — averaging neighbouring SLC pixels (range × azimuth) to trade resolution for ENL; produces lower-resolution but radiometrically smoother imagery used for amplitude-domain analysis.
- **Sigma-naught (σ⁰) and dB scaling** — sigma0 is the radiometrically-calibrated radar backscatter coefficient (linear units `m²/m²`); dB form `10·log10(σ⁰)` is what every visualisation and threshold-based step operates on.
- **Adaptive speckle filter (Lee, Frost, Refined Lee, NL-means)** — locally-weighted filters that respect the multiplicative noise model and try to preserve edges; Refined Lee is the de-facto SAR baseline against which CNN despeckling reports gains.
- **Range-Doppler terrain correction** — orthorectification step using a DEM (SRTM, Copernicus DEM) to project a radar geometry image into a map projection (EPSG:4326 typically), required before any geographic overlay.
- **GLCM (Grey-Level Co-occurrence Matrix) and Haralick features** — texture descriptor counting how often pairs of grey-level values co-occur at a given offset; produces contrast, dissimilarity, homogeneity, energy, correlation, ASM that feed land-cover or ship-vs-clutter baselines.
- **CFAR (Constant False-Alarm Rate)** — adaptive threshold for bright-target detection on noisy clutter background; the threshold tracks local sea-clutter statistics so the false-alarm rate stays constant — the canonical SAR ship-detection baseline.
- **Interferometric coherence γ** — magnitude of the complex correlation between two co-registered SLC scenes; `|γ| ∈ [0, 1]` measures how phase-stable the scene is between acquisitions; a hands-on summary statistic for change.
- **Change detection (log-ratio, mean-ratio, CVA)** — taking the log-ratio of two co-registered amplitude scenes flags areas of significant backscatter change (floods, deforestation, port activity); robust to multiplicative noise in a way that simple subtraction is not.
- **Despeckling CNN (ID-CNN, SAR-DRN)** — supervised feed-forward networks trained on synthetic speckle (or simulated multilook noise) to map noisy → clean amplitude; report PSNR / ENL / EPI against Refined Lee.
- **Self-supervised despeckling (Speckle2Void)** — blind-spot CNN trained directly on noisy SAR with no clean reference — exploits speckle's spatial independence to learn a denoiser without ground truth.
- **Transfer learning from optical** — initialising a SAR network with ImageNet-pretrained backbone weights, then fine-tuning; works *despite* the domain gap because low-level edge / texture filters transfer; needs care with normalisation (SAR dB ranges differ from RGB) and with channel adaptation (1-2 pol channels vs 3 RGB).
- **SEN12MS** — paired Sentinel-1 (SAR) + Sentinel-2 (optical) + MODIS land-cover dataset for multi-modal land-cover segmentation; the standard "SAR + optical fusion" benchmark.
- **OpenSARShip** — labelled Sentinel-1 ship chips (HH+HV, VV+VH) for ship classification / detection benchmarking; the closest open analogue to commercial SATIM-grade ATR data.
- **MSTAR** — Moving and Stationary Target Acquisition and Recognition dataset of X-band SAR vehicle chips at multiple aspect angles; the canonical ATR benchmark for ground vehicles since 1996.
- **SAR-specific data augmentation** — flips and rotations that respect the radar geometry (no shears that violate range-Doppler), additive multiplicative-speckle resampling, sub-aperture decomposition; standard optical augmentations (colour jitter, RGB shifts) are nonsense on SAR.
- **ONNX export and quantisation** — exporting a trained PyTorch model to ONNX, then running it through ONNX Runtime with FP16 (mixed precision) or INT8 (post-training quantisation) for the latency / accuracy trade-off on a target GPU or edge device.
- **Domain-specific evaluation** — `PSNR / ENL / EPI` for despeckling, `mIoU / F1 per class` for segmentation, `mAP / per-incidence-angle robustness` for detection. Generic optical benchmarks (top-1 ImageNet acc) are useless on SAR.

## Common misconceptions

- *"SAR is a Doppler radar"* — it is **not**. The synthetic aperture is built from the satellite's translation along orbit (range-Doppler processing recovers azimuth resolution from Doppler history), but the imaging product is a 2-D scene, not a Doppler velocity map. Mixing up SAR with airborne pulse-Doppler radar is the most common newcomer error.
- *"Speckle is Gaussian noise — apply a Gaussian blur"* — speckle is **multiplicative** and follows Gamma / Rayleigh statistics. Gaussian blur over linear amplitude smears edges and biases means; over dB it is closer to additive but still wrong about variance. Use Lee / Frost / Refined-Lee or a despeckling CNN.
- *"SLC and GRD are interchangeable"* — SLC is per-pixel `complex64` in radar geometry; GRD is real-valued amplitude in ground range after multilooking. You can derive a GRD-equivalent from SLC, but you cannot reconstruct phase from GRD; *any* InSAR / coherence work requires SLC.
- *"`np.abs` of an SLC pixel is the calibrated backscatter"* — it is not. `|SLC|^2` is uncalibrated intensity; you need the per-product radiometric calibration LUT (or `snappy`'s `Calibration` operator) to convert to σ⁰.
- *"Pauli decomposition needs full quad-pol"* — it is defined for a quad-pol scattering matrix. Sentinel-1 is **dual-pol**, not quad-pol; you can do a 2-channel "dual-pol composite" (e.g. `[VV, VH, VV/VH]`) but it is **not** a Pauli RGB. Calling a `[VV, VH, VV-VH]` triplet "Pauli" is wrong and will confuse a SATIM reviewer.
- *"Multilooking is just downsampling"* — it averages **intensity** within an `Nr × Na` window before resampling; the ENL of the result is `Nr · Na` for independent looks. Pixel-skipping or bilinear resampling on SLC does *not* multilook.
- *"ENL is computed on the whole scene"* — ENL is defined over a **homogeneous patch** (calm sea, runway, bare field). Computing it on a heterogeneous scene mixes scene variance with speckle variance and gives a useless number.
- *"Refined Lee always beats plain Lee"* — Refined Lee is better at preserving edges in textured regions but can introduce directional bias in homogeneous water; the right answer depends on the downstream task.
- *"Terrain correction is just resampling"* — Range-Doppler terrain correction needs a DEM and the orbit state vectors to relate radar geometry pixels to ground-projected coordinates; ignoring relief gives layover/foreshortening artefacts that survive into the ML pipeline.
- *"You can train an optical detector on SAR by changing the data loader"* — image statistics (dynamic range, edge structure, texture statistics) are wildly different. Without speckle-aware augmentation, dB normalisation, and (often) a SAR-specific backbone or fine-tuning recipe, the model will memorise speckle and not generalise across incidence angles.
- *"ImageNet weights are useless on SAR"* — the *opposite* common error. Low-level edge / blob filters transfer; what fails is the fully-connected head and the input normalisation. Initialising the backbone from ImageNet and re-training the head with SAR-appropriate normalisation is a strong baseline.
- *"PSNR on a despeckled SAR image tells you everything"* — PSNR rewards over-smoothing. Always report ENL **and** an edge-preservation index (EPI) alongside PSNR, and inspect the residual for structural bleed.
- *"INT8 quantisation always loses meaningful mAP"* — for many ATR detectors the post-training INT8 mAP drop on ImageNet-style tasks is < 1 point on COCO; SAR detectors with narrow dynamic range can be **more** quantisation-friendly than RGB ones, not less. Measure on your validation set.
- *"OpenSARShip and MSTAR are the same kind of benchmark"* — OpenSARShip is C-band (Sentinel-1) at ~10 m resolution over ports; MSTAR is X-band (HH-pol) airborne SAR at ~0.3 m over vehicles. Models trained on one **do not** transfer to the other without significant adaptation.
- *"InSAR coherence and change detection are the same thing"* — coherence measures phase stability between two SLCs (decorrelates with surface change); log-ratio measures amplitude change. They answer different questions and are often combined, not substituted.
- *"`asf_search` and `sentinelsat` give the same data"* — they index overlapping but not identical Sentinel-1 catalogues; ASF tends to be more reliable for HD-class users from outside Europe; Copernicus / `sentinelsat` is canonical inside the ESA ecosystem. Prefer `asf_search` first; fall back to Copernicus.

## Suggested ordering

1. **Module 1 — Fundamenty SAR i pre-processing dla ML (4 lekcje)**: opens with the radar-physics + geometry + product-format lesson that grounds every later step (range/azimuth, SLC vs GRD, dual-pol, Pauli intuition). Lesson 2 makes speckle concrete with a real Sentinel-1 patch and runs the four classical filters head-to-head. Lessons 3–4 are the "actually run a pipeline" pair: download a scene with `asf_search`/`sentinelsat`, calibrate to σ⁰ in `snappy` with `xarray-sentinel` indexing, then geocode with terrain correction so the result is georeferenced and ML-ready.
2. **Module 2 — Klasyczne baseline'y i feature engineering (3 lekcje)**: the baselines a deep model has to beat. GLCM / Haralick / LBP for texture-driven land-cover, CFAR + morphology for ship detection, and InSAR coherence + log-ratio change detection for the temporal axis. Each lesson ends with a clear "this is your baseline mAP / F1 / ROC; deep learning has to beat this" framing.
3. **Module 3 — Deep learning, ATR i produkcyjna inferencja (5 lekcji)**: where the user spends most of their time. Despeckling CNNs (ID-CNN + SAR-DRN supervised + Speckle2Void self-supervised in one tightly-scoped lesson). Semantic segmentation on SEN12MS with a SAR+optical U-Net and ImageNet transfer. ATR proper — YOLOv8 fine-tuned on OpenSARShip for ship detection plus a MSTAR vehicle classifier with SAR-specific augmentation. ONNX + FP16/INT8 + domain-specific evaluation as a single production-readiness lesson. Capstone: a CLI that takes a raw Sentinel-1 GRD and emits detections + classifications + a per-class report tied back to the SATIM job description.

Within each module, lessons follow concept → mechanism → PyTorch / library API → exercise. Module 1 leans theory (the user has *no* SAR background and needs the physics scaffolding); Module 2 leans hands-on (these are baselines, not derivations); Module 3 alternates: each lesson opens with a 5-minute architecture-intuition Theory section, then spends most of its budget on training / inference code.

## Notes for lesson generation

The widget reference is `docs/widgets.md`. Recommendations below match the registered widget types; do not invent new ones.

**Theory placement.**

- Open every lesson with one Theory section that frames the concept, motivates it relative to a previous lesson, and points forward.
- Use KaTeX (`$...$`, `$$...$$`) for the genuinely-mathematical lessons: range-Doppler equation and azimuth resolution, speckle PDF (Gamma / Rayleigh), ENL definition, multilook variance reduction, Lee filter weighting, GLCM definitions and Haralick contrast/energy formulas, CFAR threshold for Gaussian / Rayleigh clutter, log-ratio statistics, blind-spot loss for Speckle2Void, focal-loss / IoU equations.
- Avoid math-padding the deployment lesson (Module 3 lesson 4) — ONNX/FP16/INT8 is mostly mechanics with one small precision-vs-latency table.
- Inline images (`![alt](url)`) are encouraged for any Theory section over ~300 characters of prose, especially radar geometry diagrams in Module 1 lesson 1 and U-Net architecture diagrams in Module 3 lesson 2.

**PlotImage vs Histogram.**

- Use **PlotImage** when the figure has quantitative axes — backscatter dB histogram of a Sentinel-1 patch with axis labels in dB, ENL vs filter-window-size curve, training-loss curves, mAP-vs-confidence curves, FP16 vs INT8 latency bars. Always include axis labels with units, ticks, and a caption "Figure N. …".
- Use **Histogram** when the figure *is* the bar-chart distribution — speckle intensity histogram of a homogeneous water patch matched against a Gamma fit, GLCM contrast histogram per class, per-class detection-count distribution.
- Do **not** use PlotImage for radar-geometry sketches, U-Net layer diagrams, or pipeline flowcharts — those belong in a Theory inline image.

**Demo widget.**

- Currently only `demoType: "gauss"` is registered. **Skip the Demo widget entirely in this course** — Gaussian blur on SAR is a misconception (see Common misconceptions). Use ParametricExplorer for any "interactive" idea instead.

**ParametricExplorer (live Pyodide).**

- Strong fit for: Lee / Frost / Refined-Lee window-size and damping sliders; ENL-vs-window-size curve; CFAR guard-cell / training-cell / Pfa thresholds; log-ratio change-detection threshold; GLCM offset distance and angle; Pauli RGB stretch parameters; multilook factors `(Nr, Na)` vs ENL.
- Not a fit for anything that requires PyTorch / CUDA / SNAP — Pyodide cannot run those. Pyodide-side: NumPy + `scipy.ndimage` + `scikit-image` only. PyTorch demos go in Code or Sandbox sections that the learner runs locally.
- One ParametricExplorer per lesson at most.

**Code (graded Python).**

- Best in mechanism-heavy lessons: implement a Lee filter inner loop in NumPy, write the GLCM computation by hand for a 4×4 grid, implement the log-ratio change-detection statistic, implement the blind-spot mask for Speckle2Void, write the dB-aware normalisation transform for a PyTorch `Dataset`.
- Tests: 2–4 per exercise; default `hidden: true`; one visible smoke test (`hidden: false`) is fine. Always populate `solution`.
- For PyTorch lessons in Module 3, prefer a small *focused* Code exercise (e.g. "complete this `forward()` for a 4-block residual despeckler") over a from-scratch training loop — Pyodide cannot import `torch`, so any Code section must run on NumPy only. Heavy training goes in a non-graded narrated walkthrough inside Theory + PlotImage.

**CodeCloze (fill-in-the-blank).**

- Use as a gentler alternative to Code when the algorithm is short and the learner just needs to plug in the right call: `asf_search.search(...)`, `rasterio.open(...).read(1)`, `cv2.filter2D(...)`, `skimage.feature.graycomatrix(...)`, `torch.nn.Conv2d(...)`, `torch.onnx.export(...)`. Validation: `oneOf` if multiple equivalent calls work, `exact` if only one is correct.

**DragMatch.**

- Excellent for vocabulary-heavy lessons in Module 1: SAR product ↔ definition (SLC / GRD / OCN / GRDM); polarisation pair ↔ what it measures; speckle filter ↔ underlying assumption; Pauli channel ↔ scattering mechanism; pre-processing step ↔ stage in the pipeline (calibrate / multilook / filter / terrain-correct / geocode).

**DataTable.**

- Reach for it when comparing parameter ranges or operator behaviour: Sentinel-1 product modes (IW / EW / SM / WV) with their resolutions and revisit times; speckle filters head-to-head (window size, edge preservation, ENL gain); SAR datasets (MSTAR / OpenSARShip / SEN12MS / BigEarthNet) with size / classes / sensor / band; ONNX-Runtime providers with throughput on a typical GPU.

**Sandbox (open-ended Pyodide).**

- Use as the closer for hands-on lessons: invite the learner to swap CFAR `Pfa`, change the GLCM offset, try a different log-ratio threshold, or play with multilook factors. No grading gate.

**Quiz.**

- Distractors should come from the *Common misconceptions* list above. Every lesson with a non-trivial concept ends with one. `multiSelect: true` is appropriate for "which of the following are true about Sentinel-1 SLC products" — false otherwise.

**Video.**

- Sparingly. Two strong moments: (a) ESA Copernicus's official Sentinel-1 SAR introduction in Module 1 lesson 1 to anchor the geometry intuition, (b) a Computerphile or 3Blue1Brown style explainer on convolutional / U-Net architectures in Module 3 lesson 2 if the learner wants a visual recap. Never rely on a video for the core argument of a lesson.

**Custom.**

- Do not ship a lesson whose teaching point depends on a Custom section. Custom is a TODO marker only.

**Hands-on density (theoryPracticeRatio = 0.62).**

- The 0.62 ratio leans theory. Each lesson: 1 Theory (substantial — often 2 chained Theory sections separated by a hands-on widget) + 2–3 hands-on widgets (Code / CodeCloze / ParametricExplorer / Sandbox / DragMatch) + 1 Quiz. Module 1 leans further toward Theory (2 Theory + 2 hands-on); Module 3 lessons 3 and 5 lean further toward Code (1 Theory + 3 hands-on).

**Math depth (Q7 — działajace modele DL i insight z danych).**

- Derive the synthetic-aperture / azimuth-resolution relation in Module 1 lesson 1 once, with one numerical worked example.
- Derive the Gamma PDF for `L`-look intensity speckle and the ENL formula in Module 1 lesson 2.
- State (without re-deriving) the Lee filter weighting in Module 1 lesson 2 and ground it with a numerical example on a simulated 1-look patch.
- Derive the GLCM normalisation and the contrast / energy formulas in Module 2 lesson 1.
- Derive the CFAR threshold for Rayleigh clutter and the Pfa relation in Module 2 lesson 2.
- State (without re-deriving) the focal loss and IoU formulas in Module 3 lesson 3.
- Skip the maths in the deployment lesson (Module 3 lesson 4) — give a quantisation accuracy/latency table instead.
- The capstone (Module 3 lesson 5) re-uses earlier maths; do not re-derive anything.

**Dataset and tooling specifics.**

- Use a small Sentinel-1 GRD subset (e.g. a 2048 × 2048 patch around the Port of Gdańsk or the Persian Gulf) as the running dataset for Modules 1–2. Do **not** ship multi-GB SLC products; either link to ASF DAAC for download or include a pre-cropped sample under `/courses/<slug>/lessons/.../assets/`.
- For the InSAR / coherence lesson (Module 2 lesson 3) use a *pre-computed* coherence map; do not require the learner to run `snappy`'s coregistration locally — that takes too long for a lesson and SNAP install issues are a known dropout point.
- For Module 3 datasets, prefer the smallest sufficient subset: ~500 OpenSARShip chips, ~3000 MSTAR chips, ~2000 SEN12MS tiles — each fits in a Colab session and trains in < 30 minutes on a single 8 GB GPU.
- Library hand-off pattern: `asf_search` to download → `snappy` (or `xarray-sentinel` + `sarpy`) to read and calibrate → NumPy / `rasterio` for IO and tiling → `cv2` / `scikit-image` for classical filtering → PyTorch for DL → `onnxruntime` for inference. The course covers all five hand-offs but never asks the learner to debug a SNAP install — SNAP is *one* lesson and the rest is `xarray-sentinel` + pre-cropped data.
- All speckle-filter code runs in **linear amplitude / intensity**; convert to dB *after* filtering, for visualisation only.

**Production-readiness specifics (Q10).**

- Module 3 lesson 4 (`Optymalizacja inferencji`): export a YOLOv8 detector from Module 3 lesson 3 to ONNX, then walk FP16 and INT8 quantisation, measure latency on a Colab T4 / local RTX, and tabulate mAP vs latency. Include the Pythonic gotchas: dynamic axes, batching, opset version pinning. Mention TensorRT only as further reading — do not require a TensorRT install.
- Domain-specific evaluation in the same lesson: PSNR / ENL / EPI for the despeckler, mIoU / per-class F1 for the segmentation model, mAP@0.5 + per-incidence-angle robustness curve for the detector. Show the evaluation report as a JSON-driven dashboard the learner can adapt to their own model.

**Capstone specifics (Module 3 lesson 5).**

- Build a **single** CLI script `python sar_atr.py --scene path/to/S1*.zip --out report.json` that:
  1. Reads the GRD via `xarray-sentinel` or `rasterio`.
  2. Calibrates to σ⁰, multilooks if needed.
  3. Runs the despeckler trained in Module 3 lesson 1.
  4. Runs the YOLOv8 detector trained in Module 3 lesson 3 (ONNX + FP16 from lesson 4).
  5. Emits a per-detection JSON record `{class, score, lat, lon, bbox_pixels}` plus a top-level summary.
- Tie the closing reflection back to the SATIM job spec — one paragraph mapping each pipeline stage to a bullet on the published role description.
- Do **not** require a successful end-to-end run inside Pyodide. The capstone is a **read-and-walk-through** lesson with one scaffolding Code section the learner runs *locally*; the CodeCloze and Quiz sections do the in-page grading.

**Sources usage.**

- The bibliography in `sources.md` is grouped by lesson title. When `generate_lesson` populates `lesson.sources`, it copies ≥ 3 entries from the matching `## <Lesson title>` block (plus, optionally, course-wide references). If a lesson is renamed in `course.json`, update the corresponding `sources.md` heading too — that is how the resolver finds the right section.
