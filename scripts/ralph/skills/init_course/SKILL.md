---
name: init_course
description: "Convert a /courses/<slug>/course-spec.json (produced by the webapp wizard) into a fresh scripts/ralph/prd.json with a research pass, an architect pass, and one story per lesson, so ralph loop can generate the course one lesson per iteration. Triggers on: init course, generate course from spec, create course prd, wygeneruj kurs, ralph init course, init_course <slug>."
user-invocable: true
---

# Init Course

Take a single course-spec.json (the output of the in-app course-creation wizard) and produce a fresh `scripts/ralph/prd.json` whose stories drive the rest of course generation: first a research note, then a finalized course structure, then one story per lesson, optionally a final review pass.

The output prd.json is what `ralph.sh` will iterate over. Each per-lesson story is sized to one ralph iteration and is meant to be picked up by an agent that invokes the `generate_lesson` skill.

**Do NOT generate any lesson content during this skill. The skill ends after `prd.json` is written.**

---

## The Job

1. Receive a course **slug** as the argument (e.g. `gauss-basics`, `edge-detection-basics`).
2. Read `/courses/<slug>/course-spec.json` and validate it against `CourseSpecSchema` (`src/lib/schemas/courseSpec.ts`).
3. Archive the existing `scripts/ralph/prd.json` if it belongs to a different branch.
4. Run a **research pass** — synthesise key concepts, prerequisites, common misconceptions, and suggested ordering. Write `/courses/<slug>/research.md`. Alongside it, collect ≥ 3 credible references per lesson and write `/courses/<slug>/sources.md` so per-lesson agents can reuse them.
5. Run an **architect pass** — refine `course-spec.draftStructure` into final modules + lessons (merge / split / rename / reorder as needed). Write `/courses/<slug>/course.json` and validate against `CourseSchema` (`src/lib/schemas/course.ts`).
6. Write `scripts/ralph/prd.json` with stories: research → structure → one per lesson (each carrying source hints in its `notes` field) → optional review pass.

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

The branch name for the new prd.json is **always** `ralph/course-<slug>`.

---

## Step 1: Archive Existing prd.json

Read the current `scripts/ralph/prd.json` (if any).

- If `prd.json` does not exist → skip archiving, proceed.
- If `prd.json` exists and `branchName === "ralph/course-<slug>"` → resuming the same course; skip archiving, proceed.
- If `prd.json` exists and `branchName !== "ralph/course-<slug>"`:
  1. Compute today's date as `YYYY-MM-DD`.
  2. Read `branchName` from the existing prd.json — call it `<old-branchName>`. Replace any `/` in it with `-` for the directory name.
  3. Create `scripts/ralph/archive/<YYYY-MM-DD>-<old-branchName>/`.
  4. Copy `scripts/ralph/prd.json` and `scripts/ralph/progress.txt` into that archive directory.
  5. Reset `scripts/ralph/progress.txt` so it begins with:
     ```
     # Ralph Progress Log
     Rotated: <full date>
     Previous log archived to: archive/<YYYY-MM-DD>-<old-branchName>/progress.txt
     ---
     ```

This mirrors the archiving rule in `prd_init`'s SKILL.md.

---

## Step 2: Research Pass

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

Tailor depth to `courseSpec.level` (beginner / intermediate / advanced) and `courseSpec.durationTarget` (30min / 1h / weekend). Respect `courseSpec.theoryPracticeRatio` when describing Notes for lesson generation — a low ratio (0.2) means lean hands-on, a high ratio (0.8) means lean theory.

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

Per-lesson stories generated in Step 4 will reference the matching lesson section here through a **Source hints** line in the story `notes` field, so `generate_lesson` can pick them up without re-deriving the bibliography.

---

## Step 3: Architect Pass

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
- 2–6 modules total.
- Each module has 2–6 lessons.
- Each lesson is small enough that one agent in one ralph iteration can author it (≈ 4–8 sections).

If `CourseSchema.parse()` fails, read the Zod issues, fix the JSON, and retry. Never write an invalid `course.json`.

