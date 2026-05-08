# Widgets reference

A single-page reference for every widget that can appear inside a lesson
section. Use it together with the lesson schema (`src/lib/schemas/lesson.ts`)
when authoring lesson JSON.

## How to use this reference

This document is consumed by the `init_course` and `generate_lesson` skills
(under `scripts/ralph/skills/`) when they author lesson JSON. Each widget
entry below lists its purpose, the key fields on `section.data`, a minimal
valid example, and links to the canonical Zod schema and sample fixture in
`src/widgets/<Name>/`.

**The Zod schemas in `src/widgets/<Name>/schema.ts` are the source of
truth.** If this document and the code disagree, trust the code — open the
schema file and follow it. This page is a curated summary, not a contract.

Every section in a lesson shares a common envelope (`id`, `title`, `type`,
`data`, optional `sources`) defined by `SectionSchema` in
`src/lib/schemas/lesson.ts`. The fields below describe only the per-widget
`data` payload — the envelope is the same for every widget.

The full list of registered widget types is in `src/widgets/registry.ts` and
the discriminated union of section variants is in
`src/lib/schemas/lesson.ts → SectionSchema`.

**The widget set is not closed.** If your lesson has a clear pedagogical
need that none of the entries below cleanly express, you may author a new
first-class widget type rather than abuse `custom`. See
[`src/widgets/README.md`](../src/widgets/README.md) for the 5-step procedure
and `generate_lesson/SKILL.md → Step 3a` for the gating criteria (a new type
must pay for itself across 2–3 future lessons; one-off content stays in
`custom`).

| Widget                | `type` literal       | Hands-on?         |
|-----------------------|----------------------|-------------------|
| Theory                | `theory`             | reading           |
| Quiz                  | `quiz`               | conceptual check  |
| Code                  | `code`               | graded coding     |
| CodeCloze             | `codeCloze`          | fill-in-the-blank |
| DataTable             | `dataTable`          | tabular reference |
| Demo                  | `demo`               | slider demo       |
| DragMatch             | `dragMatch`          | drag-and-drop     |
| Histogram             | `histogram`          | static figure     |
| ParametricExplorer    | `parametricExplorer` | live Python      |
| PlotImage             | `plotImage`          | static figure     |
| Sandbox               | `sandbox`            | free coding       |
| Video                 | `video`              | embedded video    |
| Custom                | `custom`             | escape hatch      |

---

## Theory

Markdown-rendered prose with KaTeX support. The spine of every lesson — use
it to introduce concepts, derive formulas, and frame the interactive
sections that follow. Inline images (`![alt](url)`) are encouraged for any
section longer than ~300 characters of prose.

| Field      | Type   | Required | Meaning                                              |
|------------|--------|----------|------------------------------------------------------|
| `markdown` | string | yes      | Markdown body. Supports `$inline$` / `$$block$$` math, fenced code, `:::callout{}` blocks, and inline image references. |

Minimal example:

```json
{
  "id": "intro",
  "title": "What is a convolution?",
  "type": "theory",
  "data": {
    "markdown": "A **convolution** smooths a signal by replacing each sample with a weighted average of its neighbours."
  }
}
```

Full detail: [`src/widgets/Theory/schema.ts`](../src/widgets/Theory/schema.ts)
· [`src/widgets/Theory/sample.ts`](../src/widgets/Theory/sample.ts).

---

## Quiz

Single- or multi-select multiple-choice question. Use plausible distractors
drawn from the lesson's `Common misconceptions` notes; the explanation
should justify the right answer specifically, not paraphrase the question.

| Field         | Type        | Required | Meaning                                                              |
|---------------|-------------|----------|----------------------------------------------------------------------|
| `question`    | string      | yes      | The prompt shown above the options.                                  |
| `options`     | string[]    | yes      | Answer choices. Minimum 2; aim for 3–4.                              |
| `correct`     | number[]    | yes      | Indices into `options` (0-based). At least one. Use one for single-select, ≥1 for multi. |
| `explanation` | string      | yes      | Shown after the learner submits — justify why the correct answer is correct. |
| `multiSelect` | boolean     | yes      | `false` = exactly one right answer. `true` = "select all that apply". |

