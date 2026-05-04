---
name: generate_lesson
description: "Author a single lesson JSON file at /courses/<slug>/lessons/<lesson-slug>.json from a 'Generate lesson: ...' story produced by the init_course skill. Reads the story notes (module / summary / scope / level / duration / theory-practice ratio), the shared course context (research.md + course.json), and the per-widget JSON Schemas under src/widgets/schemas/, then emits a lesson with 4–8 sections that mixes widget types and validates against LessonSchema. Auto-discovered by ralph agents picking up per-lesson stories — not user-invocable."
user-invocable: false
---

# Generate Lesson

Produce one valid lesson JSON file for the per-lesson story you are currently working on. Each invocation handles exactly one story (one lesson). The skill is auto-discovered when ralph picks up a story whose title starts with `Generate lesson: ...`.

This skill is the back half of the course-generation pipeline. The front half is [`init_course`](../init_course/SKILL.md) — it reads a `course-spec.json` produced by the webapp wizard, writes `/courses/<slug>/research.md` + `/courses/<slug>/course.json`, and seeds `scripts/ralph/prd.json` with one `Generate lesson: ...` story per lesson. Read `init_course/SKILL.md` if you need context on how this story landed in `prd.json`.

**Do NOT touch other lesson files. Do NOT update `course.json` or `research.md`. Do NOT mark `passes` true — the orchestrator handles that.**

---

## The Job

> **Before you start: read [`docs/widgets.md`](../../../../docs/widgets.md)** — the canonical widget reference. Use it to pick which widgets to compose into the lesson and to crib minimal example shapes for each `data` payload. The Zod schemas in `src/widgets/<Name>/schema.ts` (mirrored as JSON Schemas under `src/widgets/schemas/`) remain the source of truth; open them when the doc is ambiguous or you need a field the summary omits.

1. Read the **current ralph story** from `scripts/ralph/prd.json` (the story whose `id` matches `RALPH_TASK_ID`, or the highest-priority `passes: false` story otherwise — same rule as `scripts/ralph/CLAUDE.md`).
2. Read **course context**: `/courses/<slug>/research.md`, `/courses/<slug>/sources.md` (if present), and `/courses/<slug>/course.json`.
3. Read the **per-widget JSON Schemas** under `src/widgets/schemas/` (`theory.json`, `quiz.json`, `code.json`, `demo.json`, `sandbox.json`).
4. **Source research pass** — identify ≥ 3 credible references for this lesson *before writing content*. Prefer stable URLs (DOI, arxiv, official docs, Wikipedia for foundational concepts, official YouTube channels). See Step 4 for the full rules.
5. **Visual illustrations pass** — pick the inline images and Image-widget hero figures that will accompany the lesson. Lessons should be visually rich, not walls of text. See Step 5 for the rules.
6. Compose a lesson with **4–8 sections** mixing widget types (rules below).
7. Write `/courses/<slug>/lessons/<lesson-slug>.json` — including the `sources` field (lesson-level) plus optional `section.sources` for theory sections that draw on a specific reference.
8. Validate the file against `LessonSchema` (`src/lib/schemas/lesson.ts`). On failure, read the Zod issues, fix the JSON, retry. Never commit invalid JSON.
9. Stop. The skill ends after the lesson file is written and validates.

---

## Step 1: Read the Story

The story lives in `scripts/ralph/prd.json` and looks like this (produced by `init_course`):

```json
{
  "id": "US-005",
  "title": "Generate lesson: Median filter",
  "description": "As an agent, I want a complete lesson JSON for Median filter at /courses/image-denoising/lessons/median-filter.json, so the webapp can render it.",
  "acceptanceCriteria": [
    "Lesson JSON validates against LessonSchema",
    "Uses ≥3 widget types where the topic permits",
    "Uses generate_lesson skill",
    "Typecheck passes"
  ],
  "priority": 5,
  "passes": false,
  "notes": "Module: Non-linear filters\nSummary: How a sliding median erases impulse noise without smearing edges.\nScope: window definition; median vs. mean for salt-and-pepper noise; edge handling; complexity tradeoffs.\nLevel: beginner\nDuration target: 12 min\nTheory/practice mix: 0.4",
  "tags": []
}
```

Pull the following from the story:

| Field             | Source                                                                 |
|-------------------|------------------------------------------------------------------------|
| Lesson title      | `title` minus the `Generate lesson: ` prefix                           |
| Output path       | parsed from `description` (`/courses/<slug>/lessons/<lesson-slug>.json`) |
| Course slug       | parsed from output path                                                |
| Lesson slug       | parsed from output path                                                |
| Module title      | `notes` → `Module: ...` line                                           |
| Summary           | `notes` → `Summary: ...` line                                          |
| Scope (subtopics) | `notes` → `Scope: ...` line — semicolon- or comma-separated list       |
| Level             | `notes` → `Level: ...` (beginner / intermediate / advanced)            |
| Duration          | `notes` → `Duration target: <N> min`                                   |
| Theory ratio      | `notes` → `Theory/practice mix: 0..1` (0 = pure practice, 1 = pure theory) |

If `notes` is missing or unparseable, fall back to `description` and `course.json` to recover the same fields, then proceed.

---

## Step 2: Read Course Context

Open the shared course files. They are the working memory across all per-lesson agents.