Also write the `course.json` file using the same atomic-write pattern the webapp uses (`<file>.tmp` → `fs.rename`) when invoked from a script. If you are writing by hand from inside Claude, just write the file — the agent handles atomicity.

---

## Step 4: Generate prd.json

Write `scripts/ralph/prd.json` directly. Schema mirrors what `prd_init` produces:

```json
{
  "project": "Course: <courseTitle>",
  "branchName": "ralph/course-<slug>",
  "description": "Generate the lessons for /courses/<slug>/ from the course-spec, research notes, sources.md bibliography, and finalized course.json. Each story below produces one artefact (research.md + sources.md, course.json, or one lesson JSON). Driven by the generate_lesson skill.",
  "stories": [ ... ]
}
```

### Story 1 — Research notes

```json
{
  "id": "US-001",
  "title": "Compile research notes for course <courseTitle>",
  "description": "As an agent, I want a research note synthesising key concepts, prerequisites, misconceptions, and ordering for <courseTitle>, plus a curated /courses/<slug>/sources.md bibliography (≥3 stable, credible references per planned lesson), so per-lesson agents have shared context and a ready-made source list.",
  "acceptanceCriteria": [
    "/courses/<slug>/research.md exists and follows the init_course research template",
    "Sections present: Topic summary, Prerequisites, Key concepts, Common misconceptions, Suggested ordering, Notes for lesson generation",
    "/courses/<slug>/sources.md exists and lists ≥3 stable, credible references per planned lesson (DOI / arxiv / Wikipedia / official docs / official YouTube channels; no medium.com / towardsdatascience.com / personal blogs)",
    "Typecheck passes"
  ],
  "priority": 1,
  "passes": true,
  "notes": "research.md and sources.md were authored by init_course; this story is marked passes=true so ralph skips re-running it. Flip to false to force regeneration.",
  "tags": []
}
```

> Both `research.md` and `sources.md` are *already written* by Step 2 of this skill, so US-001 ships with `passes: true`. The story is kept in the prd.json so the artefacts are auditable in the story list. The same applies to US-002.

### Story 2 — Finalized course structure

```json
{
  "id": "US-002",
  "title": "Finalize course structure for <courseTitle>",
  "description": "As an agent, I want /courses/<slug>/course.json finalized (modules + lessons confirmed) before per-lesson generation begins.",
  "acceptanceCriteria": [
    "/courses/<slug>/course.json validates against CourseSchema",
    "Each module has 2–6 lessons; total lesson count matches per-lesson stories below",
    "Lesson slugs are unique within the course and derived via slugify()",
    "Typecheck passes"
  ],
  "priority": 2,
  "passes": true,
  "notes": "course.json was authored by init_course; this story is marked passes=true. Flip to false to force a re-architect.",
  "tags": []
}
```

### Stories 3..N — one per lesson

Walk `course.json.modules.flatMap(m => m.lessons)` in order. For lesson at index `i` (0-based), the story is:

```json
{
  "id": "US-<003 + i>",
  "title": "Generate lesson: <lesson title>",
  "description": "As an agent, I want a complete lesson JSON for <lesson title> at /courses/<slug>/lessons/<lesson-slug>.json, so the webapp can render it.",
  "acceptanceCriteria": [
    "Lesson JSON validates against LessonSchema",
    "Uses ≥3 widget types where the topic permits",
    "Uses generate_lesson skill",
    "Lesson JSON populates `sources` with ≥3 entries drawn from /courses/<slug>/sources.md (or fresh research if a source is missing)",
    "Typecheck passes"
  ],
  "priority": <3 + i>,
  "passes": false,
  "notes": "Module: <module title>\nSummary: <lesson summary from course-spec or architect>\nScope: <bulleted list of subtopics this lesson must cover, drawn from research.md>\nLevel: <courseSpec.level>\nDuration target: <lesson estimatedMinutes> min\nTheory/practice mix: <courseSpec.theoryPracticeRatio> (0=practice, 1=theory)\nSource hints: see /courses/<slug>/sources.md → ## <lesson title>; copy ≥3 entries into lesson.sources, add section.sources on theory sections that quote a specific reference",
  "tags": []
}
```

