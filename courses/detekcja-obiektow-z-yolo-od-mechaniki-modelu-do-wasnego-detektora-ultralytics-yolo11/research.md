# Research: Detekcja obiektów z YOLO — od mechaniki modelu do własnego detektora (Ultralytics YOLO11)

> Working memory for the `design_course` and `generate_lesson` skills. Course language is **Polish**, with English technical terms kept in English where that is the industry standard (the learner explicitly asked for this). This file is written in English for agent legibility; the *lesson prose itself* must be authored in Polish.

## Topic summary

This is an **advanced**, **standard-duration** (8–12 lessons; the draft has 4 modules / 13 lessons, slightly over — `design_course` may merge/trim) course on **one-stage object detection** with the modern Ultralytics YOLO family (**YOLO11** as the lead version, YOLOv8 as the closely-related reference point, RT-DETR as a single comparison touchpoint). The learner already knows Python, CNNs, and PyTorch training, so the course does **not** teach ML from scratch — it teaches what is *specific to single-shot detection and specifically to YOLO*. The stated tone is "why it works," not "which function to call."

The `theoryPracticeRatio` is **0.5**: roughly half the course is hands-on Python, half is model mechanics and theory. The narrative spine is: detection vs other vision tasks → why YOLO is fast → the backbone→neck→head decomposition → the input/output mechanics (preprocessing, raw grid decode, NMS) → the special machinery (loss functions, label assignment, augmentations) → the dataset format → end-to-end training, evaluation, and export in Ultralytics.

The concrete project domain (from clarifications) is a **small vehicle/ship detector** trained on a **local GPU**. The learner has **no data of their own** and wants to learn the full pipeline including how to obtain/annotate/convert a small dataset. They prioritise **speed / real-time** over maximum accuracy (this is for learning, not deployment), so exercises should lean toward the smaller models (YOLO11n / YOLO11s) and the lighter end of the dataset-size spectrum. They want to use Ultralytics **at the API/user level**, not modify its internals (no custom loss/head source hacking). They work on **images**, not video/tracking. They want **one** lesson/module that contrasts YOLO with RT-DETR / two-stage detectors at the conceptual level. They want to move through the course **quickly**, so practical tasks should be tight and illustrative rather than large multi-hour projects.

## Prerequisites

- Comfortable Python: functions, NumPy arrays, list/dict manipulation, reading/writing files.
- Convolutional neural networks: convolution, pooling, stride, receptive field, feature maps/channels, what a "backbone" is.
- PyTorch training basics: tensors, a forward/backward pass, optimizers, learning rate, epochs, batches, loss functions, transfer learning / fine-tuning from pretrained weights.
- Basic image representation: an image as an `H×W×C` array, pixel intensity, channels, normalization.
- A working local GPU + CUDA-capable PyTorch install for the heavy training lessons (narrative will assume this; in-widget code exercises must NOT depend on a GPU — see Notes).
- Familiarity with the idea of train/val/test splits and overfitting (will be applied, not re-taught).

## Key concepts

