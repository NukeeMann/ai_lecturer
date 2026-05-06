---
name: init_course
description: "Convert a /courses/<slug>/course-spec.json (produced by the webapp wizard) into the shared per-course artefacts under /courses/<slug>/: research.md, sources.md, and a finalized course.json validated against CourseSchema. The webapp's course-generation backend invokes this once per new course, then walks course.json itself and calls the generate_lesson skill once per lesson. Triggers on: init course, generate course from spec, init_course <slug>, Run init_course."
user-invocable: true
---

# Init Course

Take a single course-spec.json (the output of the in-app course-creation wizard) and produce the three shared artefacts that drive the rest of course generation:

- `/courses/<slug>/research.md` — narrative reference (key concepts, prerequisites, misconceptions, ordering, lesson-generation hints).
- `/courses/<slug>/sources.md` — curated bibliography (≥ 3 stable, credible references per planned lesson).
- `/courses/<slug>/course.json` — finalized course structure validated against `CourseSchema`.

These artefacts are the working memory the `generate_lesson` skill reads when authoring each lesson. The webapp's `/api/courses/generate` route invokes this skill once, then iterates `course.json.modules.flatMap(m => m.lessons)` itself and calls `generate_lesson` once per lesson.

**Do NOT generate any lesson content during this skill.** **Do NOT write to `scripts/ralph/`** — this skill is fully decoupled from the ralph orchestrator. The skill ends after `course.json` is written and validates.

---

## The Job

> **Before you start: read [`docs/widgets.md`](../../../../docs/widgets.md)** — the canonical widget reference. Use it to know which widget types exist and what each is for *before* you decide which widgets to recommend in `research.md`'s `Notes for lesson generation` section. Schema source of truth still lives at `src/widgets/<Name>/schema.ts`; the doc is a quick one-page summary.

1. Receive a course **slug** as the argument (e.g. `gauss-basics`, `edge-detection-basics`).
2. Read `/courses/<slug>/course-spec.json` and validate it against `CourseSpecSchema` (`src/lib/schemas/courseSpec.ts`).
3. Run a **research pass** — synthesise key concepts, prerequisites, common misconceptions, and suggested ordering. Write `/courses/<slug>/research.md`. Alongside it, collect ≥ 3 credible references per lesson and write `/courses/<slug>/sources.md` so per-lesson agents can reuse them.
4. Run an **architect pass** — refine `course-spec.draftStructure` into final modules + lessons (merge / split / rename / reorder as needed). Write `/courses/<slug>/course.json` and validate against `CourseSchema` (`src/lib/schemas/course.ts`).
5. Stop. The skill writes nothing outside `/courses/<slug>/`.

---

## Step 0: Validate Input

Argument is the course slug. The skill expects exactly one slug.

```
Argument: gauss-basics
→ /courses/gauss-basics/course-spec.json must exist and parse with CourseSpecSchema.
```

If the file is missing or invalid:
- Print the Zod issues
- Stop. Do not write anything.

The slug must contain only `[a-z0-9-]` (path-traversal protection — same rule the webapp uses via `assertSafeSlug` in `src/lib/server/paths.ts`).

---

## Step 1: Research Pass

This step produces **two** artefacts under `/courses/<slug>/`:

1. `research.md` — narrative reference (key concepts, misconceptions, ordering).
2. `sources.md` — curated reference list (≥ 3 entries per planned lesson) the `generate_lesson` skill leans on for the lesson's `sources` field (US-040 / US-041).

Synthesise (no web fetch required — use what you know plus the course-spec contents). Both files are read by future agents but never parsed against a schema.

### `research.md` output structure

```markdown
# Research: <courseTitle>

## Topic summary
<2-4 paragraphs framing what this course is about, derived from courseSpec.topic + level + durationTarget>

## Prerequisites
- <bulleted list of what a learner must know before starting>

## Key concepts
- <concept>: <one-line definition>
- <concept>: <one-line definition>
- ...

## Common misconceptions
- <misconception> — <correction>
- ...

## Suggested ordering
1. <theme/module 1>: why it comes first
2. <theme/module 2>: why it comes next
...

## Notes for lesson generation
- Where math/KaTeX is appropriate
- Where a code exercise is more illuminating than a quiz
- Where a Demo widget would help (visual / interactive intuition)
- Where a Sandbox is a good fit (exploration with no grading gate)
```