**Always include all five AC strings verbatim**, even though "Typecheck passes" and "Uses generate_lesson skill" are symbolic for a JSON-only story — they keep ralph's standard validation pipeline uniform across all stories.

The **Source hints** line in `notes` points at the matching `## <lesson title>` heading inside `/courses/<slug>/sources.md`. If the architect pass renamed the lesson, update the heading in `sources.md` to match — the hint is a deterministic pointer, not free text.

> "Uses ≥3 widget types where the topic permits" is a *guideline*, not a hard gate. If a lesson is genuinely a pure-theory recap (e.g. summary lesson at the end of a module), it can use fewer widget types — `generate_lesson` will document that choice in the lesson notes. The criterion stays in the AC for the common case.

### Story N+1 — Review pass (optional, recommended)

```json
{
  "id": "US-<final>",
  "title": "Review pass: validate all lessons against schema and fix issues",
  "description": "As an agent, I want to re-validate every /courses/<slug>/lessons/*.json against LessonSchema and the per-widget JSON Schemas in src/widgets/schemas/, fixing anything the per-lesson agents got wrong.",
  "acceptanceCriteria": [
    "All lesson JSON files under /courses/<slug>/lessons/ parse against LessonSchema",
    "All per-widget data fields parse against the matching schema in src/widgets/schemas/",
    "Section IDs are unique within each lesson",
    "Lesson slug in the file matches the slug listed in /courses/<slug>/course.json",
    "Typecheck passes"
  ],
  "priority": <final>,
  "passes": false,
  "notes": "Catch-all cleanup story. Skip if every per-lesson story already produced clean JSON.",
  "tags": []
}
```

Include this story by default. It is the only story that has license to *modify* lesson JSON files written by earlier stories.

### Priorities

`priority` increments by 1 across the array. US-001 is priority 1, the last story (review pass) is priority `2 + lessonCount + 1`. Ralph picks `passes: false` stories in priority order, so the per-lesson stories are processed before the review.

### Tags

