---
name: design_course
description: "Second stage of the two-stage course-init pipeline. Reads /courses/<slug>/course-spec.json (wizard output), /courses/<slug>/research.md and /courses/<slug>/sources.md (written by the prior research_course agent), plus any user-uploaded source materials, and produces the finalized /courses/<slug>/course.json validated against CourseSchema. Invoked once per new course by the webapp's /api/courses/generate route immediately after research_course succeeds. Triggers on: design course, design_course <slug>, Run design_course."
user-invocable: true
---

# Design Course

Take the working memory the `research_course` skill prepared — plus the original `course-spec.json` and any user-uploaded source materials — and produce the **final course structure** as `/courses/<slug>/course.json`, validated against `CourseSchema`.

This is the architect pass. The research has been done; your job is to shape modules and lessons.

**Do NOT re-do research.** **Do NOT write any lesson content.** **Do NOT write to `scripts/ralph/`** — this skill is fully decoupled from the ralph orchestrator. The skill ends after `course.json` is written and validates.

---

## Quiz-only mode (US-192)

If `course-spec.json` contains `tags: ['quiz']`, this is a **quiz-only course** and the rules below override the defaults:

1. **Write `tags: ['quiz']` into the produced `course.json`** (the `tags` field on `CourseSchema` accepts the same enum). Downstream consumers — the dashboard `CourseCard` chip, the generation pipeline's per-lesson skill router — read this field to detect the quiz branch from `course.json` alone.
2. **Plan each lesson as a quiz-only set.** The downstream `generate_quiz_lesson` skill emits 10–15 quiz / dragMatch sections per lesson, no theory beats. When you write `lesson.summary` entries, frame them around the *concepts being checked* (e.g. *"Quick check: kernel sizes, separability, and boundary handling."*) rather than "*intro / definition / worked example*" narrative beats.
3. **Do NOT expect `research.md` or `sources.md` to exist.** The research_course stage was deliberately skipped — do NOT Read those files, do NOT cite them, and do NOT update their headings (the *Step 2: Sync sources.md headings* pass is a no-op in quiz mode). Your only inputs are `course-spec.json` and any user-uploaded files under `/courses/<slug>/sources/`.

In every other respect (sizing rules, slug derivation, schema validation, no-touch-`scripts/ralph/`), quiz-only courses follow the same rules as full courses. The existing full-course behaviour below is preserved exactly when no `quiz` tag is present.

---

## The Job

1. Receive a course **slug** as the argument (e.g. `gauss-basics`, `edge-detection-basics`).
2. Read the four context inputs (see Step 0 below).
3. Refine `course-spec.draftStructure` into the final modules + lessons (merge / split / rename / reorder as needed). Use the research notes and the sources you have on hand — a lesson topic with strong sources earns its slot; a topic with no credible sources is a sign to drop or merge it.
4. Write `/courses/<slug>/course.json` and validate against `CourseSchema` (`src/lib/schemas/course.ts`).
5. If you renamed lessons relative to `course-spec.draftStructure`, update the matching `## <Lesson title>` headings in `/courses/<slug>/sources.md` so `generate_lesson`'s per-lesson source lookup still resolves deterministically.
6. Stop. The skill writes nothing outside `/courses/<slug>/course.json` (and the in-place rename of `sources.md` headings when needed).

---

## Step 0: Read the Context

The agent receives one argument (the slug) and is expected to read these files **before** writing `course.json`:

| Path | Source | Why |
|---|---|---|
| `/courses/<slug>/course-spec.json` | wizard output | `level`, `durationTarget`, `theoryPracticeRatio`, `draftStructure` (preliminary outline the user confirmed) |
| `/courses/<slug>/research.md` | `research_course` agent | key concepts, prereqs, misconceptions, suggested ordering, widget hints |
| `/courses/<slug>/sources.md` | `research_course` agent | ≥ 3 credible refs per planned lesson — earns/refutes each lesson's existence |
| uploaded files under `/courses/<slug>/sources/` | user (Stage 0 of wizard) | injected as absolute paths in the prompt; Read each one so the final shape reflects the user's materials |

Validate `course-spec.json` against `CourseSpecSchema` (`src/lib/schemas/courseSpec.ts`). If it does not parse, print the Zod issues and stop.

If `research.md` or `sources.md` is missing, the prior stage either failed or was skipped — stop and report the missing file. Do not synthesise replacement content here; that is `research_course`'s job.

The slug must contain only `[a-z0-9-]` (path-traversal protection — same rule the webapp uses via `assertSafeSlug` in `src/lib/server/paths.ts`).

---

## Step 1: Architect Pass

Take `courseSpec.draftStructure` and produce the final `Course` object — you may merge, split, rename, or reorder modules and lessons. The wizard's defaults are intentionally rough; this is where they get shaped.