- **Object detection**: predicting a set of (bounding box, class, confidence) triples for an image — distinct from classification (one label per image) and segmentation (per-pixel labels).
- **One-stage / single-shot detector**: predicts boxes and classes in a single forward pass over a dense grid, with no separate region-proposal stage — the source of YOLO's speed.
- **Two-stage detector** (e.g. Faster R-CNN): a region-proposal network first proposes candidate regions, then a second head classifies/refines them — more accurate historically, slower.
- **Backbone**: the CNN feature extractor (e.g. CSP-based) that turns the image into multi-scale feature maps.
- **Neck (FPN / PAN)**: fuses features across scales (top-down FPN + bottom-up PAN path) so small and large objects are both well-represented.
- **Head**: the detection layers that emit, per grid cell / per scale, the box geometry, objectness, and class scores.
- **Anchor-based vs anchor-free**: anchor-based heads regress offsets relative to predefined anchor boxes; anchor-free heads (modern YOLOv8/YOLO11) predict box geometry directly per location, removing anchor hyperparameters.
- **Decoupled head**: separate convolutional branches for classification and box regression instead of one shared branch — improves both accuracy and convergence.
- **Letterbox / preprocessing**: resize-with-padding to a square (e.g. 640×640) preserving aspect ratio, plus normalization and batching — the exact transform that maps a raw image to model input.
- **Raw output grid → detections**: the model emits a dense tensor of candidate boxes (center/size or distribution form) + class logits; decoding + confidence thresholding + NMS turns it into the final sparse detection list.
- **Objectness / confidence**: a score for "is there an object here," combined with class probability to rank predictions.
- **NMS (Non-Maximum Suppression)**: greedy suppression of overlapping boxes by IoU so each object yields one box; variants include Soft-NMS.
- **IoU (Intersection over Union)** and its losses (**GIoU/DIoU/CIoU**): overlap-based box-regression objectives; CIoU adds center-distance + aspect-ratio terms.
- **DFL (Distribution Focal Loss)**: models each box edge as a discrete distribution over offsets rather than a single regressed value — the box-regression loss used in modern YOLO.
- **Classification loss / objectness loss**: BCE-style losses for class scores and (where present) object presence.
- **Label assignment (TaskAligned Assigner / TAL)**: the rule deciding, during training, *which* predictions are responsible for *which* ground-truth object — dynamic, alignment-aware assignment replaced static IoU-threshold assignment.
- **YOLO dataset format**: an image directory + parallel `.txt` label files (one row per object: `class cx cy w h`, all box values **normalized to [0,1]**), plus a `data.yaml` declaring paths, class count `nc`, and class `names`.
- **COCO / Pascal VOC formats**: the two common source annotation formats (COCO JSON with absolute pixel boxes `x,y,w,h`; VOC XML with `xmin,ymin,xmax,ymax`) that must be converted to YOLO normalized format.
- **Mosaic / MixUp / Copy-Paste augmentations**: YOLO-typical training-time augmentations that synthesise harder, more varied training images.
- **Transfer learning / fine-tuning**: starting from COCO-pretrained weights and adapting to the small custom dataset — the standard, fast way to train a good detector on little data.
- **Metrics — precision, recall, mAP@0.5, mAP@0.5:0.95, PR curve**: detection-quality measures; mAP@0.5:0.95 (COCO-style, averaged over IoU thresholds) is the headline number.
- **Export (ONNX / TensorRT)**: serializing the trained model to a portable/optimized runtime format for inference.

## Common misconceptions

- **"YOLO looks at the image only once" means it does a single convolution / one box per image.** — No: it means a single forward pass with no separate proposal stage. It still predicts thousands of candidate boxes densely across a multi-scale grid; "once" refers to the *pass*, not the number of predictions.
- **One-stage is always worse than two-stage.** — That was the early trade-off; modern one-stage detectors (YOLOv8/YOLO11, RT-DETR) are competitive on accuracy *and* far faster. The gap has largely closed.
- **Modern YOLO still uses anchor boxes.** — YOLOv8 and YOLO11 are **anchor-free**; the anchor-box k-means clustering step from YOLOv3/v4/v5 is gone. Citing anchors as a current YOLO11 feature is wrong.
- **NMS is part of the network / is trained.** — NMS is a deterministic post-processing step applied to the raw outputs at inference; it has no learned parameters (it is also typically not applied during the loss computation).
- **Bounding-box coordinates in YOLO label files are pixels.** — They are **normalized** to `[0,1]` by image width/height, and stored as **center-x, center-y, width, height**, not corner coordinates. Mixing this up (or using `xmin,ymin,xmax,ymax`) is the single most common dataset bug.
- **mAP@0.5 is "the" accuracy.** — It is a lenient single-threshold metric; the COCO-standard headline is **mAP@0.5:0.95** (averaged over IoU 0.5→0.95). A model can look great at 0.5 and poor under strict localization.
- **Confidence threshold and NMS IoU threshold are the same knob.** — They are independent: the confidence threshold filters low-scoring boxes *before* NMS; the IoU threshold controls how aggressively NMS merges overlapping survivors.
- **More augmentation is always better.** — Mosaic/MixUp help mid-training but are typically **disabled in the final epochs** (`close_mosaic`) because they distort object statistics; leaving them on to the end can hurt.
- **You need a huge dataset and from-scratch training.** — For a small custom detector, transfer learning from COCO-pretrained weights on a few hundred well-annotated images is the right, fast approach.
- **mAP up + loss down always means a better model.** — Without a held-out val split and awareness of the train/val gap, falling loss can be overfitting; the PR/val curves, not training loss, judge quality.