- `/courses/<slug>/research.md` — narrative reference: prerequisites, key concepts, common misconceptions, suggested ordering, and per-lesson hints under `## Notes for lesson generation`. Lean on its `Common misconceptions` for plausible quiz distractors. Lean on `Notes for lesson generation` for cues like *"Where math/KaTeX is appropriate"*, *"Where a code exercise is more illuminating than a quiz"*, *"Where a Demo widget would help"*, *"Where a Sandbox is a good fit"*.
- `/courses/<slug>/sources.md` — *if present*, this is the curated reference list `init_course` collected during its research pass. The story's `notes` field will usually carry **Source hints** pointing at specific entries here; treat those as the seed for your own Step 4 source research. If the file is missing (older course or hand-written prd), fall back to your own research.
- `/courses/<slug>/course.json` — authoritative structure. Use it to look up the parent module (so you can fill `moduleId`) and confirm the lesson's `estimatedMinutes`.

Find the matching lesson by `slug`. Note its parent `moduleId` (e.g. `m1`, `m2`) and `estimatedMinutes` — both are required fields in the lesson JSON.

If `course.json` lists a different `slug` or different `estimatedMinutes` than the story, **trust `course.json`**. The story is a copy; the course file is the source of truth.

---

## Step 3: Read Widget Schemas

Open the per-widget JSON Schemas under `src/widgets/schemas/`:

- `theory.json` — `{ markdown: string }`
- `quiz.json` — `{ question, options[≥2], correct[≥1], explanation, multiSelect }`
- `code.json` — `{ taskMarkdown, starterCode, tests: [{ name, body, hidden? }], solution? }`
- `demo.json` — `{ demoType: "gauss", imageSrc, params: { sigmaMin, sigmaMax, sigmaDefault } }` — **gauss only for now**; do not invent new `demoType` values
- `sandbox.json` — `{ starterCode, encouragement }`
- `plotImage.json` — `{ src, alt, caption?, sourceCode?, sourceLanguage? }` — pre-rendered matplotlib PNG served from `/api/courses/<slug>/assets/plots/...`. The `sourceCode` MUST match the saved PNG byte-for-byte (re-running it must reproduce the same plot).

These JSON Schemas are generated from the Zod schemas in `src/widgets/<Name>/schema.ts` via `npm run build:schemas`. The Zod schemas are the runtime source of truth (`src/lib/schemas/lesson.ts → SectionSchema` is a `discriminatedUnion('type', [...])` over the six section types). When in doubt, open the Zod file alongside the JSON Schema.

`additionalProperties: false` everywhere — every extra field you put on a widget `data` object is a validation error. Stick to what the schema declares.

---

## Step 4: Source Research

**Do this before writing content.** Lessons without credible references are out of scope; the `sources` field on `LessonSchema` (US-040) exists precisely so the learner can verify and dig deeper.

### What to collect

Identify **at least 3 credible sources** for this lesson. Aim for a mix:

- **Papers** — original or canonical results, ideally with a DOI or arxiv URL (`https://doi.org/...`, `https://arxiv.org/abs/...`).
- **Textbook chapters** — named chapter from a recognised textbook (e.g. *Gonzalez & Woods, "Digital Image Processing", Ch. 5*). Use the publisher / archive URL where available.
- **Reputable articles** — Wikipedia for foundational concepts (it is stable and well-edited for established maths/CS topics), official documentation pages (`scikit-image`, `numpy`, `scipy`, `pytorch`), MDN / W3C, IETF RFCs.
- **Recognised educational videos** — channels with editorial standards: 3Blue1Brown, StatQuest with Josh Starmer, Computerphile, Two Minute Papers, MIT OpenCourseWare, Khan Academy. Use the canonical YouTube URL.

### URL stability rules

Prefer URLs that are unlikely to rot:

- **Yes:** DOI links, arxiv abstract pages, `en.wikipedia.org/wiki/...`, official project docs at versioned or stable paths, official YouTube channel video URLs, IETF / W3C standards, university course pages.
- **No:** medium.com, towardsdatascience.com, dev.to, personal blogs on substack/wordpress/blogspot, Quora / StackOverflow answers (use as research input, not as a cited source), random Google Drive / Dropbox PDFs, social media posts.

When in doubt, prefer the *primary* source: cite the arxiv paper rather than a blog post that summarises it; cite the official docs rather than a tutorial that wraps them.

### Per-source fields

Every source object must conform to `SourceSchema` (`src/lib/schemas/lesson.ts`):

```ts
{
  url: string,                                  // valid URL — must parse
  title: string,                                // non-empty — REQUIRED
  kind: "paper" | "video" | "article" | "book", // REQUIRED
  author?: string,                              // strongly preferred for papers/books
  year?: number,                                // strongly preferred for papers/books
}
```

- **`title`** must always be non-empty. The schema enforces `min(1)`; an empty title is a validation error.
- **`author` + `year`** are *strongly preferred* for `kind: "paper"` and `kind: "book"` — the learner needs them to look the source up if the URL ever rots. For Wikipedia / official-docs articles and YouTube videos, `author` and `year` are optional (they are recoverable from the URL).
- **`kind`** picks the rendered icon and grouping in the UI (`LessonSourcesPanel`). Use `paper` for arxiv/DOI works, `book` for textbook chapters, `article` for Wikipedia / official docs / blog-style references, `video` for educational videos.

