# Research: SAR dla inżyniera Computer Vision: od piksela echa do detektora statków i samolotów

> **Audience override (binding).** The learner is a *senior Computer Vision engineer* — fluent in Python/PyTorch/OpenCV, very comfortable with RGB/RAW pixels — but **weak at physics and formal maths**. Book definitions and bare formulas do not land. Every physical concept must be introduced *intuition-first* (one plain-language sentence or analogy **before** the technical term), bridged to something he already knows from optical CV ("in RGB you have X; in SAR the counterpart is Y; watch out, because Z breaks here"), and framed as "what this means for your pixels and your model" before any mechanics. Formulas appear **only** when genuinely load-bearing, and when they do, **every** symbol — including ∑, θ, indices, operators — gets a plain-language gloss + unit + a typical numeric value, right under the formula. Physics is a black box with good intuition: he must know *what the data means and how to react in code/model*, not how to derive the radar equation. These rules come straight from `course-spec.json` and outrank the generator's default formula-happy style.

## Topic summary

This is a career-conversion course, not a remote-sensing degree. The learner already knows how to build detectors, segmenters and classifiers on optical imagery; the gap is the *input domain*. SAR (Synthetic Aperture Radar) imagery looks superficially like a grayscale photo but is produced by a completely different physical process — an active microwave sensor that emits its own pulses and measures the **echo strength** bouncing back. A SAR pixel is not "how bright the scene was" but "how much of my radar pulse this patch of ground reflected straight back to me." That single shift — reflected energy instead of ambient light — explains almost everything that feels alien about SAR: the grainy speckle, the way metal ships and aircraft glow against dark water, the geometric distortions over tall structures, the day/night/all-weather capability, and why an ImageNet-pretrained backbone often falls apart on it.