Tailor depth to `courseSpec.level` (beginner / intermediate / advanced) and `courseSpec.durationTarget` (short / standard / extensive / comprehensive — see Step 2 sizing table for the lesson-count budget). Respect `courseSpec.theoryPracticeRatio` when describing Notes for lesson generation — a low ratio (0.2) means lean hands-on, a high ratio (0.8) means lean theory.

### `sources.md` output structure

Group references by lesson (use the planned lesson titles from `course-spec.draftStructure` — they may be refined in the architect pass, but this file is a working list, not a schema-validated artefact). Aim for **≥ 3 stable, credible sources per lesson**.

```markdown
# Sources: <courseTitle>

> Working bibliography for course generation. Each entry must conform to
> `SourceSchema` (`src/lib/schemas/lesson.ts`) when copied into a lesson:
>   { url, title, kind: "paper" | "video" | "article" | "book", author?, year? }
> Prefer DOI / arxiv / Wikipedia / official docs / official YouTube channels.
> Avoid medium.com, towardsdatascience.com, dev.to, personal blogs.

## Course-wide references
- [<title>](<url>) — kind: <paper|video|article|book>; author: <…>; year: <…>; <one-line why this is relevant>
- ...

## <Lesson 1 title>
- [<title>](<url>) — kind: <…>; author: <…>; year: <…>; <one-line why>
- [<title>](<url>) — kind: <…>; <one-line why>
- [<title>](<url>) — kind: <…>; <one-line why>

## <Lesson 2 title>
- ...
```

Rules:

- **≥ 3 entries per lesson** so the per-lesson agent can populate `lesson.sources` (≥ 3) directly from this list without re-doing the research.
- Always include `kind`. Always include `author` + `year` for `kind: "paper"` and `kind: "book"`; optional otherwise.
- Stable URLs only — DOI, arxiv, `en.wikipedia.org`, official project docs, IETF / W3C, official YouTube channel videos. **Do not** cite medium.com, towardsdatascience.com, dev.to, personal blogs, social-media posts, or random PDFs on Google Drive / Dropbox.
- Re-use the same source across multiple lessons where it covers the lesson's scope — duplication across lesson sub-sections is fine and expected. Course-wide references (textbooks that span the whole topic) live under `## Course-wide references` and can be cited from any lesson.

The `## <Lesson title>` headings here become deterministic anchors that `generate_lesson` reads when populating each lesson's `sources` field. If the architect pass renames a lesson, update the matching heading in `sources.md` so the lookup still works.

---

## Step 2: Architect Pass

Take `courseSpec.draftStructure` and produce the final `Course` object — you may merge, split, rename, or reorder modules and lessons. The wizard's defaults are intentionally rough; this is where they get shaped.

Write to `/courses/<slug>/course.json` and validate against `CourseSchema` (`src/lib/schemas/course.ts`):

```ts
{
  schemaVersion: 1,           // forward-compat baseline (US-037)
  slug: "<slug>",
  title: courseSpec.draftStructure.courseTitle,
  description: courseSpec.draftStructure.courseDescription,
  accentColor: "default" | "indigo" | "emerald" | "terracotta" | "black",
  icon: "<lucide icon name>",
  modules: [
    {
      id: "m1",                  // unique within the course; "m1", "m2", ...
      title: "...",
      summary: "...",            // 1-line module summary
      lessons: [
        {
          slug: "<lesson-slug>", // derived via slugify() from lesson title
          title: "...",
          estimatedMinutes: 12,
        },
        ...
      ],
    },
    ...
  ],
  createdAt: "<ISO 8601>",
  updatedAt: "<ISO 8601>",
}
```