Use the research notes to drive the decisions:
- The `## Suggested ordering` section of `research.md` is your prerequisites graph — module order should respect it.
- The `## Common misconceptions` section flags topics that need their own lesson (you cannot bury "X is not Y" inside someone else's lesson).
- Lessons whose `sources.md` block has fewer than 3 credible entries are weak — either merge them into a sibling lesson with stronger sourcing or drop them.

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
          summary: "...",        // 1-line lesson summary (~100-200 chars)
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

**Lesson summary:** For each lesson, emit a `summary` field (string, ~100–200 chars, one sentence) describing what the lesson covers. This surfaces in the Extend wizard and course dashboard.

**Sizing rules:**

Use `courseSpec.durationTarget` to bound the planned size of `course.json`. The wizard's draft structure is intentionally rough — this is where you commit to a real shape:

| `durationTarget`  | modules | lessons / module | typical total | rough wall-clock |
|-------------------|---------|------------------|---------------|------------------|
| `short`           | 1–2     | 3–5              | 3–5 lessons   | 30–60 min        |
| `standard`        | 2–3     | 3–5              | 8–12 lessons  | 1–3 h            |
| `extensive`       | 4–5     | 5–7              | 20–30 lessons | 5–10 h           |
| `comprehensive`   | 5–8     | 6–10             | 40+ lessons   | 15 h+            |

- Each lesson is small enough that one agent in one `generate_lesson` invocation can author it (**≥ 1 `theory` section of 150–400 words + 2–5 widget sections** — see `generate_lesson/SKILL.md` "Section count and mix"). This applies regardless of `durationTarget` — bigger courses use *more* lessons, not bigger lessons.
- For `comprehensive` courses (5–8 modules with 6–10 lessons each) you will be generating 40+ lesson JSON files; pace the per-lesson lessons accordingly so each one has a clear, narrow scope and the bibliography in `sources.md` covers it.
- For `short` courses, prefer one tightly-scoped module over forcing a thin 2-module split.

If `CourseSchema.parse()` fails, read the Zod issues, fix the JSON, and retry. Never write an invalid `course.json`.

Also write the `course.json` file using the same atomic-write pattern the webapp uses (`<file>.tmp` → `fs.rename`) when invoked from a script. If you are writing by hand from inside Claude, just write the file — the agent handles atomicity.

---

## Step 2: Sync `sources.md` headings (only if you renamed lessons)

`sources.md` was written by `research_course` using the planned lesson titles from `course-spec.draftStructure`. If your architect pass renamed any lesson, the `## <Lesson title>` heading in `sources.md` now points at a title that no longer exists, and `generate_lesson` will fail to find its per-lesson bibliography.

For each lesson you renamed:
1. Open `/courses/<slug>/sources.md`.
2. Find the `## <old title>` heading.
3. Rename it to `## <new title>` (exact title from `course.json.modules[].lessons[].title`).

Do not add new entries, drop entries, or reshuffle bullets — only rename the headings. The per-lesson source content was researched against the topic, not the wording; the rename is purely an anchor fix.

If you did NOT rename any lesson, skip this step.

---

## Worked Example: `edge-detection-basics`

**Input** — the same `course-spec.json` shown in `research_course/SKILL.md`'s worked example, plus the `research.md` and `sources.md` that skill produced.

**Output** — `/courses/edge-detection-basics/course.json` (architect pass kept the 2-module / 4-lesson shape; refined titles + added module summaries):

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
        { "slug": "what-is-an-image-gradient", "title": "What is an image gradient?", "estimatedMinutes": 10, "summary": "Defines the image gradient as a 2D derivative and shows how it highlights regions of rapid intensity change." },
        { "slug": "sobel-and-prewitt-operators", "title": "Sobel and Prewitt operators", "estimatedMinutes": 12, "summary": "Introduces two classic 3x3 convolution kernels that approximate horizontal and vertical image derivatives." }
      ]
    },
    {
      "id": "m2",
      "title": "From gradients to edges",
      "summary": "Turning a gradient map into a clean edge map; the full Canny pipeline.",
      "lessons": [
        { "slug": "non-maximum-suppression-and-thresholding", "title": "Non-maximum suppression and thresholding", "estimatedMinutes": 12, "summary": "Thins thick gradient ridges to single-pixel edges and uses double thresholds with hysteresis to keep only strong, connected edges." },
        { "slug": "the-canny-edge-detector", "title": "The Canny edge detector", "estimatedMinutes": 15, "summary": "Walks through Canny's full pipeline: smoothing, gradient, non-max suppression, and hysteresis thresholding." }
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

`design_course` does not author lesson content. Its job ends with `course.json`.

---

## Checklist Before Finishing

- [ ] Slug is safe (`[a-z0-9-]`, no `..`, no `/`).
- [ ] `/courses/<slug>/course-spec.json` parsed cleanly with `CourseSpecSchema`.
- [ ] `/courses/<slug>/research.md` was Read (not synthesised here).
- [ ] `/courses/<slug>/sources.md` was Read (not synthesised here).
- [ ] Each user-uploaded source path mentioned in the prompt was Read before finalising.
- [ ] `/courses/<slug>/course.json` written and parses with `CourseSchema`.
- [ ] `course.json` includes `"schemaVersion": 1` (forward-compat baseline; US-037).
- [ ] Lesson slugs in `course.json` are unique and derived via slugify().
- [ ] If any lesson title in `course.json` differs from the matching title in `course-spec.draftStructure`, the corresponding `## <Lesson title>` heading in `sources.md` was renamed in-place.
- [ ] **No file written under `scripts/ralph/`** — no `prd.json`, no `progress.txt`, no `archive/` directories.

---

## Manual Smoke Test

To dry-run this skill end-to-end without wiring it into the webapp:

1. Run `research_course` first (see its smoke test) so `research.md` and `sources.md` exist for the slug.
2. Invoke this skill in Claude with `design_course edge-detection-basics` (working directory pointing at the same root the research smoke test used).
3. Confirm:
   - `course.json` exists under `/courses/edge-detection-basics/` and parses with `CourseSchema` (`npx tsx -e "import('./src/lib/schemas/course').then(m => m.CourseSchema.parse(JSON.parse(require('fs').readFileSync('/tmp/init-course-smoke/courses/edge-detection-basics/course.json','utf8'))))"`).
   - `research.md` and `sources.md` are unchanged in shape (only `## <Lesson title>` headings may have been renamed in `sources.md`).
   - `git diff` shows changes ONLY under `/courses/edge-detection-basics/` — zero diff under `scripts/ralph/`.