Minimal example:

```json
{
  "id": "check",
  "title": "Quick check",
  "type": "quiz",
  "data": {
    "question": "Which kernel best detects vertical edges?",
    "options": [
      "A 3×3 box of all 1/9",
      "Sobel-x: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]",
      "A Gaussian kernel"
    ],
    "correct": [1],
    "explanation": "Sobel-x has positive weights on the right column and negative on the left, so it produces large magnitudes when intensity changes horizontally — i.e. across a vertical edge.",
    "multiSelect": false
  }
}
```

Full detail: [`src/widgets/Quiz/schema.ts`](../src/widgets/Quiz/schema.ts)
· [`src/widgets/Quiz/sample.ts`](../src/widgets/Quiz/sample.ts).

---

## Code

Graded Python coding exercise. Runs in-browser via Pyodide. The learner
edits `starterCode` in a CodeMirror editor and submits; the worker runs each
test body in a fresh copy of the user namespace and reports per-test
results. Tests default to hidden-with-peek (the learner can see the test
name + brief feedback, not the body).

| Field          | Type             | Required | Meaning                                                                            |
|----------------|------------------|----------|------------------------------------------------------------------------------------|
| `taskMarkdown` | string           | yes      | Brief in markdown — what function to define, sample I/O.                          |
| `starterCode`  | string           | yes      | Initial Python source. Function shell + scaffolding; never the solution.           |
| `tests`        | CodeTest[]       | yes      | 2–4 tests. Each `{ name, body, hidden? }`. `hidden` defaults to `true`.            |
| `solution`     | string           | no       | Reference implementation. Surfaced via the always-available *Peek solution* button — populate it for every shipped exercise. |
| `inputs`       | CodeInput[]      | no       | Reference artefacts shown above the editor (image / video / downloadable file / raw text). Use for image-, signal-, or file-processing exercises so the learner sees the input they're operating on. |
| `outputMedia`  | CodeOutputMedia  | no       | Single expected-output image or video, rendered alongside the editor's run output. Use it to show the learner the target their code should reproduce. Tests still verify numerically — the figure is for human reference. |

Each test has fields:

| Field    | Type    | Required | Meaning                                                              |
|----------|---------|----------|----------------------------------------------------------------------|
| `name`   | string  | yes      | Descriptive identifier (e.g. `"returns_zero_for_empty_input"`).      |
| `body`   | string  | yes      | One or two `assert` lines. Plain Python — no pytest.                 |
| `hidden` | boolean | no       | Defaults to `true`. Set `false` for a visible smoke test.            |

Each `inputs[]` entry is a discriminated union on `kind`:

| `kind`    | Required fields           | Optional fields  | Meaning                                                                  |
|-----------|---------------------------|------------------|--------------------------------------------------------------------------|
| `"image"` | `src`                     | `alt`, `caption` | Inline reference image. `src` is a URL or `/api/courses/<slug>/assets/...` path. |
| `"video"` | `src`                     | `caption`        | Inline `<video controls>` clip.                                          |
| `"file"`  | `src`, `filename`         | `caption`        | Downloadable file card (e.g. CSV, NumPy `.npy`, audio sample).           |
| `"text"`  | `content`                 | `label`          | Raw text fixture rendered in a monospace box (sample stdin, JSON, etc.). |

`outputMedia` is a single object on `kind`:

| `kind`    | Required fields | Optional fields  | Meaning                                                          |
|-----------|-----------------|------------------|------------------------------------------------------------------|
| `"image"` | `src`           | `alt`, `caption` | Expected-output image (e.g. denoised frame, thresholded mask).   |
| `"video"` | `src`           | `caption`        | Expected-output video (e.g. tracker overlay, processed clip).    |

Minimal example (numeric exercise — no media):