**Lesson slug derivation:** lowercase, replace whitespace with `-`, strip non `[a-z0-9-]`, collapse repeated `-`. Same rule the webapp uses in `src/lib/server/paths.ts → slugify()`.

**Sizing rules:**

Use `courseSpec.durationTarget` to bound the planned size of `course.json`. The wizard's draft structure is intentionally rough — this is where you commit to a real shape:

| `durationTarget`  | modules | lessons / module | typical total | rough wall-clock |
|-------------------|---------|------------------|---------------|------------------|
| `short`           | 1–2     | 3–5              | 3–5 lessons   | 30–60 min        |
| `standard`        | 2–3     | 3–5              | 8–12 lessons  | 1–3 h            |
| `extensive`       | 4–5     | 5–7              | 20–30 lessons | 5–10 h           |
| `comprehensive`   | 5–8     | 6–10             | 40+ lessons   | 15 h+            |

- Each lesson is small enough that one agent in one `generate_lesson` invocation can author it (≈ 8–14 sections — see `generate_lesson/SKILL.md` "Section count and mix"; US-112 raised this from the older 4–8 range so each lesson covers its topic in genuine depth, with at least two `[theory → 1–3 widgets]` pairs). This applies regardless of `durationTarget` — bigger courses use *more* lessons, not bigger lessons.
- For `comprehensive` courses (5–8 modules with 6–10 lessons each) you will be generating 40+ lesson JSON files; pace the per-lesson lessons accordingly so each one has a clear, narrow scope and the bibliography in `sources.md` covers it.
- For `short` courses, prefer one tightly-scoped module over forcing a thin 2-module split.

If `CourseSchema.parse()` fails, read the Zod issues, fix the JSON, and retry. Never write an invalid `course.json`.

Also write the `course.json` file using the same atomic-write pattern the webapp uses (`<file>.tmp` → `fs.rename`) when invoked from a script. If you are writing by hand from inside Claude, just write the file — the agent handles atomicity.

---

## Worked Example: `edge-detection-basics`

**Input** — `/courses/edge-detection-basics/course-spec.json` (abbreviated):

```json
{
  "topic": "Edge detection in computer vision — Sobel, Prewitt, Canny",
  "level": "beginner",
  "durationTarget": "standard",
  "theoryPracticeRatio": 0.45,
  "draftStructure": {
    "courseTitle": "Edge Detection Basics",
    "courseDescription": "How edge detectors find boundaries in images, from gradient operators to Canny.",
    "modules": [
      {
        "title": "Module 1: Gradients in images",
        "lessons": [
          { "title": "What is an image gradient?", "summary": "Discrete derivatives in 2D and what they mean.", "estimatedMinutes": 10 },
          { "title": "Sobel and Prewitt operators", "summary": "Kernels, separability, magnitude/direction.", "estimatedMinutes": 12 }
        ]
      },
      {
        "title": "Module 2: From gradients to edges",
        "lessons": [
          { "title": "Non-maximum suppression and thresholding", "summary": "How to turn a gradient map into a clean edge map.", "estimatedMinutes": 12 },
          { "title": "The Canny edge detector", "summary": "Putting it all together: blur → gradient → NMS → hysteresis.", "estimatedMinutes": 15 }
        ]
      }
    ]
  },
  "createdAt": "2026-04-15T10:00:00.000Z"
}
```

**Output 1** — `/courses/edge-detection-basics/research.md` (per Step 1 template — covers prerequisites like "basic numpy, what a 2D array is", key concepts like "discrete derivative, kernel, convolution, gradient magnitude, hysteresis", common misconceptions like "thinking Canny is a single threshold", suggested ordering: gradients → operators → NMS → Canny).

**Output 2** — `/courses/edge-detection-basics/sources.md` (curated bibliography — ≥ 3 stable references per planned lesson; per Step 1 template):