## Suggested ordering

The draft's four-module order is sound for an advanced learner and matches the "mechanics first, then build" arc. Suggested ordering with rationale:

1. **Fundamenty detekcji i intuicja YOLO** (detection vs classification vs segmentation → why "look once" → backbone/neck/head): establishes the problem framing and the architectural vocabulary every later lesson reuses. Comes first because you can't discuss input/output or losses without the head/neck/backbone mental model.
2. **Mechanika modelu: input, output, straty** (anchor-free/decoupled head → INPUT preprocessing → OUTPUT decode + NMS → losses + label assignment): the conceptual heart. Order *within* the module matters — preprocessing (what goes in) before output decode (what comes out) before losses/assignment (how it learns), because the loss lesson references the output tensor shape established in the OUTPUT lesson.
3. **Dane do treningu YOLO** (dataset format + data.yaml → annotation/conversion → augmentations): now that the learner knows what the model consumes/produces, teach how to feed it. Format before annotation before augmentation is the natural data-pipeline order. Placed before training because training needs a dataset on disk.
4. **Trening, ewaluacja i wdrożenie w Ultralytics** (train on local GPU → metrics/curves → inference + export): the capstone that puts everything together end-to-end. Metrics come right after training (you read them off the run), export last.

Optional RT-DETR / two-stage comparison (the learner asked for one lesson/module): best slotted either as a short lesson at the **end of Module 1** (after the "look once" intuition, to contrast one- vs two-stage and transformer-based detection) or as a standalone short closing aside. `design_course` decides; keep it conceptual, not an experiment.

## Notes for lesson generation

**Theory/practice balance.** Target ~0.5. Pair conceptual lessons with a tight hands-on or interactive section; pair hands-on lessons with enough theory to justify the code. Keep practical tasks small (the learner wants to move fast).