```json
{
  "id": "exercise",
  "title": "Box blur",
  "type": "code",
  "data": {
    "taskMarkdown": "Write a function `box_blur(values)` that returns the average of a 3-element list.",
    "starterCode": "def box_blur(values):\n    # TODO: return the average of values\n    return 0\n",
    "tests": [
      { "name": "returns_mean_for_simple_triple", "hidden": true, "body": "assert box_blur([1, 2, 3]) == 2" },
      { "name": "handles_negative_numbers", "hidden": true, "body": "assert box_blur([-3, 0, 3]) == 0" }
    ],
    "solution": "def box_blur(values):\n    return sum(values) / len(values)\n"
  }
}
```

With input + expected-output figures (image-processing exercise):

```json
{
  "id": "threshold-exercise",
  "title": "Otsu threshold",
  "type": "code",
  "data": {
    "taskMarkdown": "Write `binarise(img)` that returns a 0/255 mask using the global Otsu threshold.",
    "starterCode": "import numpy as np\n\ndef binarise(img):\n    # img: 2D uint8 array, return same-shape uint8 mask of {0, 255}\n    return img\n",
    "tests": [
      { "name": "returns_uint8_mask", "hidden": true, "body": "import numpy as np\nout = binarise(np.array([[10, 200], [30, 220]], dtype=np.uint8))\nassert out.dtype == np.uint8 and set(out.flatten().tolist()) <= {0, 255}" }
    ],
    "solution": "import numpy as np\n\ndef binarise(img):\n    hist, _ = np.histogram(img, bins=256, range=(0, 256))\n    # ... Otsu's method ...\n    return ((img > 127).astype(np.uint8) * 255)\n",
    "inputs": [
      {
        "kind": "image",
        "src": "/api/courses/opencv-w-wizji-komputerowej-od-podstaw-do-sar/assets/images/coins-grayscale.png",
        "alt": "Grayscale photograph of overlapping coins on a dark surface.",
        "caption": "Input frame — grayscale, 8-bit."
      }
    ],
    "outputMedia": {
      "kind": "image",
      "src": "/api/courses/opencv-w-wizji-komputerowej-od-podstaw-do-sar/assets/images/coins-otsu.png",
      "alt": "Binary mask separating the coins (white) from the background (black) using Otsu's threshold.",
      "caption": "Expected output — Otsu binarisation."
    }
  }
}
```

Skip `inputs` / `outputMedia` for purely numeric or algorithmic tasks — they only add visual noise when there's no artefact to look at.

Full detail: [`src/widgets/Code/schema.ts`](../src/widgets/Code/schema.ts)
· [`src/widgets/Code/sample.ts`](../src/widgets/Code/sample.ts).

---

## CodeCloze

Fill-in-the-blank code exercise. The `template` is syntax-highlighted code
with `{{slotId}}` placeholders that become inline inputs. Each slot is
validated independently (exact / regex / oneOf) and an optional set of
final Python tests run after every slot validates.

| Field          | Type                     | Required | Meaning                                                              |
|----------------|--------------------------|----------|----------------------------------------------------------------------|
| `taskMarkdown` | string                   | no       | Optional brief shown above the code.                                 |
| `language`     | `'python'` \| `'javascript'` \| `'typescript'` | no | Language for syntax highlighting. Defaults to Python visuals. |
| `template`     | string                   | yes      | Code with `{{slotId}}` placeholders. Each slot id must appear in `slots`. |
| `slots`        | CodeClozeSlot[]          | yes      | One entry per blank.                                                 |
| `finalTests`   | CodeClozeFinalTest[]     | no       | Python `assert` tests that run after every slot is filled correctly. |
| `hints`        | CodeClozeProgressiveHint[] | no     | Hints that unlock after `revealAfterAttempts` failed submissions.    |

Each slot:

| Field        | Type                  | Required | Meaning                                                              |
|--------------|-----------------------|----------|----------------------------------------------------------------------|
| `id`         | string                | yes      | Matches `{{id}}` placeholders in `template`.                         |
| `hint`       | string                | no       | One-line nudge displayed under the input.                            |
| `validation` | union (see below)     | yes      | `{ kind: 'exact', value }` \| `{ kind: 'regex', pattern }` \| `{ kind: 'oneOf', values: [...] }`. |