### Where the sources go

- **Lesson-level `sources`** (top-level `lesson.sources`) — populate with **at least 3 entries** that cover the lesson's overall scope. These are the references the learner sees in the lesson-wide *Sources / Źródła* panel.
- **Section-level `section.sources`** (any `section.sources`) — for **theory sections that draw on a specific reference** (e.g. a section on Canny's hysteresis that quotes Canny's 1986 paper), attach the matching source *also* to that section. Do not duplicate the entire lesson list onto every section — only attach references the section specifically leans on. Sections with no specific reference omit the field.
- The schema permits `section.sources` on every section type (`theory`, `quiz`, `code`, `demo`, `sandbox`, `histogram`, `custom`), but in practice it is most useful on `theory` sections. Quiz/code/demo sections inherit credibility from the lesson-level list.

### Recording in `sources.md` (optional but encouraged)

If you discover useful sources beyond what `init_course` recorded in `/courses/<slug>/sources.md`, append them to that file under a `## <Lesson title>` heading. Future lessons in the same course can re-use them. Do not delete or rewrite entries written by `init_course` or by other per-lesson agents.

---

## Step 5: Visual Illustrations

Lessons should be visually rich, not walls of text. A learner who scrolls past three screen-heights of unbroken prose has already disengaged. Use **inline markdown images** inside `theory` sections for supporting visuals, and the dedicated **`image` widget** (US-050) as a standalone section for hero illustrations, diagrams, or figures that warrant their own caption + attribution treatment.

Plan visuals during this step — *before* you write the section JSON — so you can weave the image references naturally into the markdown rather than bolting them on at the end.

### Inline markdown images vs. the Image widget

- **Inline markdown image** (`![alt](url)` inside a `theory.markdown` block) — for *supporting* visuals that flow with the prose: a small reference figure, a tiny diagram, an example output sample, a screenshot. Every theory section whose `markdown` is **≥ 300 characters** SHOULD include **at least one** inline image where it makes pedagogical sense (a sketch of the concept, a side-by-side comparison, a sample output). Don't force an image into a 50-word theory paragraph just to satisfy the rule — judgement first; if no image genuinely helps, skip it.
- **Image widget section** (`type: "image"`, US-050) — for *hero illustrations*, headline diagrams, multi-panel figures, annotated reference plots, or anything that warrants its own caption + attribution treatment. Use one when the figure IS the point of the section, not a sidebar to it. Image widget sections render as a `<figure>` with optional `<figcaption>` and an attribution line.

A typical lesson uses **1–3 inline images** across its theory sections plus **0–2 Image widget sections** for headline figures.

### Where to find images

PREFER stable, redistributable sources:

- **Wikimedia Commons** (`commons.wikimedia.org` / `upload.wikimedia.org/wikipedia/commons/...`) — the default. Large, well-licensed (CC BY / CC BY-SA / public domain), stable URLs. Always link to the file's Commons description page in `attribution.url`.
- **Public-domain repositories** — NASA image gallery, USGS, NOAA, Library of Congress, NIH/NLM, government science agencies. Public domain by default.
- **Official documentation diagrams** — `scikit-image`, `OpenCV`, `matplotlib`, `numpy`, `scipy`, `pytorch`, `scikit-learn` docs and gallery pages. Every PNG/SVG the docs serve is fair game for educational reuse; credit the project.
- **arxiv figure references** — figures embedded in arxiv papers (`arxiv.org/abs/...` HTML view → figure URLs, or screenshots of paper figures with citation).

AVOID hotlinking from rot-prone or unlicensed hosts:

- `medium.com`, `towardsdatascience.com`, `dev.to`, personal substack/wordpress/blogspot blogs — go 404 frequently and licensing is unclear.
- Imgur, Discord CDN, Twitter/X media URLs, random Google-image-search results — not durable, not authoritative.
- Any URL that looks like a tracking redirect or shortlink.

If you can't find a stable image for a concept, **omit it**; do not fall back to a blog host.

### Alt text — REQUIRED for every image

EVERY image — inline OR widget — MUST have **meaningful alt text** describing what is shown. A good alt text answers *"what would a screen-reader user need to know to understand this figure?"*. Be specific about content, not just topic.

- ✅ Good: `![Side-by-side comparison: original cameraman image (left) vs. the same image after Gaussian blur with σ=2 (right) — fine texture lost, edges softened](...)`.
- ✅ Good: `![Step edge in a 1-D signal: median filter output (orange) preserves the discontinuity exactly; mean filter output (blue) smears across two samples](...)`.
- ❌ BAD: `![image](...)`, `![figure](...)`, `![](...)` — empty or placeholder.
- ❌ BAD: `![noise](...)`, `![diagram](...)` — uninformative single-word labels.

The Image widget schema enforces a non-empty `alt`; inline markdown has no schema enforcement, so discipline is on you.

### Attribution

For Image widget sections, populate `data.attribution` whenever the source license requires it:

- **Wikimedia Commons** — required. Use the format `"Wikimedia Commons, <author>, <license>"` (e.g. `"Wikimedia Commons, User:Cmglee, CC BY-SA 4.0"`). Set `attribution.url` to the file's Commons description page (`https://commons.wikimedia.org/wiki/File:<filename>`).
- **Official docs** (scikit-image, matplotlib, OpenCV, etc.) — recommended. Use the format `"<Project> documentation"` and link `attribution.url` to the page that hosts the figure.
- **NASA / USGS / NOAA / public domain** — credit by convention even when not legally required (`"NASA / <mission>"`, `"USGS"`, `"Public domain"`).
- **arxiv** — credit the paper (`"<First Author> et al., arxiv:<id>"`) and link `attribution.url` to the paper's abstract page.

For inline markdown images, credit briefly in the surrounding prose if license requires it (`*(Image: Wikimedia Commons, User:Foo, CC BY-SA 4.0)*`) — markdown has no dedicated attribution slot.

### Image widget shape (recap of US-050)

```ts
{
  type: "image",
  id: "<unique>",
  title: "<short caption-style title>",
  data: {
    src: "<URL — http(s) external; cached locally on lesson save>",
    alt: "<meaningful description of the figure>",        // REQUIRED, non-empty
    caption?: "<one-sentence figure caption>",
    attribution?: { text: "<credit string>", url?: "<source page>" },
    maxWidth?: "<px or %, default '100%'>"
  }
}
```

The Image widget caches external URLs into `courses/<slug>/assets/images/` on save (US-050), so a `commons.wikimedia.org` URL becomes a local relative path on first lesson save — lessons stay viewable offline and source-of-truth attribution is preserved.

---

## Step 6: Compose the Lesson

### Top-level shape

```ts
{
  schemaVersion: 1,             // forward-compat baseline (US-037)
  slug: "<lesson-slug>",        // matches /courses/<courseSlug>/lessons/<lesson-slug>.json
  courseSlug: "<courseSlug>",
  moduleId: "<m1 | m2 | ...>",  // from course.json
  title: "<lesson title>",
  eyebrow: "<short uppercase tag>",   // e.g. module title in caps, or "PRACTICE"
  description: "<one-sentence lesson description>",
  estimatedMinutes: <int>,      // from course.json
  sections: [ ... ],            // 4–8 entries; see below
  sources: [ ... ],             // ≥3 entries; see Step 4
}
```

`eyebrow` is a short label (≤ 24 chars) — a category tag. The runtime currently overlays `Module N · Lesson M` from the course position, so `eyebrow` is mostly schema ballast for now, but it's still required. Pick the module title in uppercase or `INTRO` / `PRACTICE` / `RECAP`.

### Section count and mix

- **4–8 sections per lesson**, in display order.
- **Always at least 1 `theory` section.** Theory is the spine — start with it (so the learner has context before the first interactive section).
- **At least 1 `quiz` section where conceptual checking helps.** Skip only if the lesson is pure mechanics (e.g. a hands-on debug walkthrough where a quiz feels artificial).
- **At least 1 `code` section OR 1 `demo` section where the topic permits hands-on.** For numeric / image / signal topics with a Pyodide-friendly task, prefer `code`. For visual intuition that benefits from a slider (currently only the `gauss` blur demo) prefer `demo`.
- **At most one `demo` section per lesson** (the only registered demo is `gauss`; reusing it twice is redundant).
- A `sandbox` section is a nice closer for hands-on lessons — encourages free exploration after the graded code exercise. Optional.
- A `custom` section is an escape hatch for things no widget covers; use sparingly and only when the topic genuinely warrants it.

The `notes` field's `Theory/practice mix` (0..1) tunes the balance:

- `≤ 0.3` → lean practice: 1 theory + (1–2 code) + 1 quiz + 1 sandbox.
- `0.4–0.6` → balanced: 1–2 theory + 1 code (or 1 demo) + 1 quiz + optional sandbox.
- `≥ 0.7` → lean theory: 2–3 theory + 1 quiz; code/sandbox only if the topic clearly invites it.

### Section IDs

`section.id` must be unique within the lesson. Use stable, content-bearing slugs (`"intro"`, `"definition"`, `"why-it-works"`, `"check-1"`, `"exercise"`, `"sandbox"`) — not opaque counters like `s1`/`s2`. The review pass story checks for uniqueness; collisions are a hard fail.

### Per-widget content rules