**Critical runtime constraint for `code` / `sandbox` widgets.** The in-widget code runs in the project's IPython kernel (a provisioned venv with numpy/opencv/torch available) — **but it is CPU-bound and not a place to actually train a YOLO model on a GPU.** Do NOT write graded exercises that call `model.train(...)`, download large datasets, or fine-tune on a GPU — those belong in the **narrative** (Theory sections + screenshots/figures of real runs, terminal-log snippets). Code exercises must be fast, deterministic, CPU-only, and self-contained. Good candidates:
- Implementing/verifying **IoU** between two boxes (numeric `code` exercise — perfect, no media needed).
- Implementing a basic **NMS** loop and asserting it suppresses overlapping boxes.
- Converting **VOC `xmin,ymin,xmax,ymax` (pixels) → YOLO `cx,cy,w,h` (normalized)** and back — directly attacks the #1 dataset misconception.
- **Letterbox** preprocessing: resize-with-padding to 640×640 preserving aspect ratio, returning the scale + pad offsets (numeric assertions on output shape and a known box's new coordinates).
- **Decoding** a small synthetic raw-output tensor into boxes + scores, then applying confidence threshold + NMS.
- Computing **precision/recall** (and a single mAP point) from a tiny set of predictions vs ground truth with a given IoU threshold.
- Parsing a YOLO label `.txt` line / validating a `data.yaml` structure.

**Where a Code exercise beats a Quiz.** Anything mechanical and verifiable: IoU, NMS, the coordinate conversion, letterbox math, PR computation. These are far more illuminating done by hand than asked about.

**Where a Quiz fits.** Conceptual checks where the misconceptions above are the distractors: "what does 'look once' actually mean," "are YOLO11 anchors involved," "is NMS trained," "is the label box in pixels or normalized," "which metric is the strict one." Draw distractors straight from the Common misconceptions list.

**ParametricExplorer (live Pyodide) candidates.** Strong fit for building intuition with sliders:
- **NMS IoU-threshold slider** + **confidence-threshold slider** over a fixed synthetic set of boxes → show how the surviving box set changes (outputType `plot`, draw boxes with matplotlib). Directly disentangles the two thresholds (misconception).
- **IoU explorer**: two draggable-via-sliders boxes → live IoU value + overlap visual (`both`).
- **Letterbox explorer**: input aspect-ratio slider → show the padded 640×640 result and pad bars.
- **CIoU vs IoU/GIoU/DIoU** term contribution as overlap/center-distance vary (advanced; `value` or `both`). Note: ParametricExplorer runs in Pyodide (numpy + matplotlib), NOT the torch kernel — keep these pure-numpy/matplotlib, no torch.

**PlotImage candidates (pre-rendered matplotlib PNGs with real axes/labels).** PR curves, the precision/recall vs confidence curves, a mAP-vs-IoU-threshold curve, a training-loss/metric curve (mimicking Ultralytics `results.png`), a precision/recall confusion-style chart. Use these in the metrics lesson — the figure carries quantitative axes, so PlotImage (not Histogram) is correct.

**DataTable candidates.** Comparison/reference tables: YOLO11 model variants (n/s/m/l/x) with params / mAP / speed; one-stage vs two-stage vs RT-DETR trade-off table; COCO vs VOC vs YOLO annotation-format comparison (coordinate convention, file type, normalization); augmentation cheat-sheet (mosaic/mixup/copy-paste — what each does, when to disable). Static lookup, sortable.

**DragMatch candidates.** Match **component → role** (backbone/neck/head → feature extraction / multi-scale fusion / prediction); match **loss term → what it supervises** (CIoU/DFL → box, BCE → class, objectness); match **annotation format → its box convention**. Good low-stakes conceptual reinforcement.

**Demo widget.** The only registered `demoType` is `gauss` (Gaussian blur) — **not relevant to this course**; do not use Demo here.

**Sandbox candidates.** Close hands-on lessons with a no-grade playground: tweak the NMS/confidence thresholds on the synthetic boxes, tweak letterbox target size, tweak augmentation parameters on a sample image (numpy/opencv). Keep CPU-only and fast.

**Video.** Use sparingly. A single well-chosen explainer (e.g. an Ultralytics or reputable channel walkthrough) can anchor the "why look once" or architecture lesson, but prefer text + inline figures the learner can scan. Cite official YouTube channels only.

**KaTeX / math.** Appropriate and expected for: IoU/GIoU/DIoU/CIoU formulas, the box-normalization equations (`cx = x_center / W`, etc.), the letterbox scale/pad equations, precision/recall/AP definitions, the DFL distribution form, and the objectness×class confidence product. This is an advanced audience — derive, don't hand-wave.

**Models & versions.** Lead with **YOLO11** (Ultralytics, 2024) as the primary; reference YOLOv8 as the immediate predecessor sharing the anchor-free decoupled-head design; mention YOLOv5→v8→v11 evolution only as much as needed for the anchor-free / decoupled-head story. Use the **n/s** variants in all examples (learner wants speed + small local GPU). When discussing RT-DETR, frame it as the transformer-based, NMS-free contrast point — one lesson, conceptual.

**Domain examples.** Use vehicles/ships consistently in examples, sample label files, `data.yaml` (`names: [car, truck, ship, ...]`), and figures, matching the learner's chosen project. Keep the dataset framing small (a few hundred images).