Minimal example:

```json
{
  "id": "fill-blanks",
  "title": "Fill in the blanks",
  "type": "codeCloze",
  "data": {
    "template": "def box_blur(values):\n    total = {{aggregator}}(values)\n    return total / {{divisor}}\n",
    "slots": [
      { "id": "aggregator", "hint": "Built-in that totals an iterable.", "validation": { "kind": "exact", "value": "sum" } },
      { "id": "divisor", "validation": { "kind": "oneOf", "values": ["len(values)", "3"] } }
    ]
  }
}
```

Full detail:
[`src/widgets/CodeCloze/schema.ts`](../src/widgets/CodeCloze/schema.ts) ·
[`src/widgets/CodeCloze/sample.ts`](../src/widgets/CodeCloze/sample.ts).

---

## DataTable

Sortable, filterable, paginated tabular reference. Use for static lookup
tables (operator comparisons, parameter ranges) — not for editable data.
Each column declares its type so sorting and filtering pick the right
comparator.

| Field         | Type                     | Required | Meaning                                                              |
|---------------|--------------------------|----------|----------------------------------------------------------------------|
| `columns`     | DataTableColumn[]        | yes      | Column descriptors. Minimum 1.                                       |
| `rows`        | object[]                 | yes      | One entry per row. Cell values are string \| number \| boolean \| null. |
| `initialSort` | `{ key, dir }`           | no       | Initial sort state. `dir` is `'asc'` \| `'desc'`.                    |
| `pageSize`    | integer                  | no       | Rows per page. Defaults to 25.                                       |

Each column:

| Field        | Type                                   | Required | Meaning                                          |
|--------------|----------------------------------------|----------|--------------------------------------------------|
| `key`        | string                                 | yes      | Property name on each row object.                |
| `label`      | string                                 | yes      | Header label.                                    |
| `type`       | `'string'` \| `'number'` \| `'boolean'` | no      | Defaults to `'string'`. Drives sort comparator.  |
| `sortable`   | boolean                                | no       | Defaults to `true`.                              |
| `filterable` | boolean                                | no       | Defaults to `false`.                             |

Minimal example:

```json
{
  "id": "scores",
  "title": "Cohort scores",
  "type": "dataTable",
  "data": {
    "columns": [
      { "key": "name", "label": "Name", "type": "string", "filterable": true },
      { "key": "score", "label": "Score", "type": "number", "filterable": true },
      { "key": "passed", "label": "Passed", "type": "boolean" }
    ],
    "rows": [
      { "name": "Ada", "score": 92, "passed": true },
      { "name": "Linus", "score": 88, "passed": true },
      { "name": "Grace", "score": 75, "passed": true }
    ]
  }
}
```

Full detail:
[`src/widgets/DataTable/schema.ts`](../src/widgets/DataTable/schema.ts) ·
[`src/widgets/DataTable/sample.ts`](../src/widgets/DataTable/sample.ts).

---

## Demo

Slider-driven visual demo. Currently the only registered `demoType` is
`gauss` (Gaussian blur over a hosted image with a σ slider). Do not invent
new `demoType` values — the registry rejects them. At most one Demo per
lesson.

| Field      | Type             | Required | Meaning                                                              |
|------------|------------------|----------|----------------------------------------------------------------------|
| `demoType` | `'gauss'`        | yes      | Currently the only registered demo. Literal — must be `"gauss"`.    |
| `imageSrc` | string           | yes      | Path to the source image (e.g. `/cameraman.jpg` under `public/`).    |
| `params`   | object           | yes      | `{ sigmaMin, sigmaMax, sigmaDefault }`. Order: min < default < max.  |

Minimal example:

```json
{
  "id": "demo",
  "title": "Gaussian blur, interactively",
  "type": "demo",
  "data": {
    "demoType": "gauss",
    "imageSrc": "/demo-images/cameraman.jpg",
    "params": { "sigmaMin": 0, "sigmaMax": 10, "sigmaDefault": 1.5 }
  }
}
```

Full detail: [`src/widgets/Demo/schema.ts`](../src/widgets/Demo/schema.ts)
· [`src/widgets/Demo/sample.ts`](../src/widgets/Demo/sample.ts).

---

## DragMatch

Drag-and-drop matching exercise. The learner drags labelled blocks from a
bank into labelled drop zones. Use for term/definition pairing, kernel/use
matching, or grouping tasks (set `multipleItemsPerZone: true` if a zone
accepts more than one item).

| Field                  | Type             | Required | Meaning                                                              |
|------------------------|------------------|----------|----------------------------------------------------------------------|
| `prompt`               | string           | yes      | Instruction shown above the bank/zones.                              |
| `items`                | DragMatchItem[]  | yes      | Draggable blocks. Each `{ id, label }`. Minimum 1.                   |
| `zones`                | DragMatchZone[]  | yes      | Drop targets. Each `{ id, label, accepts: [itemId, ...] }`. Minimum 1. |
| `multipleItemsPerZone` | boolean          | no       | Defaults to `false`. When `true`, a zone accepts more than one item; comparison is set-based, so order within the zone does not matter. |
| `requireAll`           | boolean          | no       | Defaults to `true`. When `false`, items not referenced by any zone's `accepts` are distractors that may stay in the bank. |
| `explanation`          | string           | no       | Shown after submission.                                              |

Minimal example:

```json
{
  "id": "match",
  "title": "Match each term to its definition",
  "type": "dragMatch",
  "data": {
    "prompt": "Match each programming term to its definition.",
    "items": [
      { "id": "i-var", "label": "Variable" },
      { "id": "i-fn", "label": "Function" }
    ],
    "zones": [
      { "id": "z-var", "label": "A named storage for values", "accepts": ["i-var"] },
      { "id": "z-fn", "label": "A reusable block of code", "accepts": ["i-fn"] }
    ]
  }
}
```

Full detail:
[`src/widgets/DragMatch/schema.ts`](../src/widgets/DragMatch/schema.ts) ·
[`src/widgets/DragMatch/sample.ts`](../src/widgets/DragMatch/sample.ts).

---

## Histogram

Static bar-chart histogram from pre-computed bin edges + counts. Use when
the figure IS the point (e.g. visualising a brightness distribution); use
`PlotImage` if you need axes labelled with units, multi-series overlays, or
a runnable matplotlib source.

| Field      | Type      | Required | Meaning                                                              |
|------------|-----------|----------|----------------------------------------------------------------------|
| `binEdges` | number[]  | yes      | Bin boundary positions. Minimum 2.                                   |
| `counts`   | number[]  | yes      | Non-negative count for each bin. Minimum 1.                          |

Invariant: `binEdges.length === counts.length + 1` (one more edge than
bin).

Minimal example:

```json
{
  "id": "brightness",
  "title": "Brightness distribution",
  "type": "histogram",
  "data": {
    "binEdges": [0, 64, 128, 192, 256],
    "counts": [120, 410, 580, 180]
  }
}
```

Full detail:
[`src/widgets/Histogram/schema.ts`](../src/widgets/Histogram/schema.ts) ·
[`src/widgets/Histogram/sample.ts`](../src/widgets/Histogram/sample.ts).

---

## ParametricExplorer

Live Pyodide-driven parameter explorer. `setupCode` runs once per
namespace; `renderCode` re-runs every time a control changes, with the
parameter values bound as variables. Output can be a matplotlib plot, a
single value, or both.