```markdown
# Sources: Edge Detection Basics

> Working bibliography for course generation. Each entry must conform to
> `SourceSchema` (`src/lib/schemas/lesson.ts`) when copied into a lesson:
>   { url, title, kind: "paper" | "video" | "article" | "book", author?, year? }
> Prefer DOI / arxiv / Wikipedia / official docs / official YouTube channels.
> Avoid medium.com, towardsdatascience.com, dev.to, personal blogs.

## Course-wide references
- [Digital Image Processing, 4th ed.](https://www.cambridge.org/core/books/digital-image-processing/) — kind: book; author: Rafael C. Gonzalez and Richard E. Woods; year: 2018; canonical textbook covering gradients, Sobel/Prewitt, and Canny across Ch. 3 and Ch. 10.
- [Computer Vision: Algorithms and Applications, 2nd ed. (online)](https://szeliski.org/Book/) — kind: book; author: Richard Szeliski; year: 2022; freely-available textbook with chapters on linear filtering and edge detection.

## What is an image gradient?
- [Image gradient — Wikipedia](https://en.wikipedia.org/wiki/Image_gradient) — kind: article; foundational definition + visual examples; stable.
- [scipy.ndimage.sobel — SciPy documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.ndimage.sobel.html) — kind: article; official API reference for the gradient operator the learner will eventually call.
- [3Blue1Brown — But what is a partial derivative?](https://www.youtube.com/watch?v=AXqhWeUEtQU) — kind: video; partial-derivative intuition that transfers cleanly to the discrete 2D case.

## Sobel and Prewitt operators
- [Sobel operator — Wikipedia](https://en.wikipedia.org/wiki/Sobel_operator) — kind: article; canonical entry covering both Sobel and Prewitt with kernel matrices.
- [skimage.filters.sobel — scikit-image documentation](https://scikit-image.org/docs/stable/api/skimage.filters.html#skimage.filters.sobel) — kind: article; official API + worked example.
- [Prewitt, J. M. S. — *Object enhancement and extraction* (1970)](https://doi.org/10.1016/S0079-7421(08)60353-7) — kind: paper; author: Judith M. S. Prewitt; year: 1970; original Prewitt-operator reference.

## Non-maximum suppression and thresholding
- [Non-maximum suppression — Wikipedia (Canny edge detector § Edge thinning)](https://en.wikipedia.org/wiki/Canny_edge_detector#Edge_thinning) — kind: article; concise definition with the standard 8-neighbour rule.
- [skimage.feature.canny — scikit-image documentation](https://scikit-image.org/docs/stable/api/skimage.feature.html#skimage.feature.canny) — kind: article; official implementation reference (low/high threshold, σ).
- [Computerphile — Finding Edges (Canny)](https://www.youtube.com/watch?v=uihBwtPIBxM) — kind: video; clean visual walkthrough of NMS and double thresholding.

## The Canny edge detector
- [Canny, J. — *A Computational Approach to Edge Detection* (1986)](https://doi.org/10.1109/TPAMI.1986.4767851) — kind: paper; author: John Canny; year: 1986; the original paper — non-negotiable primary source.
- [Canny edge detector — Wikipedia](https://en.wikipedia.org/wiki/Canny_edge_detector) — kind: article; readable summary of the four stages.
- [OpenCV — Canny Edge Detection tutorial](https://docs.opencv.org/4.x/da/d22/tutorial_py_canny.html) — kind: article; official tutorial with parameter-tuning intuition.
```

**Output 3** — `/courses/edge-detection-basics/course.json` (architect pass kept the 2-module / 4-lesson shape; refined titles + added module summaries):

```json
{
  "schemaVersion": 1,
  "slug": "edge-detection-basics",
  "title": "Edge Detection Basics",
  "description": "How edge detectors find boundaries in images, from gradient operators to Canny.",
  "accentColor": "indigo",
  "icon": "scan-line",
  "modules": [
    {
      "id": "m1",
      "title": "Gradients in images",
      "summary": "What it means to take a derivative of an image and which kernels approximate that.",
      "lessons": [
        { "slug": "what-is-an-image-gradient", "title": "What is an image gradient?", "estimatedMinutes": 10 },
        { "slug": "sobel-and-prewitt-operators", "title": "Sobel and Prewitt operators", "estimatedMinutes": 12 }
      ]
    },
    {
      "id": "m2",
      "title": "From gradients to edges",
      "summary": "Turning a gradient map into a clean edge map; the full Canny pipeline.",
      "lessons": [
        { "slug": "non-maximum-suppression-and-thresholding", "title": "Non-maximum suppression and thresholding", "estimatedMinutes": 12 },
        { "slug": "the-canny-edge-detector", "title": "The Canny edge detector", "estimatedMinutes": 15 }
      ]
    }
  ],
  "createdAt": "2026-04-15T10:05:00.000Z",
  "updatedAt": "2026-04-15T10:05:00.000Z"
}
```