The concrete career target is **SATIM** (Kraków), which does automatic target recognition (ATR) — detection and classification of **ships and aircraft** (the learner's stated priority), plus vehicles, on SAR scenes from Sentinel-1, ICEYE, Capella and Synspective, in near-real-time. SATIM's flagship technique for finding ships against sea is **CFAR** (Constant False Alarm Rate) — an adaptive-threshold detector — followed by a CNN classifier on the detected chips. The course therefore weights CFAR-plus-classifier heavily over end-to-end YOLO/DETR (per clarifications q3, q1, q7), treats despeckling as a standalone topic as well as a preprocessing concern (q6), and keeps ONNX/near-real-time deployment to a single light production lesson (q5).

The course is **intermediate**, **standard** length (12 lessons across 6 modules, ~3 hours of focused study), with a **0.5 theory/practice ratio** — half intuition+visualisation, half hands-on. Crucially, *all* hands-on work runs **in the browser** (clarification q4): runnable widgets must use only `numpy` / `opencv-python` / `scikit-image` / `scipy` / `matplotlib` over Pyodide. Heavy work — PyTorch/TensorFlow training, ESA SNAP/`snappy` preprocessing, scene downloads — is shown as **reference code in Theory blocks**, never as a runnable widget. Every lesson must carry **at least one interactive widget with real input/output** built on **genuine SAR tiles** (Sentinel-1 VV/VH crops, MSTAR/OpenSARShip chips, optical+SAR pairs) staged into `/inputs/` at course-build time — no network fetches at widget runtime.

The spine of the course is the journey of a single pixel: *what a SAR pixel physically is* → *what lives inside the data (amplitude, phase, speckle, polarisation, calibration)* → *how to turn a raw scene into model-ready tiles* → *classical detection (CFAR) and features* → *AI on SAR (detection, transfer learning, classification)* → *evaluation + a capstone ship/aircraft pipeline that maps 1:1 onto the SATIM role*.

## Prerequisites

- **Confident Python + NumPy** — array slicing, broadcasting, dtypes; the learner has this.
- **OpenCV / scikit-image basics** — reading images, thresholding, morphology, convolution/filtering. He has this from optical CV.
- **PyTorch fluency for the AI lessons** — building/loading a CNN, transfer learning, a training loop. He has this; the SAR-specific *adaptations* are what's new.
- **Comfort with the idea of a grayscale 2-D array as an image** — single-channel intensity, not RGB.
- **No physics, no signal-processing maths assumed.** Fourier/FFT, phase, interference, Doppler, complex numbers, polarisation, dB — all are introduced from zero with analogies. Do **not** assume he remembers what ∑ or θ mean in a given formula.
- **Helpful but optional:** any prior exposure to remote sensing (he has *none* — clarification q2 confirms zero hands-on SAR), basic stats (mean/variance/distribution shape).

## Key concepts

- **SAR (Synthetic Aperture Radar):** an active radar that flies along and synthesises a huge virtual antenna from many pulses, giving fine resolution; it lights the scene with its own microwaves.
- **Active vs passive sensing:** SAR brings its own "flashlight" (microwave pulses), so it works day/night and through clouds — unlike a passive optical camera that needs sunlight.
- **Backscatter:** the fraction of the emitted pulse that bounces *back toward the sensor*; this is what a SAR pixel encodes. Bright = strong echo (metal, corners, rough surfaces); dark = weak echo (calm water, smooth roads, radar shadow).
- **Range & azimuth:** the two image axes — *range* = across-track (sensor-to-ground distance direction), *azimuth* = along-track (flight direction). Replaces the "x/y of a photo."
- **Incidence angle (θ):** the angle at which the beam hits the ground; it governs how bright a surface looks and how bad the geometric distortions are.
- **Slant range vs ground range:** the radar natively measures distance *along the beam* (slant); converting to true map distance (ground range) is a geometric correction.
- **Layover / foreshortening / shadow:** geometric distortions over tall objects — the top of a tall structure can be measured as "closer" than its base (layover), slopes facing the radar get compressed (foreshortening), and the far side casts a radar shadow (zero echo).
- **Complex SAR data (SLC):** each pixel is a complex number — **amplitude** (echo strength) + **phase** (where in its wave cycle the echo returned). Amplitude is what you see; phase carries interferometry/coherence info.
- **Amplitude / intensity:** amplitude = echo magnitude; intensity = amplitude² (power). Most detection works on intensity or amplitude images.
- **Phase:** the "timing" of the returning wave within its cycle; meaningless per-pixel for a single image, but differences in phase between acquisitions or pixels carry information (coherence, InSAR).
- **Speckle:** the grainy salt-and-pepper texture inherent to SAR. It is **not** additive Gaussian sensor noise — it is a real, *multiplicative* interference pattern from many sub-scatterers in one pixel adding coherently. This distinction drives every despeckling choice.
- **ENL (Equivalent Number of Looks):** a scalar measure of how "smooth" / how speckle-suppressed an image is; higher ENL = less speckle (and usually lower resolution). The lever you trade against detail.
- **Multilooking:** averaging several independent "looks" of the same scene to cut speckle at the cost of resolution — the radar-domain analogue of downsampling-by-averaging.
- **Despeckling filters:** Lee, Frost, Refined Lee, NL-means — adaptive filters that smooth flat regions while preserving edges/point targets. Refined Lee uses directional windows; NL-means averages similar patches.
- **Polarisation (HH/HV/VV/VH):** the orientation (H/V) of the transmitted and received wave. Up to four channels ("four channels instead of RGB"); cross-pol (HV/VH) highlights volume/complex scattering (vegetation, ship superstructure).
- **Radiometric calibration — sigma0 (σ⁰) / gamma0 (γ⁰):** converting raw digital numbers into a physically meaningful, comparable backscatter coefficient; gamma0 additionally normalises for terrain slope.
- **Decibel (dB) scale:** a log scale that compresses SAR's enormous dynamic range so a ship doesn't blow out the histogram while the sea floor of values stays visible; changes what the model sees.
- **GRD vs SLC (Sentinel-1):** SLC = complex, full-resolution, phase-preserving; GRD = detected (amplitude), multilooked, ground-range-projected — the friendlier product for detection.
- **Geocoding / terrain correction (Range-Doppler):** warping the radar-geometry image onto a map grid using a DEM, so pixels line up with real coordinates.
- **GLCM / Haralick features:** texture descriptors from a gray-level co-occurrence matrix (contrast, homogeneity, energy, correlation) — classic hand-crafted features that work surprisingly well on SAR.
- **CFAR (Constant False Alarm Rate):** an adaptive-threshold detector — for each test pixel, estimate the local sea/background statistics from a ring of "background" cells (with a "guard" ring excluded) and flag the pixel if it exceeds a threshold set to hold a target false-alarm rate **Pfa**. The core of ship detection.
- **Pfa (probability of false alarm):** the knob on CFAR — lower Pfa = fewer false alarms but more missed faint ships, and vice versa.
- **Guard / background windows:** the two concentric rings around a CFAR test cell — guard excludes the target's own spill-over, background estimates the clutter level.
- **Change detection (log-ratio, coherence):** comparing two acquisitions; the **log-ratio** of intensities is the standard SAR change metric (ratios, not differences, because speckle is multiplicative); **coherence** drop also flags change.
- **ATR (Automatic Target Recognition):** the detection+classification pipeline SATIM builds — find targets, then say what they are.
- **CFAR-pre-detector + CNN-classifier:** the SATIM-style two-stage pipeline — CFAR proposes candidate chips cheaply, a small CNN classifies/rejects them.
- **Transfer learning on SAR:** reusing optical-pretrained backbones but adapting them (recalibrating early filters, normalising dB inputs, SAR-specific augmentation) because RGB statistics don't match SAR.
- **SAR-specific augmentation:** speckle-aware augmentation, target-aspect-angle rotation, multiplicative-noise jitter — *not* the photometric jitter used on RGB.
- **mAP / F1 per class / PSNR / ENL (as metrics):** detection quality (mAP, per-class F1), despeckling quality (PSNR, ENL on flat areas).
- **Data-agnostic robustness:** a model that holds up across incidence angle, season and satellite type — a SATIM evaluation priority.
- **Near-real-time inference / ONNX:** exporting the trained model and running it fast enough for operational use.
- **Reference datasets:** **OpenSARShip** & **SSDD** (Sentinel-1 ship detection/classification), **FUSAR-Ship** (Gaofen-3 ships), **MSTAR** (X-band vehicle chips — the classic ATR classification benchmark), **SAR-Ship-Dataset**.

## Common misconceptions

- **"A SAR pixel is brightness, like a grayscale photo."** — No; it is *backscattered echo strength*. A mirror-smooth lake is dark not because it's "dark-coloured" but because it reflects the pulse *away* from the sensor. Reasoning about it as albedo will mislead every intuition.
- **"Speckle is sensor noise, so denoise it like Gaussian noise (averaging / a Gaussian blur)."** — Speckle is *multiplicative coherent interference*, signal-dependent, not additive. A naïve Gaussian blur destroys resolution and point targets without respecting the statistics; you need speckle-aware filters (Lee/Frost/Refined Lee/NL-means) or multilooking.
- **"More denoising is always better."** — Despeckling trades speckle reduction (higher ENL) against edge/point-target preservation. Over-filtering erases the very ship pixels CFAR needs. The right operating point is detection-driven, not "smoothest image wins."
- **"Brighter = bigger/closer object."** — Brightness is about *geometry and material* (corner reflectors, metal, surface roughness, incidence angle), not size or distance. A small metal corner can outshine a large flat field.
- **"Phase is just noise I can throw away."** — For single-image amplitude detection you mostly ignore phase, but phase underpins coherence and change detection; "complex data" is not a quirk to discard.
- **"Polarisation channels are like RGB colour channels."** — They behave like channels you can stack, but they encode *scattering mechanism*, not colour; a "false-colour" VV/VH/ratio composite is a tool, not a literal photograph.
- **"I'll just point YOLO/ImageNet weights at SAR and fine-tune."** — Optical-pretrained features assume natural-image statistics (edges, textures, colour). SAR's multiplicative speckle, dB dynamic range, and target signatures (bright point scatterers, sidelobes) break those priors; naïve transfer underperforms without SAR-specific normalisation and augmentation.
- **"CFAR is just global thresholding."** — CFAR is *adaptive* and *local*: the threshold floats with the local clutter so the false-alarm rate stays constant across calm and rough sea. A single global threshold drowns in false alarms where the sea is rough.
- **"Layover/foreshortening are sensor glitches."** — They are deterministic consequences of side-looking range geometry; understanding them tells you *where* objects will appear displaced, which matters for georeferencing detections.
- **"dB is cosmetic."** — Moving to dB reshapes the value distribution the model trains on; it changes what counts as a "big" difference and is often essential for stable learning on SAR's huge dynamic range.

## Suggested ordering

The 6-module spec ordering is pedagogically sound; keep it. Rationale for the sequence:

1. **Module 1 — Fundamenty SAR po ludzku (Lessons 1–2):** First fix the single most important mental model — a pixel is an echo, not a colour — and the scene geometry (range/azimuth, layover/shadow). Everything downstream (why speckle exists, why ships glow, where detections land on a map) depends on these two ideas. Comes first because no amount of pipeline or AI knowledge helps if the learner still reads SAR as a photo.
2. **Module 2 — Co jest w środku danych SAR (Lessons 3–5):** Now open the pixel up — amplitude/phase, speckle (and why it's not Gaussian), despeckling filters, then polarisation + calibration + dB. This is "what the numbers in your array actually are," which must precede any processing or modelling decisions.
3. **Module 3 — Pipeline przygotowania danych (Lesson 6):** With the data understood, walk from a raw Sentinel-1 scene to a model-ready tile (GRD, multilooking, geocoding, terrain correction). Placed here so the learner knows *why* each step exists before treating tiles as model input. Heavy SNAP steps are reference code; the runnable widget operates on an already-staged tile.
4. **Module 4 — Klasyczne przetwarzanie i CFAR (Lessons 7–8):** The classical detection core — CFAR (the SATIM-critical technique) built step by step, then texture/morphology/change-detection as features and post-processing. Classical first, because CFAR is both the product baseline and the pre-detector that feeds the CNN in Module 5.
5. **Module 5 — AI na SAR pod ATR (Lessons 9–10):** Now the deep-learning core: CFAR-pre-detector + CNN classifier for ships/aircraft, then transfer learning + SAR augmentation + chip classification (MSTAR/OpenSARShip). Sits after CFAR so the two-stage pipeline is motivated, and after the data lessons so the learner understands why RGB transfer struggles.
6. **Module 6 — Ewaluacja, produkcja i capstone (Lessons 11–12):** Close with how to *measure* (mAP, per-class F1, robustness across angle/satellite, PSNR/ENL) and a near-real-time/ONNX note, then the end-to-end ship/aircraft capstone that assembles everything into the SATIM-shaped deliverable.

## Notes for lesson generation

**Global widget posture (from the spec, binding):** every lesson needs ≥1 interactive widget with real I/O on genuine SAR tiles staged in `/inputs/`. Runnable code = `numpy`/`opencv-python`/`scikit-image`/`scipy`/`matplotlib` only. Anything heavier (PyTorch/TF training, SNAP/`snappy`, scene download) = reference code inside **Theory**, never runnable. Use **ParametricExplorer** sliders *every time a parameter's effect is the point* (filter window size, CFAR Pfa/guard/background, ENL, number of looks, σ, dB scaling) — show the effect visually, never via a formula. `theoryPracticeRatio: 0.5` → roughly alternate intuition/visual sections with hands-on ones.

**Where math/KaTeX is appropriate (sparingly):** only a handful of formulas earn their place, and each needs the full per-symbol gloss (symbol → plain meaning → unit → typical value), explicitly including ∑, θ, indices, exponents:
- The **CFAR threshold** relation (Lesson 7) — `T = μ + α·σ` style, with α tied to Pfa. This one is load-bearing: it *is* the algorithm. Gloss μ (local clutter mean), σ (local clutter std), α (the Pfa-derived multiplier), and the windows.
- The **dB conversion** `10·log10(intensity)` (Lesson 5) — tiny but worth showing once, with what "10·log10" does to values (e.g. intensity 0.01 → −20 dB, 1.0 → 0 dB).
- **sigma0 vs gamma0** (Lesson 5) — show the relationship conceptually (γ⁰ = σ⁰ / cos θ), glossing θ as the incidence angle with a typical value (~30–45° for Sentinel-1), but lead with the intuition (gamma0 "removes the slope's cheating").
- **GLCM / one Haralick feature** (Lesson 8) — show *one* (e.g. contrast) with the ∑∑ spelled out as "add up over every pair of gray levels i and j," glossing i, j, P(i,j). Resist showing all 14.
- **Log-ratio** for change detection (Lesson 8) — `log(I2/I1)`, with the one-line reason "ratio not difference, because speckle is multiplicative."
- **mAP / IoU / F1** (Lesson 11) — define IoU and precision/recall plainly; mAP as "area under the precision–recall curve, averaged." Keep it operational, not measure-theoretic.
Everywhere else: prefer a sentence of intuition + a picture/widget over a formula. **No FFT/Fourier/Doppler/complex-number maths** beyond a wave analogy (two overlapping water ripples adding up = interference = speckle; the "timing in the wave cycle" = phase).

**Where a code exercise (graded `code`) beats a quiz:**
- L3/L4: implement a tiny **boxcar vs Lee** comparison and **compute ENL** on a flat patch — the contrast between naive averaging and speckle-aware filtering is felt, not told.
- L4: implement **Refined Lee or an NL-means call** on a real VV tile (scikit-image has `restoration.denoise_nl_means`); grade on ENL improvement + edge preservation.
- L7: implement **CA-CFAR** with sliding guard/background windows on a real sea+ships tile — the single most important coding lab in the course; grade that detected pixels overlap labelled ships and false-alarm count stays bounded.
- L8: compute a **GLCM contrast map** (`skimage.feature.graycomatrix`/`graycoprops`) and a **log-ratio change map**; grade shapes/dtype and a known statistic.
- L9: implement the **chip-extraction + simple feature classifier** glue (CFAR boxes → crop chips → classify with a provided lightweight model or a hand-features + logistic baseline), keeping any heavy net as reference code.

**Where a Quiz fits (intuition checks, per spec — quizzes test consequences, not formulas):**
- L1: "Why is calm water dark in SAR?" (echo reflected away, not 'dark colour').
- L3: "Speckle is best described as…" (multiplicative interference vs additive Gaussian).
- L5: "VV/VH stacked as channels are most like… / dB scaling does what to the model input?".
- L7: "Lowering Pfa does what to misses vs false alarms?".
- L9: "Why does an ImageNet-pretrained YOLO underperform on raw SAR?".

**Where a Demo / ParametricExplorer (interactive intuition) is the right call — this course should lean heavily on these:**
- L2: **incidence-angle slider** → animate how layover/foreshortening/shadow grow on a simple ridge profile (synthetic but real-geometry); ParametricExplorer over a small numpy scene.
- L3: **ENL / number-of-looks slider** on a real VV tile → watch graininess smooth out and resolution soften.
- L4: **filter-window-size slider** (and filter-type select: Lee/Frost/Refined Lee/NL-means) → before/after on a real tile, with an ENL readout.
- L5: **dB-scaling / sigma0 toggle** on a real tile → watch the histogram and visible contrast change; a VV/VH/ratio false-colour composite slider.
- L7: **Pfa slider + guard/background window-size sliders** on a real sea-with-ships tile → watch detections and false alarms trade off live. This is the centrepiece interactive of the course.
- L8: **GLCM window-size / distance / angle** sliders → texture map updates.
- L11: **IoU / confidence-threshold slider** → precision–recall and F1 move; ties metrics to a knob.

**Where a Sandbox (no grading gate) closes a lesson nicely:**
- L4: free play swapping despeckle filters + windows on the provided tile.
- L7: free CFAR parameter exploration after the graded implementation.
- L10: a sandbox that loads a few MSTAR/OpenSARShip chips and lets the learner try SAR-style augmentations (speckle jitter, aspect rotation) and eyeball them — heavy training stays reference-only.

**Where PlotImage / Histogram (static figures with axes) help:**
- Histogram of a SAR tile's intensity vs its dB transform (L5) — shows dynamic-range compression concretely.
- PlotImage of CFAR ROC-ish Pfa-vs-detections, or the precision–recall curve (L11), with properly labelled axes/units.
- PlotImage comparing optical vs SAR of the same harbour (L1) as the anchoring "this is what changes" figure.

**Where Video fits (use sparingly):** L1 or L2 could embed one short official ESA/EO-College radar explainer; otherwise prefer text+image so the learner can scan/revisit.

**Inputs to stage into `/inputs/` at build time** (the design/lesson stage should download these via the Copernicus Data Space Ecosystem creds and from the public ATR datasets; widgets must read them locally, never fetch at runtime):
- Several **Sentinel-1 GRD VV & VH crops**: a calm-sea-with-ships scene (for CFAR — ideally with AIS-derived or known ship locations), a harbour/coast scene (layover/coast clutter), a land scene (texture/GLCM), and a same-area **optical+SAR pair** (for the L1 bridge).
- A pair of **co-registered Sentinel-1 acquisitions** over the same area (for log-ratio change detection in L8).
- A handful of **MSTAR chips** (vehicle ATR classification, X-band) and **OpenSARShip/SSDD chips** (ship classification, Sentinel-1) for L9/L10/L12.
- Keep tiles small (≈256–1024 px) so Pyodide stays responsive; pre-convert SLC→amplitude/intensity offline so widgets never touch complex SNAP products.

**Bridges to optical CV to reuse throughout (the learner anchors everything to RGB):** "SAR pixel ≈ active-illumination single-channel reflectivity, not albedo"; "speckle ≈ multiplicative texture, *unlike* your additive Gaussian/ISO noise — don't reach for `cv2.GaussianBlur`"; "polarisation channels ≈ extra input channels like RGB planes, but encoding scattering not colour"; "CFAR ≈ adaptive local thresholding (think `cv2.adaptiveThreshold` but statistics-driven for a fixed false-alarm rate)"; "GLCM ≈ the hand-crafted texture features you'd reach for before CNNs"; "transfer learning caveat ≈ your ImageNet backbone's first-layer filters assume natural-image statistics that SAR violates."
