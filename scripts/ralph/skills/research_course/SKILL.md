---
name: research_course
description: "First stage of the two-stage course-init pipeline. Reads /courses/<slug>/course-spec.json (produced by the webapp wizard) plus any user-uploaded source materials under /courses/<slug>/sources/ and produces the per-course working memory: research.md and sources.md. Does NOT write course.json — that is the design_course skill's job. Invoked once per new course by the webapp's /api/courses/generate route before design_course runs. Triggers on: research course, research_course <slug>, Run research_course."
user-invocable: true
---

# Research Course

Take a single `course-spec.json` (the output of the in-app course-creation wizard) plus any user-uploaded source materials under `/courses/<slug>/sources/`, and produce the two working-memory artefacts that drive the rest of the pipeline:

- `/courses/<slug>/research.md` — narrative reference (key concepts, prerequisites, misconceptions, ordering, lesson-generation hints).
- `/courses/<slug>/sources.md` — curated bibliography (≥ 3 stable, credible references per planned lesson).

These artefacts are the working memory the `design_course` skill (next stage) reads when shaping the final `course.json`, and the working memory the `generate_lesson` skill (after that) reads when authoring each lesson.

**Do NOT write `course.json`.** That is the next agent's job. **Do NOT write any lesson content.** **Do NOT write to `scripts/ralph/`** — this skill is fully decoupled from the ralph orchestrator. The skill ends after `research.md` and `sources.md` are written.

---

## The Job

> **Before you start: read [`docs/widgets.md`](../../../../docs/widgets.md)** — the canonical widget reference. Use it to know which widget types exist and what each is for *before* you decide which widgets to recommend in `research.md`'s `Notes for lesson generation` section. Schema source of truth still lives at `src/widgets/<Name>/schema.ts`; the doc is a quick one-page summary.

1. Receive a course **slug** as the argument (e.g. `gauss-basics`, `edge-detection-basics`).
2. Read `/courses/<slug>/course-spec.json` and validate it against `CourseSpecSchema` (`src/lib/schemas/courseSpec.ts`).
3. If the webapp injected absolute paths to uploaded source files into the prompt, invoke the Read tool on each one **before** starting to write so the research is grounded in the user's materials.
4. Run a **research pass** — synthesise key concepts, prerequisites, common misconceptions, and suggested ordering. Write `/courses/<slug>/research.md`. Alongside it, collect ≥ 3 credible references per planned lesson and write `/courses/<slug>/sources.md` so per-lesson agents (and the design pass) can reuse them.
5. Stop. The skill writes nothing outside `/courses/<slug>/research.md` and `/courses/<slug>/sources.md`.

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

Synthesise from `courseSpec` contents + any uploaded source materials (Read each path the prompt names) + what you know about the topic. Both files are read by future agents but never parsed against a schema.

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

Tailor depth to `courseSpec.level` (beginner / intermediate / advanced) and `courseSpec.durationTarget` (short / standard / extensive / comprehensive — see the sizing table in `design_course/SKILL.md` for the lesson-count budget). Respect `courseSpec.theoryPracticeRatio` when describing Notes for lesson generation — a low ratio (0.2) means lean hands-on, a high ratio (0.8) means lean theory.

### `sources.md` output structure

Group references by lesson (use the planned lesson titles from `course-spec.draftStructure` — they may be refined in the `design_course` architect pass, but this file is a working list, not a schema-validated artefact). Aim for **≥ 3 stable, credible sources per lesson**.

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

The `## <Lesson title>` headings here become deterministic anchors that `generate_lesson` reads when populating each lesson's `sources` field. If the `design_course` pass renames a lesson, that skill is responsible for updating the matching heading in `sources.md`.

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

---

## Handing off to `design_course`

Once `research.md` and `sources.md` are on disk, the webapp's generation backend (POST `/api/courses/generate`) invokes the **`design_course`** skill with the same slug. That skill:

- re-reads `/courses/<slug>/course-spec.json` (the original spec — for `level`, `durationTarget`, `theoryPracticeRatio`, `draftStructure`)
- reads `/courses/<slug>/research.md` (your output)
- reads `/courses/<slug>/sources.md` (your output)
- re-reads any user-uploaded source files (same paths the webapp injects into its prompt)
- produces the final `/courses/<slug>/course.json` validated against `CourseSchema`

`research_course` does NOT write `course.json`. Its job ends with `research.md` + `sources.md`.

---

## Checklist Before Finishing

- [ ] Slug is safe (`[a-z0-9-]`, no `..`, no `/`).
- [ ] `/courses/<slug>/course-spec.json` parsed cleanly with `CourseSpecSchema`.
- [ ] Each user-uploaded source path mentioned in the prompt was Read **before** authoring (so the research is grounded in the user's materials, not generic textbook content).
- [ ] `/courses/<slug>/research.md` written with all six template sections.
- [ ] `/courses/<slug>/sources.md` written with ≥ 3 stable, credible references per planned lesson (no medium / towardsdatascience / personal blogs).
- [ ] Every entry in `sources.md` carries `kind` ∈ `{paper, video, article, book}`; `author` + `year` set for every `paper`/`book`.
- [ ] **No `course.json` written** — that file belongs to the `design_course` skill that runs next.
- [ ] **No file written under `scripts/ralph/`** — this skill is fully decoupled from the ralph orchestrator.

---

## Manual Smoke Test

To dry-run this skill end-to-end without wiring it into the webapp:

1. Create a sample course-spec under a test directory:
   ```
   mkdir -p /tmp/research-course-smoke/courses/edge-detection-basics
   cp <example above> /tmp/research-course-smoke/courses/edge-detection-basics/course-spec.json
   ```
2. Invoke the skill in Claude with `research_course edge-detection-basics` (after pointing the working directory at `/tmp/research-course-smoke/`).
3. Confirm:
   - `research.md` and `sources.md` exist under `/courses/edge-detection-basics/`.
   - `course.json` does **NOT** exist (that comes from `design_course`).
   - `git diff` shows changes ONLY under `/courses/edge-detection-basics/` — zero diff under `scripts/ralph/`.