That `course.json` is what the webapp's generation backend walks once this skill exits — calling `generate_lesson` once per `lessons[]` entry to author each lesson JSON.

---

## Handing off to `generate_lesson`

Once `course.json` is on disk, the webapp's generation backend (POST `/api/courses/generate`) takes over: it reads `course.json`, walks `modules.flatMap(m => m.lessons)`, and invokes the **`generate_lesson`** skill once per lesson with `(slug, lesson-slug)` arguments. That skill:

- reads `/courses/<slug>/course.json` to find the lesson by `slug`, recover its parent `moduleId` and `estimatedMinutes`, and pull the rest of the structural context
- reads `/courses/<slug>/research.md` for narrative context, common misconceptions (quiz distractors), and lesson-generation hints
- reads `/courses/<slug>/sources.md` for the curated bibliography under `## <lesson title>` and copies ≥ 3 entries into `lesson.sources`
- reads the JSON Schemas under `src/widgets/schemas/` for widget data shapes
- writes `/courses/<slug>/lessons/<lesson-slug>.json` validated against `LessonSchema`

`init_course` does not author lesson content. Its job ends with `course.json`.

---

## Checklist Before Finishing

- [ ] Slug is safe (`[a-z0-9-]`, no `..`, no `/`).
- [ ] `/courses/<slug>/course-spec.json` parsed cleanly with `CourseSpecSchema`.
- [ ] `/courses/<slug>/research.md` written with all six template sections.
- [ ] `/courses/<slug>/sources.md` written with ≥ 3 stable, credible references per planned lesson (no medium / towardsdatascience / personal blogs).
- [ ] Every entry in `sources.md` carries `kind` ∈ `{paper, video, article, book}`; `author` + `year` set for every `paper`/`book`.
- [ ] `/courses/<slug>/course.json` written and parses with `CourseSchema`.
- [ ] `course.json` includes `"schemaVersion": 1` (forward-compat baseline; US-037).
- [ ] Lesson slugs in `course.json` are unique and derived via slugify().
- [ ] Each `## <lesson title>` heading in `sources.md` matches a lesson title in `course.json` (so `generate_lesson` can resolve the per-lesson source list deterministically).
- [ ] **No file written under `scripts/ralph/`** — no `prd.json`, no `progress.txt`, no `archive/` directories. This skill is fully decoupled from the ralph orchestrator.

---

## Manual Smoke Test

To dry-run this skill end-to-end without wiring it into the webapp:

1. Create a sample course-spec under a test directory:
   ```
   mkdir -p /tmp/init-course-smoke/courses/edge-detection-basics
   cp <example above> /tmp/init-course-smoke/courses/edge-detection-basics/course-spec.json
   ```
2. Invoke the skill in Claude with `init_course edge-detection-basics` (after pointing the working directory at `/tmp/init-course-smoke/`).
3. Confirm:
   - `research.md`, `sources.md`, and `course.json` exist under `/courses/edge-detection-basics/`.
   - `course.json` parses with `CourseSchema` (`npx tsx -e "import('./src/lib/schemas/course').then(m => m.CourseSchema.parse(JSON.parse(require('fs').readFileSync('/tmp/init-course-smoke/courses/edge-detection-basics/course.json','utf8'))))"`).
   - `git diff` shows changes ONLY under `/courses/edge-detection-basics/` — zero diff under `scripts/ralph/`.