| Field         | Type                          | Required | Meaning                                                              |
|---------------|-------------------------------|----------|----------------------------------------------------------------------|
| `setupCode`   | string                        | yes      | Python that runs once and is cached per `setupCode` string (imports, helper defs, dataset load). |
| `renderCode`  | string                        | yes      | Python that runs on every parameter change. Reads the params as variables and produces output. |
| `params`      | ParametricExplorerParam[]     | yes      | UI controls. Each is a slider, select, or toggle.                    |
| `outputType`  | `'plot'` \| `'value'` \| `'both'` | yes  | What `renderCode` is expected to produce.                            |
| `debounceMs`  | integer                       | no       | Debounce slider changes (ms). Defaults to a sensible value.          |

Each parameter:

| Field     | Type                                | Required | Meaning                                                              |
|-----------|-------------------------------------|----------|----------------------------------------------------------------------|
| `name`    | string                              | yes      | Variable name exposed to `renderCode`.                               |
| `label`   | string                              | yes      | Human label on the control.                                          |
| `type`    | `'slider'` \| `'select'` \| `'toggle'` | yes  | Control kind.                                                        |
| `default` | number \| string \| boolean         | yes      | Initial value.                                                       |
| `min`     | number                              | no       | Slider lower bound.                                                  |
| `max`     | number                              | no       | Slider upper bound.                                                  |
| `step`    | number                              | no       | Slider step.                                                         |
| `options` | string[]                            | no       | Required for `type: 'select'`.                                       |

Minimal example:

```json
{
  "id": "freq-explorer",
  "title": "Sine frequency",
  "type": "parametricExplorer",
  "data": {
    "setupCode": "import numpy as np\nimport matplotlib.pyplot as plt\n",
    "renderCode": "x = np.linspace(0, 2 * np.pi, 200)\ny = np.sin(freq * x)\nplt.figure()\nplt.plot(x, y)\n",
    "params": [
      { "name": "freq", "label": "Frequency", "type": "slider", "min": 0.5, "max": 5, "step": 0.1, "default": 1 }
    ],
    "outputType": "plot"
  }
}
```

Full detail:
[`src/widgets/ParametricExplorer/schema.ts`](../src/widgets/ParametricExplorer/schema.ts)
·
[`src/widgets/ParametricExplorer/sample.ts`](../src/widgets/ParametricExplorer/sample.ts).

---

## PlotImage

Pre-rendered static plot (matplotlib output) saved as a PNG and referenced
via the course assets endpoint. Use for figures with quantitative axes —
the saved PNG must include visible axes, tick labels, axis labels (with
units), and a title (see `generate_lesson/SKILL.md` for the full axis
checklist). Image-only diagrams (kernel layout, flowchart) belong in an
Image widget, not here.

| Field            | Type                       | Required | Meaning                                                              |
|------------------|----------------------------|----------|----------------------------------------------------------------------|
| `src`            | string                     | yes      | Image URL. Typically `/api/courses/<slug>/assets/plots/<file>.png`.  |
| `alt`            | string                     | yes      | Screen-reader description. Be specific about content, not topic.     |
| `caption`        | string                     | no       | Printed `<figcaption>`. Strongly recommended ("Figure 1. …").        |
| `sourceCode`     | string                     | no       | Self-contained script that produced the saved PNG byte-for-byte.     |
| `sourceLanguage` | `'python'` \| `'r'`        | no       | Defaults to `'python'`. Drives syntax highlighting in the *Show source* panel. |

Minimal example:

```json
{
  "id": "sin-plot",
  "title": "A simple sinusoid",
  "type": "plotImage",
  "data": {
    "src": "/api/courses/gauss-basics/assets/plots/example.png",
    "alt": "Line plot of y = sin(x) over x in [0, 2π], one full cycle, with x and y axis labels and tick marks",
    "caption": "Figure 1. A simple sinusoid generated by matplotlib."
  }
}
```

Full detail:
[`src/widgets/PlotImage/schema.ts`](../src/widgets/PlotImage/schema.ts) ·
[`src/widgets/PlotImage/sample.ts`](../src/widgets/PlotImage/sample.ts).

---

## Sandbox

Open-ended Python playground — same Pyodide editor as Code, minus tests
and grading. Use as the closer for hands-on lessons: invite the learner to
tweak parameters and observe behaviour. No correctness gate.