No story in this prd.json gets `"ui"` — these stories produce JSON, not user-facing HTML. Browser testing is therefore skipped for course generation. (The seed course's *display* in the webapp is verified separately by US-029 and US-030 in the MVP plan.)

---

## Worked Example: `edge-detection-basics`

**Input** — `/courses/edge-detection-basics/course-spec.json` (abbreviated):

```json
{
  "topic": "Edge detection in computer vision — Sobel, Prewitt, Canny",
  "level": "beginner",
  "durationTarget": "1h",
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

**Output 1** — `/courses/edge-detection-basics/research.md` (per Step 2 template — covers prerequisites like "basic numpy, what a 2D array is", key concepts like "discrete derivative, kernel, convolution, gradient magnitude, hysteresis", common misconceptions like "thinking Canny is a single threshold", suggested ordering: gradients → operators → NMS → Canny).

**Output 2** — `/courses/edge-detection-basics/sources.md` (curated bibliography — ≥ 3 stable references per planned lesson; per Step 2 template):

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

**Output 4** — `scripts/ralph/prd.json`:

```json
{
  "project": "Course: Edge Detection Basics",
  "branchName": "ralph/course-edge-detection-basics",
  "description": "Generate the lessons for /courses/edge-detection-basics/ from the course-spec, research notes, sources.md bibliography, and finalized course.json. Each story below produces one artefact (research.md + sources.md, course.json, or one lesson JSON). Driven by the generate_lesson skill.",
  "stories": [
    {
      "id": "US-001",
      "title": "Compile research notes for course Edge Detection Basics",
      "description": "As an agent, I want a research note synthesising key concepts, prerequisites, misconceptions, and ordering for Edge Detection Basics, plus a curated /courses/edge-detection-basics/sources.md bibliography (≥3 stable, credible references per planned lesson), so per-lesson agents have shared context and a ready-made source list.",
      "acceptanceCriteria": [
        "/courses/edge-detection-basics/research.md exists and follows the init_course research template",
        "Sections present: Topic summary, Prerequisites, Key concepts, Common misconceptions, Suggested ordering, Notes for lesson generation",
        "/courses/edge-detection-basics/sources.md exists and lists ≥3 stable, credible references per planned lesson (DOI / arxiv / Wikipedia / official docs / official YouTube channels; no medium.com / towardsdatascience.com / personal blogs)",
        "Typecheck passes"
      ],
      "priority": 1,
      "passes": true,
      "notes": "research.md and sources.md were authored by init_course; this story is marked passes=true so ralph skips re-running it. Flip to false to force regeneration.",
      "tags": []
    },
    {
      "id": "US-002",
      "title": "Finalize course structure for Edge Detection Basics",
      "description": "As an agent, I want /courses/edge-detection-basics/course.json finalized (modules + lessons confirmed) before per-lesson generation begins.",
      "acceptanceCriteria": [
        "/courses/edge-detection-basics/course.json validates against CourseSchema",
        "Each module has 2–6 lessons; total lesson count matches per-lesson stories below",
        "Lesson slugs are unique within the course and derived via slugify()",
        "Typecheck passes"
      ],
      "priority": 2,
      "passes": true,
      "notes": "course.json was authored by init_course; this story is marked passes=true. Flip to false to force a re-architect.",
      "tags": []
    },
    {
      "id": "US-003",
      "title": "Generate lesson: What is an image gradient?",
      "description": "As an agent, I want a complete lesson JSON for What is an image gradient? at /courses/edge-detection-basics/lessons/what-is-an-image-gradient.json, so the webapp can render it.",
      "acceptanceCriteria": [
        "Lesson JSON validates against LessonSchema",
        "Uses ≥3 widget types where the topic permits",
        "Uses generate_lesson skill",
        "Lesson JSON populates `sources` with ≥3 entries drawn from /courses/edge-detection-basics/sources.md (or fresh research if a source is missing)",
        "Typecheck passes"
      ],
      "priority": 3,
      "passes": false,
      "notes": "Module: Gradients in images\nSummary: Discrete derivatives in 2D and what they mean.\nScope: definition of discrete partial derivative; Ix and Iy as forward differences; visualising gradient as a vector field; magnitude vs. direction.\nLevel: beginner\nDuration target: 10 min\nTheory/practice mix: 0.45\nSource hints: see /courses/edge-detection-basics/sources.md → ## What is an image gradient?; copy ≥3 entries into lesson.sources, add section.sources on theory sections that quote a specific reference",
      "tags": []
    },
    {
      "id": "US-004",
      "title": "Generate lesson: Sobel and Prewitt operators",
      "description": "As an agent, I want a complete lesson JSON for Sobel and Prewitt operators at /courses/edge-detection-basics/lessons/sobel-and-prewitt-operators.json, so the webapp can render it.",
      "acceptanceCriteria": [
        "Lesson JSON validates against LessonSchema",
        "Uses ≥3 widget types where the topic permits",
        "Uses generate_lesson skill",
        "Lesson JSON populates `sources` with ≥3 entries drawn from /courses/edge-detection-basics/sources.md (or fresh research if a source is missing)",
        "Typecheck passes"
      ],
      "priority": 4,
      "passes": false,
      "notes": "Module: Gradients in images\nSummary: Kernels, separability, magnitude/direction.\nScope: 3x3 Sobel and Prewitt kernels; separability proof for Sobel; computing magnitude and direction from Ix, Iy; comparison code exercise.\nLevel: beginner\nDuration target: 12 min\nTheory/practice mix: 0.45\nSource hints: see /courses/edge-detection-basics/sources.md → ## Sobel and Prewitt operators; copy ≥3 entries into lesson.sources, add section.sources on theory sections that quote a specific reference (e.g. the Prewitt 1970 paper on the operators section)",
      "tags": []
    },
    {
      "id": "US-005",
      "title": "Generate lesson: Non-maximum suppression and thresholding",
      "description": "As an agent, I want a complete lesson JSON for Non-maximum suppression and thresholding at /courses/edge-detection-basics/lessons/non-maximum-suppression-and-thresholding.json, so the webapp can render it.",
      "acceptanceCriteria": [
        "Lesson JSON validates against LessonSchema",
        "Uses ≥3 widget types where the topic permits",
        "Uses generate_lesson skill",
        "Lesson JSON populates `sources` with ≥3 entries drawn from /courses/edge-detection-basics/sources.md (or fresh research if a source is missing)",
        "Typecheck passes"
      ],
      "priority": 5,
      "passes": false,
      "notes": "Module: From gradients to edges\nSummary: How to turn a gradient map into a clean edge map.\nScope: thinning by NMS along the gradient direction; single vs. double threshold; hysteresis preview.\nLevel: beginner\nDuration target: 12 min\nTheory/practice mix: 0.45\nSource hints: see /courses/edge-detection-basics/sources.md → ## Non-maximum suppression and thresholding; copy ≥3 entries into lesson.sources, add section.sources on theory sections that quote a specific reference",
      "tags": []
    },
    {
      "id": "US-006",
      "title": "Generate lesson: The Canny edge detector",
      "description": "As an agent, I want a complete lesson JSON for The Canny edge detector at /courses/edge-detection-basics/lessons/the-canny-edge-detector.json, so the webapp can render it.",
      "acceptanceCriteria": [
        "Lesson JSON validates against LessonSchema",
        "Uses ≥3 widget types where the topic permits",
        "Uses generate_lesson skill",
        "Lesson JSON populates `sources` with ≥3 entries drawn from /courses/edge-detection-basics/sources.md (or fresh research if a source is missing)",
        "Typecheck passes"
      ],
      "priority": 6,
      "passes": false,
      "notes": "Module: From gradients to edges\nSummary: Putting it all together: blur → gradient → NMS → hysteresis.\nScope: the four Canny stages; tuning sigma and the two thresholds; demo widget on cameraman.jpg; quiz on stage ordering.\nLevel: beginner\nDuration target: 15 min\nTheory/practice mix: 0.45\nSource hints: see /courses/edge-detection-basics/sources.md → ## The Canny edge detector; the Canny 1986 paper is the primary source — attach it as section.sources on the theory section that walks through the four stages",
      "tags": []
    },
    {
      "id": "US-007",
      "title": "Review pass: validate all lessons against schema and fix issues",
      "description": "As an agent, I want to re-validate every /courses/edge-detection-basics/lessons/*.json against LessonSchema and the per-widget JSON Schemas in src/widgets/schemas/, fixing anything the per-lesson agents got wrong.",
      "acceptanceCriteria": [
        "All lesson JSON files under /courses/edge-detection-basics/lessons/ parse against LessonSchema",
        "All per-widget data fields parse against the matching schema in src/widgets/schemas/",
        "Section IDs are unique within each lesson",
        "Lesson slug in the file matches the slug listed in /courses/edge-detection-basics/course.json",
        "Typecheck passes"
      ],
      "priority": 7,
      "passes": false,
      "notes": "Catch-all cleanup story.",
      "tags": []
    }
  ]
}
```

That prd.json is what `./scripts/ralph/ralph.sh` will iterate on.

---

## Handing off to `generate_lesson`

When ralph picks up a `Generate lesson: ...` story, the agent invokes the **`generate_lesson`** skill (`scripts/ralph/skills/generate_lesson/SKILL.md`). That skill:

- reads the story's `notes` field for module / summary / scope / level / duration / theory-practice context, including the `Source hints:` line pointing at the matching `## <lesson title>` heading in `sources.md`
- reads `/courses/<slug>/research.md`, `/courses/<slug>/sources.md`, and `/courses/<slug>/course.json` for shared context
- reads the JSON Schemas under `src/widgets/schemas/` for widget data shapes
- writes `/courses/<slug>/lessons/<lesson-slug>.json` validated against `LessonSchema`, populating `lesson.sources` (≥ 3 entries) and any relevant `section.sources`

`init_course` does not author lesson content. Its job ends with `prd.json`.

---

## Story Rules

### Branch name

Always `ralph/course-<slug>`. The slug is the same one the webapp wrote `course-spec.json` under. `ralph.sh` reads `branchName` from prd.json to drive `git worktree add`.

### One context window per story

Each `Generate lesson: ...` story is one ralph iteration. If the architect pass produces a lesson that feels too large for one iteration (≈ > 8 sections, > 600 lines of expected JSON), split it into two lessons in `course.json` *during the architect pass* — never during prd.json generation.

### Acceptance criteria — verbatim

Per-lesson stories use exactly these five criteria, in this order:

```
"Lesson JSON validates against LessonSchema"
"Uses ≥3 widget types where the topic permits"
"Uses generate_lesson skill"
"Lesson JSON populates `sources` with ≥3 entries drawn from /courses/<slug>/sources.md (or fresh research if a source is missing)"
"Typecheck passes"
```

### Tags

No `"ui"` tag on any course-generation story. These stories produce JSON, not user-facing HTML.

### `passes` field

- US-001 (research) and US-002 (course.json) ship as `passes: true` because their artefacts are written by this skill *now*.
- All per-lesson stories ship as `passes: false`.
- The optional review story ships as `passes: false`.

The orchestrator flips `passes` to `true` after a successful iteration; do not flip it manually.

---

## Checklist Before Writing prd.json

- [ ] Slug is safe (`[a-z0-9-]`, no `..`, no `/`).
- [ ] `/courses/<slug>/course-spec.json` parsed cleanly with `CourseSpecSchema`.
- [ ] Existing `scripts/ralph/prd.json` archived if its `branchName` differs from `ralph/course-<slug>`; `progress.txt` reset with fresh header.
- [ ] `/courses/<slug>/research.md` written with all six template sections.
- [ ] `/courses/<slug>/sources.md` written with ≥ 3 stable, credible references per planned lesson (no medium / towardsdatascience / personal blogs).
- [ ] Every entry in `sources.md` carries `kind` ∈ `{paper, video, article, book}`; `author` + `year` set for every `paper`/`book`.
- [ ] `/courses/<slug>/course.json` written and parses with `CourseSchema`.
- [ ] `course.json` includes `"schemaVersion": 1` (forward-compat baseline; US-037).
- [ ] Lesson slugs in `course.json` are unique and derived via slugify().
- [ ] One US story per lesson, in display order, with priority incrementing.
- [ ] Every per-lesson story has the five required AC strings verbatim.
- [ ] Every per-lesson story `notes` contains a `Source hints:` line pointing at the matching `## <lesson title>` heading in `sources.md`.
- [ ] Optional review pass story added at the end.
- [ ] `branchName` is `ralph/course-<slug>`.
- [ ] No story is tagged `"ui"`.
- [ ] `prd.json` itself parses as JSON.

---

## Manual Smoke Test

To dry-run this skill end-to-end without wiring it into ralph:

1. Create a sample course-spec under a test directory:
   ```
   mkdir -p /tmp/init-course-smoke/courses/edge-detection-basics
   cp <example above> /tmp/init-course-smoke/courses/edge-detection-basics/course-spec.json
   ```
2. Invoke the skill in Claude with `init_course edge-detection-basics` (after pointing the working directory at `/tmp/init-course-smoke/`).
3. Confirm:
   - `research.md` and `course.json` exist under `/courses/edge-detection-basics/`.
   - `course.json` parses with `CourseSchema` (`npx tsx -e "import('./src/lib/schemas/course').then(m => m.CourseSchema.parse(JSON.parse(require('fs').readFileSync('/tmp/init-course-smoke/courses/edge-detection-basics/course.json','utf8'))))"`).
   - `scripts/ralph/prd.json` matches the schema in this skill (top-level `project`, `branchName: "ralph/course-edge-detection-basics"`, `stories[]` with US-001 → US-N+1).
   - Story count = 2 + lesson count (+ 1 if review pass included).
4. Inspect priorities — they should be a contiguous run from 1 to the last story.