#### Theory (`type: "theory"`)
- `data.markdown` is plain markdown rendered with KaTeX support (`$inline$` and `$$block$$`).
- Use KaTeX where math is genuinely relevant (formulas, summations, kernels) — don't force LaTeX into prose.
- Use fenced code blocks for code snippets (\`\`\`python ... \`\`\`).
- Length: 80–250 words is a good target for a single theory section. Prefer two short theory sections over one long one when the topic naturally splits.
- Headings: don't open with `# `; the section's own title is already a heading. Use `##` / `###` for sub-structure if needed.

#### Quiz (`type: "quiz"`)
- `question` is a single, unambiguous prompt.
- `options` ≥ 2; aim for 3–4 with **plausible distractors** drawn from the `Common misconceptions` section of `research.md` — wrong answers a learner could *realistically* pick after rushing the theory.
- `correct` is an array of integer indices into `options`. For single-answer quizzes use one index; for multi-select use ≥ 1 indices.
- `multiSelect: false` for "exactly one right answer", `true` for "select all that apply".
- `explanation` is non-empty and *justifies the right answer specifically* — don't just paraphrase the question. Reference the concept from the preceding theory.

#### Code (`type: "code"`)
- `taskMarkdown` is a short brief: 1–3 sentences + a fenced example I/O block where useful. Tell the learner what function name to define.
- `starterCode` is runnable Python (pyodide). Provide an empty function shell + minimal scaffolding — never the solution. Keep imports light (numpy is available; avoid unusual dependencies).
- `tests`: **2–4 tests per exercise**. Each test:
  - has a **descriptive `name`** like `"returns_zero_for_empty_input"` or `"handles_negative_numbers"` — not `"t1"`/`"test_a"`.
  - has a **meaningful but small `body`** — one or two `assert` lines at most. Tests run via the in-worker `__ai_run_tests` runner (no pytest), so plain `assert` works. Use `==`, not `np.allclose` unless floating point demands it; if it does, set `atol`/`rtol` explicitly.
  - omit `hidden` to default to `true` (hidden-with-peek), or set `hidden: false` to expose a sample test that the learner can read while solving. A common pattern: one visible "smoke test" + 1–3 hidden grading tests. (See memory: *Code widget tests hidden by default* — final UI is hidden-with-peek.)
- Test bodies must reference the function/variable the learner is meant to define. Don't redefine helpers inside test bodies; the learner's namespace is in scope.
- **Always populate `solution`** with a runnable reference implementation that would pass every test. The learner reaches it via the always-available *Peek solution* button (US-038); never leave `solution` empty for a code exercise. Keep the solution idiomatic and minimal — one clean implementation, not the full set of edge-case branches you'd put in production.

#### Demo (`type: "demo"`)
- Only `demoType: "gauss"` is registered (see `src/widgets/registry.ts`). Don't invent new types.
- `imageSrc` should be a path the webapp can serve. Existing demos use `/cameraman.png` or `/<course-slug>/<image>.png`. If the asset doesn't exist yet, leave a TODO in the lesson notes via the review story — but still pick a path that *would* live under `public/`.
- `params.sigmaMin` < `params.sigmaDefault` < `params.sigmaMax`. Reasonable range: `0–6` for an introductory blur demo.

#### Sandbox (`type: "sandbox"`)
- `starterCode` seeds an open-ended exploration — typically the same skeleton as the preceding code exercise, minus the assertions, plus a comment inviting the learner to tweak parameters.
- `encouragement` is **one tasteful sentence** — warm but brief. Examples:
  - `"Tweak the kernel size and watch the edges sharpen — no tests, no pressure."`
  - `"Try different noise levels and see when the median starts to fail."`
  - Avoid "!!!", emoji, or anything that reads as patronising.

#### PlotImage (`type: "plotImage"`)
- A pre-rendered static plot (matplotlib output) saved under `courses/<slug>/assets/plots/<lesson-slug>-<n>.png` and referenced as `/api/courses/<slug>/assets/plots/<lesson-slug>-<n>.png`.
- `data.alt` is **required** and must describe the figure for screen readers (same rule as Image widget alt text — be specific about content, not topic).
- `data.caption` is the printed `<figcaption>` ("Figure 1. …", "Rys. 1. …"). Optional but strongly recommended.
- `data.sourceCode` is shown in a collapsible *Show source* panel (read-only CodeMirror). Make it self-contained, runnable, and **byte-for-byte the script that produced the saved PNG** — re-running it must reproduce the same plot. `sourceLanguage` defaults to `'python'`.
- **Axes are MANDATORY for every plot.** Plots without visible axes are unreadable for value-reading exercises. Every saved PNG MUST include:
  - Visible **X and Y spines** (matplotlib draws them by default — do NOT call `plt.axis('off')`, `ax.set_axis_off()`, or any `spine.set_visible(False)`).
  - **Tick marks** on both X and Y axes (`plt.xticks(...)` / `plt.yticks(...)` or default ticks — never empty `plt.xticks([])` / `plt.yticks([])`).
  - **Numeric tick labels** so the learner can read values off the plot (default matplotlib labels are fine; do not blank them out).
  - **Axis labels** via `plt.xlabel("...")` and `plt.ylabel("...")` — name the quantity the axis represents.
  - **Units** in the axis label where applicable (e.g. `"Time [s]"`, `"Intensity [0–255]"`, `"Frequency [Hz]"`). For dimensionless / index axes (pixel index, sample index), name the quantity (`"x"`, `"sample"`, `"pixel index"`) without a unit suffix.
  - A `plt.title("...")` describing what the figure shows.
  - A light `plt.grid(True, alpha=0.3)` is encouraged (helps the eye read values) but optional.
  - For multi-series plots, use `label=` on each `plt.plot(...)` and call `plt.legend()`.
- Save with `plt.savefig(<path>, dpi=110, bbox_inches='tight')` so labels are not cropped. `bbox_inches='tight'` is critical — without it, axis labels fall outside the canvas.
- Image-only diagrams (no quantitative axes — e.g. a kernel layout figure, a flowchart, an iconographic illustration) belong in the **Image widget**, NOT PlotImage. PlotImage is for *plots with readable values*.

#### Custom (`type: "custom"`)
- Use only when no other widget fits. `data` is a free-form record. The renderer is `CustomPlaceholder`, so this section currently displays as a stub — useful for marking "future widget here" but not for shipping content. Prefer one of the five real widgets.

### Markdown discipline

- KaTeX delimiters: `$...$` (inline), `$$...$$` (block). `\\` line breaks inside `$$...$$` need to be escaped as `\\\\` in JSON strings.
- JSON strings need every `"` escaped as `\"` and every `\` escaped as `\\`. Multiline markdown lives on a single JSON line with `\n` separators.
- Don't embed raw HTML in markdown — only what KaTeX + standard markdown render.

---

## Step 7: Write and Validate

Write `/courses/<courseSlug>/lessons/<lessonSlug>.json` directly via the Write tool (or `node:fs/promises#writeFile`). The webapp uses an atomic-write helper (`src/lib/server/atomic.ts → atomicWriteJson`) — for a one-shot author flow, a plain write is fine.

Then validate. From the repo root:

```bash
npx tsx -e "
const fs = require('node:fs');
const path = '/courses/<courseSlug>/lessons/<lessonSlug>.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
import('./src/lib/schemas/lesson').then(m => {
  const result = m.LessonSchema.safeParse(data);
  if (!result.success) {
    console.error('FAIL:');
    console.error(JSON.stringify(result.error.issues, null, 2));
    process.exit(1);
  }
  console.log('OK:', path);
});
"
```

If validation fails:

1. Print the Zod issues.
2. Identify the failing path (e.g. `sections[2].data.tests[0].name`).
3. Fix the JSON in place.
4. Re-run the validator.
5. **Never commit an invalid lesson file.**

Only commit when the validator prints `OK`.

---

## Step 8: Stop

You're done. The orchestrator flips `passes: true` for the story when the validation step succeeds. Do not edit `prd.json` yourself. Do not author further lessons in the same iteration.

If something looked off in `course.json` or `research.md` while authoring, leave a note in `scripts/ralph/progress.txt` under your story's progress entry (the `**Learnings**` block) — the review pass (last story in the prd) will pick it up.

---

## Worked Example: Median filter

Story (US-005, abbreviated):

```json
{
  "id": "US-005",
  "title": "Generate lesson: Median filter",
  "description": "As an agent, I want a complete lesson JSON for Median filter at /courses/image-denoising/lessons/median-filter.json, so the webapp can render it.",
  "notes": "Module: Non-linear filters\nSummary: How a sliding median erases impulse noise without smearing edges.\nScope: window definition; median vs. mean for salt-and-pepper noise; edge handling; complexity tradeoffs.\nLevel: beginner\nDuration target: 12 min\nTheory/practice mix: 0.4"
}
```

Parent course: `image-denoising`. Module `m2` (`Non-linear filters`). Course-level `estimatedMinutes` = 12.

Output — `/courses/image-denoising/lessons/median-filter.json`:

```json
{
  "schemaVersion": 1,
  "slug": "median-filter",
  "courseSlug": "image-denoising",
  "moduleId": "m2",
  "title": "Median filter",
  "eyebrow": "NON-LINEAR FILTERS",
  "description": "Replace each pixel with the median of its neighbourhood — the textbook fix for salt-and-pepper noise.",
  "estimatedMinutes": 12,
  "sections": [
    {
      "id": "intuition",
      "title": "Why a median?",
      "type": "theory",
      "data": {
        "markdown": "Salt-and-pepper noise plants a few extreme outliers in an otherwise clean signal. A **mean** filter spreads those outliers across their neighbours; a **median** filter throws them away.\n\n![Grayscale photograph of a cameraman corrupted with roughly 10% salt-and-pepper noise — scattered pure-white and pure-black pixels speckle the image](https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Noise_salt_and_pepper.png/480px-Noise_salt_and_pepper.png)\n\nFor a window $W$ of size $k \\times k$ centred at pixel $(i, j)$, the median filter outputs:\n\n$$ \\hat I(i, j) = \\operatorname{median}\\bigl(\\{\\, I(p, q) : (p, q) \\in W \\,\\}\\bigr) $$\n\nBecause the median is robust to a small fraction of outliers (it ignores up to $\\lfloor (k^2 - 1)/2 \\rfloor$ of them), salt-and-pepper noise vanishes — and crucially, **edges are preserved**: at a step edge, the median snaps to one of the two flat regions instead of averaging across them."
      },
      "sources": [
        {
          "url": "https://en.wikipedia.org/wiki/Median_filter",
          "title": "Median filter — Wikipedia",
          "kind": "article"
        }
      ]
    },
    {
      "id": "edge-preservation-figure",
      "title": "Median vs. mean on a step edge",
      "type": "image",
      "data": {
        "src": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Median_filter_step_edge.png/720px-Median_filter_step_edge.png",
        "alt": "Two stacked line plots of a 1-D signal that jumps from 0 to 5 with three impulse spikes. Top: noisy input. Bottom: outputs of a 3-sample median filter (orange, spikes removed and step edge crisp) and a 3-sample mean filter (blue, spikes attenuated but step edge smeared across two samples).",
        "caption": "A 3-sample sliding median erases the impulse spikes while leaving the step edge sharp; the mean filter attenuates the spikes but smears the edge.",
        "attribution": {
          "text": "Wikimedia Commons, User:Cmglee, CC BY-SA 4.0",
          "url": "https://commons.wikimedia.org/wiki/File:Median_filter_step_edge.png"
        }
      }
    },
    {
      "id": "check-mean-vs-median",
      "title": "Quick check: mean vs. median",
      "type": "quiz",
      "data": {
        "question": "An image has 5% of its pixels replaced by pure white salt noise. Which filter best removes the noise without softening edges?",
        "options": [
          "A 3×3 box (mean) filter",
          "A 3×3 median filter",
          "A 3×3 Gaussian filter with σ = 1",
          "Any of the above — they are equivalent on impulse noise"
        ],
        "correct": [1],
        "explanation": "Mean and Gaussian filters average the noisy white pixels with their neighbours, which both reduces and smears the noise across edges. The median filter ignores the outlier pixels entirely (as long as they are a minority of the window) and preserves edge sharpness — that's exactly the regime where it shines.",
        "multiSelect": false
      }
    },
    {
      "id": "exercise-implement",
      "title": "Implement a 1-D median filter",
      "type": "code",
      "data": {
        "taskMarkdown": "Write `median_filter_1d(signal, k)` that returns a list where each element is the median of a length-`k` window centred on the same index of `signal`. Use **edge replication** at the boundaries (pad by repeating the first / last value). Assume `k` is odd.\n\n```\nmedian_filter_1d([1, 1, 9, 1, 1], 3) == [1, 1, 1, 1, 1]\n```",
        "starterCode": "from statistics import median\n\ndef median_filter_1d(signal, k):\n    # signal: list[float], k: odd int >= 1\n    # TODO: return a list of the same length where each entry\n    # is the median of the window of size k centred at that index,\n    # using edge replication for boundary handling.\n    return signal\n",
        "tests": [
          {
            "name": "removes_isolated_spike",
            "body": "assert median_filter_1d([1, 1, 9, 1, 1], 3) == [1, 1, 1, 1, 1]",
            "hidden": false
          },
          {
            "name": "preserves_step_edge",
            "body": "assert median_filter_1d([0, 0, 0, 5, 5, 5], 3) == [0, 0, 0, 5, 5, 5]"
          },
          {
            "name": "replicates_at_boundary",
            "body": "assert median_filter_1d([7, 1, 1, 1], 3) == [7, 1, 1, 1]"
          },
          {
            "name": "k_equals_1_is_identity",
            "body": "assert median_filter_1d([3, 1, 4, 1, 5, 9], 1) == [3, 1, 4, 1, 5, 9]"
          }
        ],
        "solution": "from statistics import median\n\ndef median_filter_1d(signal, k):\n    n = len(signal)\n    half = k // 2\n    out = []\n    for i in range(n):\n        window = []\n        for j in range(i - half, i + half + 1):\n            j_clamped = max(0, min(n - 1, j))\n            window.append(signal[j_clamped])\n        out.append(median(window))\n    return out\n"
      }
    },
    {
      "id": "sandbox",
      "title": "Try it on a noisy signal",
      "type": "sandbox",
      "data": {
        "starterCode": "import random\nfrom statistics import median\n\nrandom.seed(0)\nclean = [int(i > 10) * 5 for i in range(24)]              # step edge at i=11\nnoisy = [v if random.random() > 0.1 else 9 for v in clean]  # 10% spike noise\n\n# Tweak k and watch what happens to the spikes — and to the edge.\nk = 3\n# def median_filter_1d(signal, k): ...\n# print(noisy)\n# print(median_filter_1d(noisy, k))\n",
        "encouragement": "Try different window sizes and noise rates and see when the median finally cracks."
      }
    }
  ],
  "sources": [
    {
      "url": "https://en.wikipedia.org/wiki/Median_filter",
      "title": "Median filter — Wikipedia",
      "kind": "article"
    },
    {
      "url": "https://scikit-image.org/docs/stable/api/skimage.filters.html#skimage.filters.median",
      "title": "skimage.filters.median — scikit-image documentation",
      "kind": "article"
    },
    {
      "url": "https://www.cambridge.org/core/books/digital-image-processing/",
      "title": "Digital Image Processing, 4th ed. — Chapter 5 (Image Restoration and Reconstruction)",
      "kind": "book",
      "author": "Rafael C. Gonzalez and Richard E. Woods",
      "year": 2018
    },
    {
      "url": "https://www.youtube.com/watch?v=7FP7ndMEfsc",
      "title": "Computerphile — Image Filtering",
      "kind": "video"
    }
  ]
}
```

Why this lesson works as a worked example:

- **5 sections** — comfortably inside the 4–8 range, appropriate for a 12-minute beginner lesson with a 0.4 theory/practice mix.
- **1 theory** opens with intuition + an inline Wikimedia Commons image of salt-and-pepper noise (>300 chars of markdown justifies the visual; the alt text describes exactly what the figure shows) + KaTeX formula + one explicit edge-preservation claim. It carries a section-level `sources` entry (the Wikipedia article on median filtering) because the theory leans directly on that reference; the lesson-level list still covers the rest.
- **1 image widget** (hero figure) reinforces the edge-preservation claim with a stand-alone diagram comparing median vs. mean filter outputs on a step edge. The `alt` field is detailed and specific; `caption` summarises the takeaway in one sentence; `attribution.text` follows the `Wikimedia Commons, <author>, <license>` format and `attribution.url` points at the Commons file page.
- **1 quiz** uses "mean filter" / "Gaussian filter" / "they're equivalent" as plausible distractors — all three are mistakes a learner who skimmed the theory could realistically make. The explanation justifies the right answer specifically (median ignores outliers; mean/Gaussian average them).
- **1 code exercise** has 4 tests with descriptive names and small bodies. One test is `hidden: false` so the learner sees a smoke test up front; the other three are hidden grading tests.
- **1 sandbox** closes the lesson with one warm sentence of encouragement and a starter that primes the learner to vary `k` and see the median's failure mode.
- **Lesson-level `sources` has 4 entries** mixing kinds (`article`, `book`, `video`) — comfortably above the ≥ 3 floor. The book entry carries `author` + `year` because for textbook chapters those are strongly preferred. The Wikipedia + scikit-image entries omit `author`/`year` (recoverable from the URL). All URLs are stable: Wikipedia, official scikit-image docs, the publisher's catalogue page, and an official Computerphile YouTube video — no medium / towardsdatascience.

---

## Validation Checklist Before Committing

- [ ] File written at `/courses/<courseSlug>/lessons/<lessonSlug>.json`.
- [ ] Top-level fields: `schemaVersion`, `slug`, `courseSlug`, `moduleId`, `title`, `eyebrow`, `description`, `estimatedMinutes`, `sections` — all present.
- [ ] `schemaVersion` is `1` (forward-compat baseline; US-037).
- [ ] `slug` matches the filename and the slug listed in `course.json`.
- [ ] `courseSlug` matches the directory.
- [ ] `moduleId` matches the parent module in `course.json`.
- [ ] `estimatedMinutes` matches `course.json`'s lesson entry.
- [ ] **4–8 sections**.
- [ ] At least one `theory` section.
- [ ] At least one of `quiz` (where conceptual checking helps).
- [ ] At least one of `code` or `demo` (where the topic permits hands-on).
- [ ] All `section.id` values are unique within the lesson.
- [ ] Each `code` section has 2–4 tests, each with a descriptive `name` and a small meaningful `body`.
- [ ] Each `code` section has a non-empty `solution` field with a runnable reference implementation (US-038).
- [ ] Each `quiz` has ≥ 2 options, ≥ 1 correct, plausible distractors, non-empty `explanation`, and `multiSelect` set explicitly.
- [ ] Each `theory.markdown` uses KaTeX *only where math is genuinely relevant*.
- [ ] Each `sandbox.encouragement` is one tasteful sentence.
- [ ] No `additionalProperties` smuggled into any widget `data` object.
- [ ] **Lesson-level `sources` has ≥ 3 entries** (US-040 / US-041).
- [ ] Every source has a non-empty `title`, a valid `url`, and a `kind` ∈ `{paper, video, article, book}`.
- [ ] Every source with `kind: "paper"` or `kind: "book"` carries `author` + `year` (strongly preferred — only omit if you genuinely cannot recover them).
- [ ] No source URL points at `medium.com`, `towardsdatascience.com`, `dev.to`, or other rot-prone blog hosts.
- [ ] At least one theory section that draws on a specific reference also carries a `section.sources` entry (omit on sections without a specific reference).
- [ ] `section.sources` lives at the section root (next to `id` / `title` / `type` / `data`), **not** inside `data`.
- [ ] **Every theory section with `markdown` ≥ 300 chars carries at least one inline `![alt](url)` image** where it pedagogically helps (US-051).
- [ ] **Every image — inline OR widget — has meaningful, non-placeholder alt text** (never `![](...)`, `![image](...)`, `![figure](...)`).
- [ ] All image URLs come from stable hosts (Wikimedia Commons, public-domain repositories, official docs, arxiv) — never `medium.com`, `towardsdatascience.com`, `dev.to`, personal blogs, Imgur, or social-media CDNs.
- [ ] Every Image widget section with a Wikimedia / licensed source carries `data.attribution` in the `Wikimedia Commons, <author>, <license>` format (or the equivalent for the source) and links `attribution.url` to the source description page.
- [ ] **Every `plotImage` section's saved PNG has visible X/Y axes, tick marks, numeric tick labels, axis labels (with units where applicable), and a title** (US-060) — never `plt.axis('off')`, `plt.xticks([])`, or hidden spines. PlotImage `sourceCode` reproduces that exact figure.
- [ ] `LessonSchema.safeParse` returns `success: true`.
- [ ] `npm run typecheck` passes (it should — this is a JSON-only change).

---

## Cross-references

- [`init_course/SKILL.md`](../init_course/SKILL.md) — wrote the story you're picking up; same skill defines the per-lesson AC strings and explains why `passes: true` on US-001 / US-002.
- `src/lib/schemas/lesson.ts` — `LessonSchema`, `SectionSchema` (discriminated union), Zod source of truth.
- `src/lib/schemas/course.ts` — `CourseSchema`, `ModuleSchema`, `LessonRefSchema` — describe the parent course you're authoring against.
- `src/widgets/<Name>/schema.ts` — per-widget Zod schemas. JSON mirrors live in `src/widgets/schemas/*.json` (regenerated via `npm run build:schemas`).
- `src/widgets/registry.ts` — the canonical list of `WidgetType` values and which component renders each. (Adding a new widget type is **out of scope** for this skill.)
- `scripts/ralph/CLAUDE.md` — ralph's per-iteration contract: which story to pick, how to commit, how to log progress.