| Field           | Type   | Required | Meaning                                                              |
|-----------------|--------|----------|----------------------------------------------------------------------|
| `starterCode`   | string | yes      | Python skeleton that primes exploration. Often the lesson's code exercise minus assertions, plus a comment inviting a tweak. |
| `encouragement` | string | yes      | One tasteful sentence. May be empty string. No exclamation marks, no emoji. |

Minimal example:

```json
{
  "id": "play",
  "title": "Try it yourself",
  "type": "sandbox",
  "data": {
    "starterCode": "import math\n\nfor sigma in (0.5, 1.0, 2.0):\n    print(sigma, math.exp(-1 / (2 * sigma * sigma)))\n",
    "encouragement": "Tweak sigma and watch how the kernel weights spread."
  }
}
```

Full detail:
[`src/widgets/Sandbox/schema.ts`](../src/widgets/Sandbox/schema.ts) ·
[`src/widgets/Sandbox/sample.ts`](../src/widgets/Sandbox/sample.ts).

---

## Video

Embedded video — YouTube or self-hosted MP4. Optional time-coded
transcript renders alongside the player. Use sparingly: prefer text +
inline images for content the learner needs to scan or revisit.

| Field             | Type                          | Required | Meaning                                                              |
|-------------------|-------------------------------|----------|----------------------------------------------------------------------|
| `kind`            | `'youtube'` \| `'mp4'`        | yes      | Player kind.                                                         |
| `src`             | string                        | yes      | YouTube video id or URL (any standard form) for `youtube`; absolute or course-relative URL for `mp4`. |
| `title`           | string                        | no       | Video title shown above the player.                                  |
| `durationSeconds` | number                        | no       | Total length in seconds. Used in the UI; not enforced against the source. |
| `transcript`      | VideoTranscriptSegment[]      | no       | Time-coded transcript. Each `{ tStart, tEnd?, text, speaker? }`.     |
| `autoplay`        | boolean                       | no       | Defaults to `false`.                                                 |
| `startAt`         | number                        | no       | Initial seek position in seconds.                                    |

Each transcript segment:

| Field     | Type   | Required | Meaning                                          |
|-----------|--------|----------|--------------------------------------------------|
| `tStart`  | number | yes      | Segment start time in seconds (≥ 0).             |
| `tEnd`    | number | no       | Segment end time in seconds.                     |
| `text`    | string | yes      | Spoken/captioned text. Non-empty.                |
| `speaker` | string | no       | Speaker label.                                   |

Minimal example:

```json
{
  "id": "intro-video",
  "title": "But what is a neural network?",
  "type": "video",
  "data": {
    "kind": "youtube",
    "src": "aircAruvnKk",
    "title": "But what is a neural network?",
    "durationSeconds": 1140
  }
}
```

Full detail:
[`src/widgets/Video/schema.ts`](../src/widgets/Video/schema.ts) ·
[`src/widgets/Video/sample.ts`](../src/widgets/Video/sample.ts).

---

## Custom

Escape hatch for content no other widget covers. The renderer is a stub
(`CustomPlaceholder`) that displays a "future widget here" message — useful
for marking out a TODO without breaking schema validation. Prefer a real
widget; only use Custom when no other widget fits.

| Field  | Type            | Required | Meaning                                                              |
|--------|-----------------|----------|----------------------------------------------------------------------|
| `data` | object (record) | yes      | Free-form key/value record. Not validated beyond "is an object".     |

Minimal example:

```json
{
  "id": "future",
  "title": "Future widget",
  "type": "custom",
  "data": {
    "note": "Reserved slot for an upcoming interactive widget."
  }
}
```

Full detail:
[`src/widgets/Custom/CustomPlaceholder.tsx`](../src/widgets/Custom/CustomPlaceholder.tsx)
· schema variant in
[`src/lib/schemas/lesson.ts`](../src/lib/schemas/lesson.ts) (`CustomSectionSchema`).
