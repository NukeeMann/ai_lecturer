---
name: generate_lesson
description: "Author a single lesson JSON file at /courses/<slug>/lessons/<lesson-slug>.json. Accepts two explicit arguments — the course slug and the lesson slug — from the invoking prompt. Reads the lesson context from /courses/<slug>/course.json (find lesson by slug → recover module / estimatedMinutes / title), /courses/<slug>/research.md, and /courses/<slug>/sources.md, then composes a lesson with at least 1 `theory` section (150–400 words) followed by 2–5 widget sections that mixes widget types and validates against LessonSchema. Invoked once per lesson by the webapp's course-generation backend after research_course and design_course have written research.md / sources.md / course.json. Triggers on: generate_lesson, Run generate_lesson, generate lesson <slug>/<lesson-slug>."
user-invocable: true
---

# Generate Lesson

Produce one valid lesson JSON file for a single lesson. Each invocation handles exactly one lesson identified by `(slug, lesson-slug)`.

This skill is the back half of the course-generation pipeline. The front half is a two-agent init sequence: [`research_course`](../research_course/SKILL.md) reads the wizard's `course-spec.json` and writes `/courses/<slug>/research.md` + `/courses/<slug>/sources.md`; then [`design_course`](../design_course/SKILL.md) reads those plus the spec and writes `/courses/<slug>/course.json`. The webapp's generation backend then walks `course.json.modules.flatMap(m => m.lessons)` and invokes this skill once per lesson with the `(slug, lesson-slug)` pair.

**Do NOT touch other lesson files. Do NOT update `course.json` or `research.md` or `sources.md` (you may *append* a `## <Lesson title>` block to `sources.md` if you discover new references — see Step 4 — but never delete or rewrite existing entries).**

---

## Your Role

You are a **teacher / tutor**, not a transcriptionist. The lesson you write is the only thing standing between a learner and a working mental model of the topic — treat that responsibility seriously. A good teacher does not dump a wall of prose and walk away; they *show*, they *compare*, they *visualise*, they *check understanding*. Apply the same instinct here.

Concretely, prefer **illustration over assertion** wherever the topic permits. A few techniques a strong human tutor reaches for, in rough order of leverage:

- **Visual evidence over verbal claim.** If you find yourself writing *"the median filter preserves edges while the mean blurs them"*, that sentence is weaker than a side-by-side figure (input → median output → mean output) showing it. Reach for `plotImage`, the Image widget, or the `Code` widget's `inputs` / `outputMedia` fields *before* settling for prose. Inline `![alt](url)` images inside `theory` sections are cheap and compounding.
- **Comparisons and contrasts.** "X vs Y" framings (correct vs wrong, before vs after, naive vs optimised, two competing intuitions) are how learners actually anchor new concepts. A two-column markdown table, a paired figure, or a quiz with the wrong-answer-everyone-picks as a distractor all do this work.
- **Math where math earns its keep.** Drop into KaTeX (`$inline$` / `$$block$$`) when a formula compresses three sentences of prose into one line — but never as decoration. If the formula isn't load-bearing for the reader's understanding, it shouldn't be there.
- **Concrete numbers, worked examples, sample I/O.** A formula plus a worked example beats either alone. Code briefs that show *one* concrete input → expected output ground the abstraction immediately.
- **Markdown structure that helps the eye.** Headings (`##`/`###`) for genuine sub-beats, bullet lists for parallel items, fenced code blocks for code, tables for comparisons, blockquotes (`>`) sparingly for definitions or warnings. Don't ship a single 400-word paragraph when the same content as four bulleted points reads twice as fast.
- **Diagrams, charts, kernels, masks.** When the topic is spatial / geometric / structural (a kernel layout, a network architecture, a state machine, a coordinate system), a diagram is non-negotiable — use the Image widget for hero figures and inline images for supporting ones. For quantitative figures (curves, distributions, error vs. iteration), prefer `plotImage` so axes are readable.
- **Active checks, not just exposition.** A quiz placed after a theory beat is not a checklist item to satisfy — it's the moment the learner finds out whether the previous beat actually landed. Pick distractors that diagnose specific misconceptions from `research.md`, not throwaway "obviously wrong" options.

Lessons that read like a textbook excerpt (long unbroken prose, no figures, no comparisons, formulas dumped without context) should be rare and only when the topic genuinely permits nothing else. The rules below (≥ 1 theory beat of 150–400 words, 2–5 widget sections, inline-image floor on theory ≥ 300 chars, axes-mandatory for `plotImage`, etc.) are the **floor** — meet them, then ask yourself whether the lesson actually *teaches* the topic or merely *covers* it.

---

## The Job

> **Before you start: read [`docs/widgets.md`](../../../../docs/widgets.md)** — the canonical widget reference. Use it to pick which widgets to compose into the lesson and to crib minimal example shapes for each `data` payload. The Zod schemas in `src/widgets/<Name>/schema.ts` (mirrored as JSON Schemas under `src/widgets/schemas/`) remain the source of truth; open them when the doc is ambiguous or you need a field the summary omits.

1. Receive **two arguments** from the invoking prompt: the course `slug` and the `lesson-slug`. Validate both against the safe-slug rule (`[a-z0-9-]`, no `..`, no `/` — same rule as `assertSafeSlug` in `src/lib/server/paths.ts`).
2. Read **course context**: `/courses/<slug>/course.json`, `/courses/<slug>/research.md`, and `/courses/<slug>/sources.md`. Find the lesson in `course.json` by `slug` to recover its `moduleId`, `title`, and `estimatedMinutes`.
3. Read the **per-widget JSON Schemas** under `src/widgets/schemas/` (`theory.json`, `quiz.json`, `code.json`, `demo.json`, `sandbox.json`, `plotImage.json`).
4. **Source research pass** — identify ≥ 3 credible references for this lesson *before writing content*. Start from the matching `## <lesson title>` heading in `sources.md`; supplement with your own research only if those entries don't fully cover the lesson scope. See Step 4 for the full rules.
5. **Visual illustrations pass** — pick the inline images and Image-widget hero figures that will accompany the lesson. Lessons should be visually rich, not walls of text. See Step 5 for the rules.
6. Compose a lesson with **at least 1 `theory` section (150–400 words)** followed by **2–5 widget sections** mixing widget types. See Step 6 for the full layout rules.
7. Write `/courses/<slug>/lessons/<lesson-slug>.json` — including the `sources` field (lesson-level) plus optional `section.sources` for theory sections that draw on a specific reference.
8. Validate the file against `LessonSchema` (`src/lib/schemas/lesson.ts`). On failure, read the Zod issues, fix the JSON, retry. Never write invalid JSON.
9. Stop. The skill ends after the lesson file is written and validates.

---

## Step 1: Receive Arguments and Locate the Lesson

The invoking prompt passes two explicit arguments — the course `slug` and the `lesson-slug` of the lesson to author. Typical shapes:

```
Run generate_lesson, slug=edge-detection-basics, lesson-slug=the-canny-edge-detector
```

```
Run the generate_lesson skill for slug "edge-detection-basics" lesson-slug "the-canny-edge-detector".
```

Parse both slugs and validate them against the safe-slug rule (`[a-z0-9-]+`, no `..`, no `/`). Reject anything else and stop — do not author against an unsafe path.

The output path is fixed:

```
/courses/<slug>/lessons/<lesson-slug>.json
```

To recover the rest of the lesson context, open `/courses/<slug>/course.json` and find the matching lesson:

```ts
const lesson = course.modules
  .flatMap(m => m.lessons.map(l => ({ ...l, moduleId: m.id, moduleTitle: m.title })))
  .find(l => l.slug === lessonSlug);
```

From `lesson` and its parent module pull:

| Field             | Source in `course.json`                                  |
|-------------------|----------------------------------------------------------|
| Lesson title      | `lesson.title`                                           |
| Lesson slug       | `lesson.slug` (must equal the argument)                  |
| Course slug       | `course.slug` (must equal the argument)                  |
| Module ID         | parent `module.id` (e.g. `m1`, `m2`)                     |
| Module title      | parent `module.title` — used for `eyebrow`               |
| Module summary    | parent `module.summary` — useful for framing the lesson  |
| Lesson summary    | parent `lessonRef.summary` — when present, the author's intent for this lesson; treat as a hint, not a hard spec |
| Estimated minutes | `lesson.estimatedMinutes`                                |

If the lesson is not found in `course.json`, stop with an error — `design_course` failed to register it, and authoring against a non-existent lesson would corrupt the course folder.

For deeper subject-matter context (scope, theory/practice mix, level), lean on `research.md` and `course.json.description` / `course.json.title`. The `course-spec.json` (if still around) carries `level`, `durationTarget`, and `theoryPracticeRatio`; reading it is optional but helps tune the section mix (Step 6).

---

## Step 2: Read Course Context

Open the shared course files. `research.md` + `sources.md` are the working memory the `research_course` skill prepared for every per-lesson agent; `course.json` was finalised by the `design_course` skill that ran immediately after.

- `/courses/<slug>/research.md` — narrative reference: prerequisites, key concepts, common misconceptions, suggested ordering, and per-lesson hints under `## Notes for lesson generation`. Lean on its `Common misconceptions` for plausible quiz distractors. Lean on `Notes for lesson generation` for cues like *"Where math/KaTeX is appropriate"*, *"Where a code exercise is more illuminating than a quiz"*, *"Where a Demo widget would help"*, *"Where a Sandbox is a good fit"*.
- `/courses/<slug>/sources.md` — the curated reference list `research_course` collected during its research pass. Find the `## <lesson title>` heading whose title matches `lesson.title` and copy ≥ 3 entries into `lesson.sources` directly. Also consider `## Course-wide references` for cross-lesson textbooks. If the file is missing (older course or hand-written course folder), fall back to your own research per Step 4.
- `/courses/<slug>/course.json` — authoritative structure. You already opened it in Step 1 to find the lesson; keep it open to cross-check `slug` / `moduleId` / `estimatedMinutes` while drafting.

If `course.json` lists a different `slug` or different `estimatedMinutes` than any external context (e.g. a stale prompt), **trust `course.json`**. The course file is the source of truth.

---

## Step 3: Read Widget Schemas

Open the per-widget JSON Schemas under `src/widgets/schemas/`:

- `theory.json` — `{ markdown: string }`
- `quiz.json` — `{ question, options[≥2], correct[≥1], explanation, multiSelect }`
- `code.json` — `{ taskMarkdown, starterCode, tests: [{ name, body, hidden? }], solution?, inputs?: CodeInput[], outputMedia? }` — `inputs[]` is a discriminated union by `kind` (`"image"` / `"video"` / `"file"` / `"text"`); `outputMedia` is a single `{ kind: "image"|"video", src, ... }`. Use these on image / signal / file-processing exercises to render a side-by-side *input → expected output* figure above the editor.
- `demo.json` — `{ demoType: "gauss", imageSrc, params: { sigmaMin, sigmaMax, sigmaDefault } }` — **gauss only for now**; do not invent new `demoType` values
- `sandbox.json` — `{ starterCode, encouragement }`
- `plotImage.json` — `{ src, alt, caption?, sourceCode?, sourceLanguage? }` — pre-rendered matplotlib PNG served from `/api/courses/<slug>/assets/plots/...`. The `sourceCode` MUST match the saved PNG byte-for-byte (re-running it must reproduce the same plot).

These JSON Schemas are generated from the Zod schemas in `src/widgets/<Name>/schema.ts` via `npm run build:schemas`. The Zod schemas are the runtime source of truth (`src/lib/schemas/lesson.ts → SectionSchema` is a `discriminatedUnion('type', [...])` over the section types). When in doubt, open the Zod file alongside the JSON Schema.

`additionalProperties: false` everywhere — every extra field you put on a widget `data` object is a validation error. Stick to what the schema declares.

---

## Step 3a: Authoring a New Widget Type (when no existing widget fits)

The widget set is **not closed**. If you have a concrete pedagogical idea for the lesson you're authoring and **no existing widget cleanly expresses it** — and the same shape would plausibly help future lessons too — you are allowed (and encouraged) to add a new first-class widget type rather than abusing `custom` or forcing the content into a poor-fit existing widget.

### When to author a new widget vs. reuse / use `custom`

Author a new widget when **all** of the following hold:

- An existing widget would either silently lose information (the data doesn't fit its schema) or actively mislead the learner (you'd be using e.g. `dataTable` for something that isn't tabular).
- The interaction or visualisation is **reusable** — at least 2–3 future lessons in this course (or related courses) could plausibly use the same widget. One-off content is `custom` territory, not a new type.
- You can describe the widget's `data` shape in a small, concrete Zod schema (≤ ~10 fields, no open-ended JSON blobs).
- The component is **renderable in a Next.js client component** with the dependencies already present in `package.json`. Do not pull in new heavy libraries (3D engines, video editors, ML runtimes) just to ship one widget.

If any condition fails: prefer reusing the closest existing widget (and live with a slightly imperfect fit), or fall back to `custom` for genuinely one-off cases.

### How to author the new widget

The canonical 5-step procedure lives in [`src/widgets/README.md`](../../../../src/widgets/README.md) — read it end-to-end before you touch any file. Briefly, you must:

1. Pick a `--widget-<name>` accent colour and add it to **both** light and dark blocks of `src/styles/tokens.css`.
2. Define the Zod schema at `src/widgets/<Name>/schema.ts` (export both `<Name>DataSchema` and the inferred `<Name>Data` type).
3. Build the React component at `src/widgets/<Name>/<Name>Widget.tsx` (props: `{ data: <Name>Data }`; the Widget chrome is provided by `Widget.tsx`).
4. Add an editor form at `src/widgets/<Name>/<Name>Editor.tsx` and wire it into `src/app/courses/[slug]/lessons/[lessonSlug]/page.tsx` (`WidgetEditPanel` import + branch). The editor lets a human edit the JSON in the side panel — without it, the new section type is read-only in the UI.
5. Export a typed fixture from `src/widgets/<Name>/sample.ts`.
6. Register the widget in `src/widgets/registry.ts` (add to `WidgetType` union and to `widgetRegistry`).
7. Add the schema to `src/widgets/schemas/build.ts` and run `npm run build:schemas` so `<name>.json` is regenerated alongside the others.
8. **Extend the lesson schema** at `src/lib/schemas/lesson.ts`: import `<Name>DataSchema`, define `<Name>SectionSchema = z.object({ ...sectionBase, type: z.literal('<name>'), data: <Name>DataSchema })`, and add it to the `SectionSchema` discriminated union. Without this step, lessons that include the new section type will be **rejected** by the API on save/load even though the renderer would handle them.
9. Run `npm run typecheck` and `npm run test -- src/lib/schemas/schemas.test.ts` to confirm nothing is wired up half-way.

After all of that, you may emit lesson JSON that uses `"type": "<name>"`. Treat the widget exactly like a built-in for the rest of this skill — the per-widget rules below also apply (descriptive titles, optional `description`, sources where appropriate, accessible alt text on any images).

### What you must NOT do

- Touch `scripts/ralph/` (that's the orchestrator, off-limits to this skill — same rule as the rest of generate_lesson).
- Modify another existing widget's schema to "make room" for your case. Either add an optional field that's strictly an addition (no semantic shift), or author the new widget type — never repurpose an existing schema.
- Skip step 8. A widget that renders but doesn't validate is a foot-gun: the first save/load round-trip will silently drop the section.
- Add a new widget type "just in case" while authoring a numeric / quiz / theory lesson where existing widgets clearly suffice. New types must pay for themselves.

---

## Step 4: Source Research

**Do this before writing content.** Lessons without credible references are out of scope; the `sources` field on `LessonSchema` (US-040) exists precisely so the learner can verify and dig deeper.

### What to collect

Identify **at least 3 credible sources** for this lesson. Aim for a mix:

- **Papers** — original or canonical results, ideally with a DOI or arxiv URL (`https://doi.org/...`, `https://arxiv.org/abs/...`).
- **Textbook chapters** — named chapter from a recognised textbook (e.g. *Gonzalez & Woods, "Digital Image Processing", Ch. 5*). Use the publisher / archive URL where available.
- **Reputable articles** — Wikipedia for foundational concepts (it is stable and well-edited for established maths/CS topics), official documentation pages (`scikit-image`, `numpy`, `scipy`, `pytorch`), MDN / W3C, IETF RFCs.
- **Recognised educational videos** — channels with editorial standards: 3Blue1Brown, StatQuest with Josh Starmer, Computerphile, Two Minute Papers, MIT OpenCourseWare, Khan Academy. Use the canonical YouTube URL.

The starting point is the matching `## <lesson title>` block in `/courses/<slug>/sources.md` — `research_course` curated ≥ 3 entries per lesson there. Copy them over wholesale unless you have a specific reason to drop one. Add fresh entries only if a section truly needs a reference the bibliography is missing.

### URL stability rules

Prefer URLs that are unlikely to rot:

- **Yes:** DOI links, arxiv abstract pages, `en.wikipedia.org/wiki/...`, official project docs at versioned or stable paths, official YouTube channel video URLs, IETF / W3C standards, university course pages.
- **No:** medium.com, towardsdatascience.com, dev.to, personal blogs on substack/wordpress/blogspot, Quora / StackOverflow answers (use as research input, not as a cited source), random Google Drive / Dropbox PDFs, social media posts.

When in doubt, prefer the *primary* source: cite the arxiv paper rather than a blog post that summarises it; cite the official docs rather than a tutorial that wraps them.

### URL verification — MANDATORY before recording

Every URL you put into `lesson.sources`, `section.sources`, or `sources.md` MUST be verified to resolve before you record it: fetch it (WebFetch, or `curl -sIL --max-time 10 "<url>"` via Bash) and confirm it does not 404/410. Never cite a URL you have not seen resolve in this session — and never write a DOI from memory; copy it from the paper's landing page (invented DOIs are the most common dead-link failure). The generation pipeline runs a liveness gate over every cited URL after the lesson validates: a 404/410 fails the attempt and the retry brief lists the dead URLs verbatim, forcing a redo.

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

### Recording in `sources.md`

If you discover useful sources beyond what `research_course` recorded in `/courses/<slug>/sources.md`, append them to that file under the existing `## <Lesson title>` heading (optional but encouraged). Future lessons in the same course can re-use them.

**If `sources.md` exists but has NO `## <lesson title>` heading for this lesson** — typical for lessons added after initial generation via the Extend flow — do your own source research per this step and APPEND a new `## <Lesson title>` block carrying the ≥ 3 entries you used. This case is required, not optional: without the block, later regenerations and sibling lessons have no bibliography to reuse.

Never delete or rewrite entries written by `research_course` or by other per-lesson agents.

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

### Mandatory local caching of every external image

**Every image that ends up in the lesson MUST be cached locally before you exit.** This applies to inline `![alt](url)` images in `theory.markdown`, `plotImage.data.src`, `demo.data.imageSrc`, `code.data.inputs[].src`, `code.data.outputMedia.src`, and `mp4`-kind `video.data.src`. External `http(s)://` URLs in any of these positions are rejected by the generation pipeline's asset gate (`findLessonAssetIssues` in `src/lib/server/lessonAssets.ts`) — the lesson attempt is marked failed and the retry brief lists every offending URL.

Workflow for each external image you want to use:

1. **Pick a stable, descriptive filename based on what the image shows**, not the original CDN path. `pinhole-camera-diagram.png`, `salt-pepper-noise-cameraman.png`, `median-vs-mean-step-edge.png` — not `640px-Pinhole-camera.svg.png` or `thumb_3_3b_xyz.png`.
2. `mkdir -p courses/<slug>/assets/images/` if the directory doesn't exist yet.
3. Download via `Bash`:

   ```bash
   curl -L -o courses/<slug>/assets/images/<filename> "<URL>"
   ```

4. Rewrite the markdown reference (or `data` field) to point at the local API path instead of the external URL:

   ```markdown
   ![alt text](/api/courses/<slug>/assets/images/<filename>)
   ```

5. Keep the original URL in the section-level `sources` entry (`url:` field) and the attribution text — local caching does **not** erase the source-of-truth pointer, only the runtime fetch.

Only YouTube videos on `video` sections with `kind: "youtube"` are allowed to remain as external URLs (the player needs the YouTube URL to embed). Everything else must be locally hosted.

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
  sections: [ ... ],            // ≥1 theory + 2–5 widgets; see below
  sources: [ ... ],             // ≥3 entries; see Step 4
}
```

`eyebrow` is a short label (≤ 24 chars) — a category tag. The runtime currently overlays `Module N · Lesson M` from the course position, so `eyebrow` is mostly schema ballast for now, but it's still required. Pick the module title in uppercase or `INTRO` / `PRACTICE` / `RECAP`.

### Section count and mix

- **At least 1 `theory` section per lesson, each 150–400 words.** Multiple theory beats are allowed (and encouraged when the topic naturally splits into distinct sub-beats — e.g. *intuition / definition* then *formal derivation / edge cases*; or *forward direction* then *failure modes*) — but a single solid theory section is acceptable when the topic is tightly scoped.
- **2–5 widget sections per lesson** (any non-theory type: `quiz`, `code`, `demo`, `sandbox`, `image`, `plotImage`, `custom`). This is the total widget budget for the lesson, regardless of how the theory sections are split. Typical shapes:

  ```
  [theory] → [2–5 widgets]                                  (single theory beat, the common case)
  [theory] → [1–3 widgets] → [theory] → [1–2 widgets]       (two beats, widgets split across them)
  ```

  - Do **not** stack two `theory` sections back-to-back. If you use more than one theory beat, place at least one widget between consecutive theories.
  - **No lesson ends on a bare `theory` block** — the last theory section must be followed by at least one widget.
- **Always start with a `theory` section** (so the learner has context before the first interactive section).
- **At least 1 `quiz` section where conceptual checking helps.** Skip only if the lesson is pure mechanics (e.g. a hands-on debug walkthrough where a quiz feels artificial).
- **At least 1 `code` section OR 1 `demo` section where the topic permits hands-on.** For numeric / image / signal topics with a task the local kernel can run in ≤ 30 s, prefer `code`. For visual intuition that benefits from a slider (currently only the `gauss` blur demo) prefer `demo`.
- **At most one `demo` section per lesson** (the only registered demo is `gauss`; reusing it twice is redundant).
- A `sandbox` section is a nice closer for hands-on lessons — encourages free exploration after the graded code exercise. Optional.
- A `custom` section is an escape hatch for things no widget covers; use sparingly and only when the topic genuinely warrants it.

When the invoking prompt or `course-spec.json` carries a `Theory/practice mix` (0..1), use it to tune the balance — but **the ≥ 1 theory section + 2–5 widget shape is non-negotiable in every case**:

- `≤ 0.3` → lean practice: 1 theory beat (kept compact) + 4–5 widgets weighted toward `code` / `sandbox` / `demo` (e.g. 2 code + 1 quiz + 1 sandbox).
- `0.4–0.6` → balanced: 1–2 theory beats + 3–4 widgets (mix of `quiz`, `code`, `image` / `plotImage`).
- `≥ 0.7` → lean theory: 1–2 theory beats + 2–3 widgets weighted toward `quiz` / `image` / `plotImage`; code/sandbox only if the topic clearly invites it.

If no ratio is given, default to the balanced mix.

### Section IDs

`section.id` must be unique within the lesson. Use stable, content-bearing slugs (`"intro"`, `"definition"`, `"why-it-works"`, `"check-1"`, `"exercise"`, `"sandbox"`) — not opaque counters like `s1`/`s2`. Section-ID collisions are a schema-level hard fail.

### Section description (optional, US-113)

Every section type accepts an OPTIONAL `description: string` field on the section base (alongside `id`, `title`, `sources`). When present, it renders below the section title and above the widget body in the existing secondary-text style — useful when the title alone is too terse to convey the task.

- Use it on `quiz`, `code`, `codeCloze`, `demo`, `sandbox`, `image`, `plotImage`, `parametricExplorer`, `dragMatch`, `dataTable`, `video`, and `custom` sections where a one-sentence framing helps the learner know *what to look for / what to do* before they engage with the widget body.
- **Skip it on `theory`** — the markdown body is already prose; a separate description above the markdown is redundant.
- Keep it to **one short sentence** (≤ 160 chars). Don't repeat the title verbatim; add information the title can't fit.
- Omit the field entirely when no extra context is warranted — empty / whitespace strings should not be emitted. Widgets without a description render unchanged.

### Per-widget content rules

#### Theory (`type: "theory"`)
- `data.markdown` is plain markdown rendered with KaTeX support (`$inline$` and `$$block$$`).
- Use KaTeX where math is genuinely relevant (formulas, summations, kernels) — don't force LaTeX into prose.
- Use fenced code blocks for code snippets (\`\`\`python ... \`\`\`).
- Length: **150–400 words per theory section.** Use the lower half of the range when the topic splits into multiple theory beats and each one is a short focused sub-section; use the upper half when the lesson has a single theory beat that needs to carry real weight on its own.
- Headings: don't open with `# `; the section's own title is already a heading. Use `##` / `###` for sub-structure if needed.
- **Don't ship a wall of prose.** Apply the *Your Role* principles at the top of this skill: break the markdown with bullet lists for parallel items, short tables for X-vs-Y comparisons, blockquotes for definitions / warnings, and at least one `![alt](url)` inline image whenever the section is ≥ 300 chars and the topic is visualisable (almost always — kernels, signals, plots, architectures, before/after pairs, geometric layouts). KaTeX formulas and worked numeric examples beat hand-wavy prose every time the topic involves quantities. A theory section that is one unbroken 350-word paragraph with no formula, no list, no figure, and no code is a *failure mode*, not a default.
- **Mermaid diagrams** render from a fenced ```` ```mermaid ```` block (`flowchart` / `sequenceDiagram` / `mindmap`). Reach for one when the *relationship between parts* is the point — a processing **pipeline**, a **data/control flow**, a **concept map**, or an **architecture / state machine**. Use KaTeX for formulas (not a diagram), `plotImage` / `histogram` for quantitative charts (Mermaid has no axes), and an inline image for photographic / pixel-accurate figures. Keep it small (**~15 nodes max**), write valid Mermaid syntax, and **never add inline `style` / `classDef` colour overrides** — the renderer maps the diagram onto the active theme (light / dark / sunset), and hard-coded colours break that. Example:

  ````markdown
  ```mermaid
  flowchart LR
    A[Raw frame] --> B[Grayscale] --> C[Threshold] --> D[Contours]
  ```
  ````

#### Quiz (`type: "quiz"`)
- `question` is a single, unambiguous prompt.
- `options` ≥ 2; aim for 3–4 with **plausible distractors** drawn from the `Common misconceptions` section of `research.md` — wrong answers a learner could *realistically* pick after rushing the theory.
- `correct` is an array of integer indices into `options`. For single-answer quizzes use one index; for multi-select use ≥ 1 indices.
- **Spread the correct answer across positions.** LLMs have a strong recency / first-position bias and naturally tend to put the correct option at index 0 ("A"). Resist this. Within a single lesson, the correct index should be distributed roughly uniformly across all positions — if the lesson has 8 quizzes, you should see ≈ 2 of each of A/B/C/D, not 6× A. **Never make more than 40% of a lesson's quizzes have the same correct index.** When you draft a quiz, after choosing the correct answer, ask yourself "did the last quiz also have correct=[N]?" — if yes, shuffle the options before writing JSON so the right answer lands somewhere else.
- **Multi-select: never make ALL options correct.** A quiz where every option is in `correct[]` teaches nothing (the learner can pass by ticking everything). If the topic genuinely has 4 true statements, either (a) add 1–2 plausible-but-false distractors so the answer ratio becomes e.g. 4/6, or (b) split into two single-select quizzes. Aim for `correct.length` between 2 and `options.length - 1` for multi-select.
- `multiSelect: false` for "exactly one right answer", `true` for "select all that apply".
- `explanation` is non-empty and *justifies the right answer specifically* — don't just paraphrase the question. Reference the concept from the preceding theory.

#### Code (`type: "code"`)
- `taskMarkdown` is a short brief: 1–3 sentences + a fenced example I/O block where useful. Tell the learner what function name to define.
- `starterCode` is runnable Python executed on the **local IPython kernel runtime** (US-201/US-202) — a real CPython venv at `~/.ai-lecturer/py-runtime`, NOT in-browser Pyodide. Provide an empty function shell + minimal scaffolding — never the solution. Baseline imports available out of the box: `numpy`, `cv2` (**real OpenCV**, not a shim), `matplotlib`, `torch` (CPU), `tensorflow`. `scipy`, `scikit-image`, `PIL`/Pillow, and `pandas` are NOT in the baseline venv — stick to the baseline; only reach beyond it when the exercise truly needs to, and then declare the import in `requiresPackages` (the widget will show a "missing packages" hint until the user installs the wheel).
- **Each Run is capped at 30 s on the kernel.** Design the exercise (and its `solution`) to finish well under that — toy-scale data only. `torch` / `tensorflow` exercises must stay at tiny-tensor scale (a forward pass, a handful of gradient steps) — never a real training loop.
- `tests`: **2–4 tests per exercise**. Each test:
  - has a **descriptive `name`** like `"returns_zero_for_empty_input"` or `"handles_negative_numbers"` — not `"t1"`/`"test_a"`.
  - has a **meaningful but small `body`** — one or two `assert` lines at most. Tests run on the kernel, each in a fresh copy of the learner's namespace (no pytest), so plain `assert` works. Use `==`, not `np.allclose` unless floating point demands it; if it does, set `atol`/`rtol` explicitly. `cv2` is real OpenCV here, so asserting on its actual output is legitimate — but still prefer shape / dtype / coarse-statistics checks where library-version drift could bite.
  - omit `hidden` to default to `true` (hidden-with-peek), or set `hidden: false` to expose a sample test that the learner can read while solving. A common pattern: one visible "smoke test" + 1–3 hidden grading tests. (See memory: *Code widget tests hidden by default* — final UI is hidden-with-peek.)
- Test bodies must reference the function/variable the learner is meant to define. Don't redefine helpers inside test bodies; the learner's namespace is in scope.
- **Always populate `solution`** with a runnable reference implementation that would pass every test. The learner reaches it via the always-available *Peek solution* button (US-038); never leave `solution` empty for a code exercise. Keep the solution idiomatic and minimal — one clean implementation, not the full set of edge-case branches you'd put in production.
- **`inputs?` and `outputMedia?` (optional)** — populate when the task acts on a concrete artefact (image, signal, video frame, sample CSV) and the learner benefits from seeing what to consume and what to produce. The Code widget renders `inputs` and `outputMedia` side-by-side in a single 50/50 row above the editor, so prefer assets of similar aspect ratio for visual symmetry.
  - `inputs[]` is a discriminated union by `kind`: `"image"` (`{ src, alt?, caption?, filename? }`), `"video"` (`{ src, caption?, filename? }`), `"file"` (`{ src, filename, caption? }`, downloadable), or `"text"` (`{ content, label? }`, rendered in a monospace box for raw fixtures / sample text). Use multiple entries for multi-input tasks (e.g. two frames for stereo matching).
  - `outputMedia` is a single image OR video showing the **expected** result the learner's code should reproduce — `{ kind: "image"|"video", src, alt?, caption?, live? }`.
  - Asset paths follow the same convention as `plotImage`: save under `courses/<slug>/assets/...` and reference as `/api/courses/<slug>/assets/...` (the route is content-typed correctly). External URLs work but are not cached locally for these fields.
  - **Kernel `/inputs/` mount.** Every `image` / `video` / `file` input is fetched server-side and written into `/inputs/<filename>` in the kernel session before `starterCode` runs (US-201). The mount filename defaults to the **basename of `src`** (e.g. `/api/courses/foo/assets/in.png` → `/inputs/in.png`); set the optional `filename` field to override when `src` is opaque (signed URL, query-only path). `text` inputs are NOT mounted — they exist only for on-screen reference. Write `starterCode` that opens the mounted path directly — `cv2.imread('/inputs/scene.png')`, `open('/inputs/data.csv')` — not the public `/api/...` URL.
  - **`outputMedia.live: true`** (image-only) turns the static `src` into a placeholder: it stays visible only until the learner clicks ▶ Run, then the matplotlib figure their code produces replaces it live (US-174). Use `live: true` whenever the exercise ends with `plt.imshow(...)` / `plt.plot(...)`; the static `src` is then the *reference output* the learner is trying to match. Without `live`, the image is purely informational and never changes.
  - When you ship `outputMedia`, the tests should still verify the output numerically — the image is for human reference, not the grader. Don't rely on the learner eyeballing the figure.
  - **Skip both fields** for purely numeric / algorithmic exercises (sorting, statistics, parsing) — they only add visual noise when there is no artefact to look at.
- **`requiresPackages?: string[]`** — import names that must be importable in the kernel runtime before the exercise is runnable. This is a **precondition check** (US-202/US-203), not an install request: the widget probes the kernel venv and shows a "missing packages" banner listing anything absent — nothing is downloaded or shimmed. Declare every non-stdlib import your `starterCode` / `solution` / tests use beyond `numpy` + `matplotlib`:
  - `["cv2"]` — real OpenCV (`opencv-python`), always present in the baseline venv.
  - `["torch"]`, `["tensorflow"]` — CPU wheels, always present in the baseline venv.
  - Anything outside the baseline (`scipy`, `skimage`, `PIL`, `pandas`, …) will show as missing until the user pip-installs it into `~/.ai-lecturer/py-runtime` — avoid unless the lesson genuinely needs it. Omit the field for stdlib-only / numpy-only / matplotlib-only exercises.

#### Demo (`type: "demo"`)
- Only `demoType: "gauss"` is registered (see `src/widgets/registry.ts`). Don't invent new types.
- `imageSrc` should be a path the webapp can serve. Existing demos use `/cameraman.png` or `/<course-slug>/<image>.png`. If the asset doesn't exist yet, leave a TODO in the lesson notes — but still pick a path that *would* live under `public/`.
- `params.sigmaMin` < `params.sigmaDefault` < `params.sigmaMax`. Reasonable range: `0–6` for an introductory blur demo.

#### Sandbox (`type: "sandbox"`)
- Runs on the same per-lesson IPython kernel as the Code widget — identical runtime rules (baseline venv: `numpy`, real `cv2`, `matplotlib`, `torch`, `tensorflow`; 30 s per-run cap). The schema also accepts the Code widget's optional `inputs`, `outputMedia`, and `requiresPackages` fields with the same semantics.
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
- **Run the `sourceCode` via `Bash` to materialize the PNG before you stop.** Authoring the JSON is half the job — the file at `courses/<slug>/assets/plots/<lesson-slug>-<n>.png` must physically exist on disk by the time you exit. The generation pipeline now performs an asset-presence gate after schema validation (`findMissingLessonAssets` in `src/lib/server/lessonAssets.ts`): if the `data.src` you referenced doesn't resolve to a real file, the attempt is marked failed and the retry brief lists every missing path verbatim, forcing you to redo the work. Pattern: write the lesson JSON → `mkdir -p courses/<slug>/assets/plots/` → `python3 -c "<sourceCode>"` (or write to a tmp script and execute it) → `ls -la courses/<slug>/assets/plots/` to confirm the file landed → only THEN consider the lesson done.

#### Custom (`type: "custom"`)
- Use only when no other widget fits AND the case is genuinely one-off (will not recur in future lessons). `data` is a free-form record. The renderer is `CustomPlaceholder`, so this section currently displays as a stub — useful for marking "future widget here" but not for shipping content.
- **If the same shape would help 2–3 future lessons, author a new first-class widget type instead** (see *Step 3a*) rather than shipping a `custom` stub. `custom` is a placeholder, not a delivery vehicle.

#### AudioPlayer + transcript-cloze: defer audio synthesis to the pipeline (US-157)

For language-focused courses where you want spoken audio (a teacher reading a passage, an example dialogue, a listening exercise), do **not** try to author or upload `.wav` files yourself. The webapp's generation backend ships a server-side TTS post-processor (US-154 + US-157) that runs after `generate_lesson` exits and synthesises audio for any AudioPlayer or transcript-cloze section you mark.

To opt into automatic TTS for a section, emit it with the sentinel value `audioPath: "AUTO_TTS"` plus the source text the engine should speak:

- **AudioPlayer** — the source text lives in a temporary `audioSourceText` field next to `audioPath`. The post-processor consumes it, synthesises the audio, replaces `audioPath` with a real relative path under `assets/audio/<lesson-slug>-<section-id>.wav`, and **strips `audioSourceText` from the section before write**. Do not also populate `audioSourceText` when `audioPath` is a real path — it would be silently dropped by the public schema and only adds noise to your output.
- **transcript-cloze** — the section's existing `transcript` field is itself the audio source; no separate `audioSourceText` is needed.

Examples:

```json
{
  "id": "listen-passage",
  "title": "Listen: ordering coffee in Vienna",
  "type": "audioPlayer",
  "data": {
    "audioPath": "AUTO_TTS",
    "audioSourceText": "Guten Morgen. Ich hätte gern einen kleinen Braunen, bitte.",
    "title": "Café dialogue",
    "transcript": "Guten Morgen. Ich hätte gern einen kleinen Braunen, bitte."
  }
}
```

```json
{
  "id": "fill-the-fox-cloze",
  "title": "Fill in the blanks while you listen",
  "type": "transcriptCloze",
  "data": {
    "audioPath": "AUTO_TTS",
    "transcript": "The quick brown fox jumps over the lazy dog.",
    "blanks": [
      { "wordIndex": 1, "answer": "quick" },
      { "wordIndex": 5, "answer": "over" }
    ]
  }
}
```

Notes:

- **The sentinel is opt-in.** If you have a pre-recorded WAV in the course's `assets/audio/` directory, just reference it directly — `"audioPath": "assets/audio/my-clip.wav"` — and skip both `AUTO_TTS` and `audioSourceText`. The pipeline will leave that section alone.
- **Validation.** During pipeline post-processing the lesson is checked against the internal `LessonSchemaWithSentinel` variant (which permits `AUTO_TTS` and `audioSourceText`). Once TTS completes, the lesson is re-validated against the strict public `LessonSchema` before write — so if you ever see `AUTO_TTS` in a committed lesson file, that's a bug. Do not author a lesson where the agent is expected to invoke TTS itself; the post-processor handles it.
- **Failure mode.** If TTS is not installed (engine missing) or the source text exceeds the engine's per-call cap, the pipeline marks the lesson generation as failed and emits the TTS error in the live log. The user's recourse is to install TTS via `scripts/setup-tts.sh` (US-154) or to manually edit the generated lesson to remove the audio component. **Do not author audio sections speculatively if the course's topic doesn't justify it** — every audio section blocks lesson completion on a successful TTS spawn.
- **Caching.** A per-section sidecar `assets/audio/<lesson-slug>-<section-id>.wav.meta.json` records the SHA-256 of the source text, so iterative regenerates that don't change `audioSourceText` / `transcript` reuse the existing `.wav` instead of re-spawning the engine. Out of scope: voice selection per-section (uses the default voice from US-154); multi-voice dialogue rendering; non-English TTS.

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
5. **Never write an invalid lesson file.**

Only finish when the validator prints `OK`.

---

## Step 8: Stop

You're done. The lesson file is written and validates against `LessonSchema`. The webapp's generation backend reads the file's existence + validation result to decide whether this lesson succeeded; it then moves on to the next `(slug, lesson-slug)` pair. Do not author further lessons in the same invocation — one call, one lesson.

---

## Worked Example: Median filter

Invoking prompt (abbreviated):

```
Run generate_lesson, slug=image-denoising, lesson-slug=median-filter.
```

Lookup in `/courses/image-denoising/course.json` finds the lesson under module `m2` (`Non-linear filters`) with `estimatedMinutes: 12`. `research.md` lists "salt-and-pepper noise", "edge preservation", and "complexity tradeoffs" as the relevant key concepts; `sources.md` has a `## Median filter` block with three pre-curated entries.

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
      "id": "algorithm",
      "title": "Computing the median: window, sort, pick",
      "type": "theory",
      "data": {
        "markdown": "Now that we have intuition for *why* the median preserves edges, let's pin down the **algorithm** the filter actually runs at every pixel.\n\nFor a window of side $k$ around pixel $(i, j)$:\n\n1. **Gather** the $k^2$ neighbour values into a local array (with edge replication when the window overhangs the image).\n2. **Sort** that array (or use a partial selection algorithm — `numpy.partition` is enough; a full sort is wasted work).\n3. **Pick** the middle element ($\\lfloor k^2 / 2 \\rfloor$, since $k$ is odd) and write it back to $\\hat I(i, j)$.\n\nNaively this is $O(N \\cdot k^2 \\log k^2)$ for an $N$-pixel image — fine for $k = 3, 5$, slow for $k = 11$ on a multi-megapixel photo. Production implementations (`scipy.ndimage.median_filter`, `cv2.medianBlur`) use **histogram-based sliding** (Huang 1979) or **constant-time forgetful selection** (Perreault & Hébert 2007) to bring the per-pixel cost down to $O(1)$ in $k$.\n\nA second consequence of the algorithm: the median filter is **not separable**. Unlike a Gaussian — which can be applied as a 1-D row pass followed by a 1-D column pass — the median of a 2-D window is *not* the median of medians. Don't try to factor it; either run a true 2-D window or use a separable approximation only when you can tolerate the error."
      },
      "sources": [
        {
          "url": "https://doi.org/10.1109/TASSP.1979.1163188",
          "title": "A Fast Two-Dimensional Median Filtering Algorithm",
          "kind": "paper",
          "author": "T. Huang, G. Yang, G. Tang",
          "year": 1979
        }
      ]
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
      "id": "failure-modes",
      "title": "When the median breaks",
      "type": "theory",
      "data": {
        "markdown": "The median is the right tool for **impulse noise** — a few extreme outliers in an otherwise clean signal. It is the *wrong* tool for several other regimes, and a learner who reaches for it indiscriminately will be disappointed.\n\n**Gaussian noise.** If every pixel is perturbed by a small zero-mean Gaussian, the median has nothing to discard — there are no outliers, just a fuzzy distribution. A mean (or Gaussian) filter is statistically optimal here; the median is no better than the mean and is more expensive to compute.\n\n**Dense impulse noise.** The robustness guarantee — that the median ignores up to $\\lfloor (k^2 - 1)/2 \\rfloor$ outliers per window — only holds while corrupted pixels are a *minority* of the window. Once more than half of a $k \\times k$ window is salt-or-pepper, the median itself becomes one of the noisy values and the filter starts smearing the noise instead of removing it. The fix is a larger $k$, but a larger $k$ also blurs fine texture.\n\n**Thin lines and small features.** A 3-pixel-wide line in a $5 \\times 5$ median window is a minority of the window — the median throws it away. Edge preservation only kicks in when the feature is more than half the window in *both* dimensions. For thin structures (vessels in medical imaging, scratches in restoration), a different non-linear filter (rank, conservative, or anisotropic) is usually a better fit."
      }
    },
    {
      "id": "check-failure-modes",
      "title": "Quick check: when does the median fail?",
      "type": "quiz",
      "data": {
        "question": "Which of the following are scenarios where a 3×3 median filter performs *worse* than a 3×3 Gaussian filter? Select all that apply.",
        "options": [
          "Removing isolated pure-white pixels from an otherwise clean photo",
          "Denoising an image with low-amplitude zero-mean Gaussian noise on every pixel",
          "Cleaning an image where 60% of pixels have been replaced with random salt-or-pepper",
          "Restoring a 1-pixel-wide horizontal line that was preserved through transmission"
        ],
        "correct": [1, 2, 3],
        "explanation": "The median dominates only when corrupted pixels are a *minority* of the window AND the surviving features are more than half the window. For dense Gaussian noise (every pixel perturbed) the mean is statistically optimal and the median has no outliers to discard. For >50% salt-and-pepper the noisy values become the majority of the window, so the median IS one of them and stops working — only a larger window or a different filter recovers. And a 1-pixel-wide line is a minority of any 3×3 window, so the median throws it away while a Gaussian merely softens it.",
        "multiSelect": true
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

- **8 sections — 3 theory beats + 5 widget sections** — this lesson uses the **upper end** of the 2–5 widget budget because the topic naturally splits into three distinct why/how/when beats. Each theory beat (*intuition* → *algorithm / complexity* → *failure modes*) is followed by 1–2 widgets — no two theory sections back-to-back, no lesson ending on a bare theory. Equally valid for a tightly-scoped variant of the same topic: a single 350-word theory beat followed by 4 widgets (image → code → quiz → sandbox). The chosen shape here matches a 12-minute beginner lesson with a 0.4 theory/practice mix.
- **Beat 1 — theory (intuition) → image → quiz.** The first theory section opens with intuition + an inline Wikimedia Commons image of salt-and-pepper noise (>300 chars of markdown justifies the visual; the alt text describes exactly what the figure shows) + KaTeX formula + one explicit edge-preservation claim. It carries a section-level `sources` entry (the Wikipedia article on median filtering) because the theory leans directly on that reference. The image widget (hero figure) reinforces the edge-preservation claim with a stand-alone diagram comparing median vs. mean filter outputs on a step edge — `alt` detailed and specific; `caption` summarises the takeaway in one sentence; `attribution.text` follows the `Wikimedia Commons, <author>, <license>` format. The quiz uses "mean filter" / "Gaussian filter" / "they're equivalent" as plausible distractors.
- **Beat 2 — theory (algorithm) → code.** The second theory section pivots from *why* (intuition) to *how* (the window/sort/pick algorithm + complexity + non-separability), with KaTeX for the per-window cost and a section-level `sources` entry pointing at the Huang 1979 paper that introduced the histogram-based sliding optimisation. The code exercise has 4 tests with descriptive names and small bodies — one test is `hidden: false` so the learner sees a smoke test up front; the other three are hidden grading tests.
- **Beat 3 — theory (failure modes) → quiz → sandbox.** The third theory section pivots one final time, from *how* (the algorithm) to *when* (the regimes where the median is the *wrong* tool: Gaussian noise, dense impulse noise > 50% of the window, thin features). The follow-up quiz is multi-select and forces the learner to apply the failure-mode reasoning to three concrete scenarios; the explanation re-grounds each correct option in the rule from the preceding theory. The sandbox closes the lesson with one warm sentence of encouragement and a starter that primes the learner to vary `k` and the noise rate and see the median's failure mode for themselves.
- **Lesson-level `sources` has 4 entries** mixing kinds (`article`, `book`, `video`) — comfortably above the ≥ 3 floor. The book entry carries `author` + `year` because for textbook chapters those are strongly preferred. The Wikipedia + scikit-image entries omit `author`/`year` (recoverable from the URL). All URLs are stable: Wikipedia, official scikit-image docs, the publisher's catalogue page, and an official Computerphile YouTube video — no medium / towardsdatascience.

---

## Validation Checklist Before Finishing

- [ ] File written at `/courses/<courseSlug>/lessons/<lessonSlug>.json`.
- [ ] Top-level fields: `schemaVersion`, `slug`, `courseSlug`, `moduleId`, `title`, `eyebrow`, `description`, `estimatedMinutes`, `sections` — all present.
- [ ] `schemaVersion` is `1` (forward-compat baseline; US-037).
- [ ] `slug` matches the filename and the slug listed in `course.json`.
- [ ] `courseSlug` matches the directory.
- [ ] `moduleId` matches the parent module in `course.json`.
- [ ] `estimatedMinutes` matches `course.json`'s lesson entry.
- [ ] **At least 1 `theory` section** (multiple beats allowed; no two `theory` sections back-to-back).
- [ ] **2–5 widget sections** total (any non-theory type).
- [ ] **No lesson ends on a bare `theory` block** — the last `theory` section is followed by at least one widget.
- [ ] **Each `theory.markdown` is 150–400 words** so the beat carries real weight rather than being a thin paragraph.
- [ ] At least one of `quiz` (where conceptual checking helps).
- [ ] At least one of `code` or `demo` (where the topic permits hands-on).
- [ ] All `section.id` values are unique within the lesson.
- [ ] Each `code` section has 2–4 tests, each with a descriptive `name` and a small meaningful `body`.
- [ ] Each `code` section has a non-empty `solution` field with a runnable reference implementation (US-038).
- [ ] Each `quiz` has ≥ 2 options, ≥ 1 correct, plausible distractors, non-empty `explanation`, and `multiSelect` set explicitly.
- [ ] **Quiz `correct[]` indices are spread across positions in this lesson** — no more than 40% of single-select quizzes share the same correct index, and no multi-select quiz has ALL options correct (use 1–2 distractors instead).
- [ ] Each `theory.markdown` uses KaTeX *only where math is genuinely relevant*.
- [ ] Each `sandbox.encouragement` is one tasteful sentence.
- [ ] No `additionalProperties` smuggled into any widget `data` object.
- [ ] **Lesson-level `sources` has ≥ 3 entries** (US-040 / US-041).
- [ ] Every source has a non-empty `title`, a valid `url`, and a `kind` ∈ `{paper, video, article, book}`.
- [ ] Every source with `kind: "paper"` or `kind: "book"` carries `author` + `year` (strongly preferred — only omit if you genuinely cannot recover them).
- [ ] No source URL points at `medium.com`, `towardsdatascience.com`, `dev.to`, or other rot-prone blog hosts.
- [ ] **Every cited URL was verified to resolve in this session** (WebFetch or `curl -sIL --max-time 10`) — no 404/410, no DOIs written from memory. The pipeline's source-URL gate fails the attempt on dead links.
- [ ] At least one theory section that draws on a specific reference also carries a `section.sources` entry (omit on sections without a specific reference).
- [ ] `section.sources` lives at the section root (next to `id` / `title` / `type` / `data`), **not** inside `data`.
- [ ] **Every theory section with `markdown` ≥ 300 chars carries at least one inline `![alt](url)` image** where it pedagogically helps (US-051).
- [ ] **Every image — inline OR widget — has meaningful, non-placeholder alt text** (never `![](...)`, `![image](...)`, `![figure](...)`).
- [ ] All image URLs come from stable hosts (Wikimedia Commons, public-domain repositories, official docs, arxiv) — never `medium.com`, `towardsdatascience.com`, `dev.to`, personal blogs, Imgur, or social-media CDNs.
- [ ] Every Image widget section with a Wikimedia / licensed source carries `data.attribution` in the `Wikimedia Commons, <author>, <license>` format (or the equivalent for the source) and links `attribution.url` to the source description page.
- [ ] **Every `plotImage` section's saved PNG has visible X/Y axes, tick marks, numeric tick labels, axis labels (with units where applicable), and a title** (US-060) — never `plt.axis('off')`, `plt.xticks([])`, or hidden spines. PlotImage `sourceCode` reproduces that exact figure.
- [ ] **Every local asset path referenced by the lesson actually exists on disk.** Run `ls -la courses/<slug>/assets/` (recursively if needed) after writing the lesson JSON and confirm there is a real file for every `/api/courses/<slug>/assets/...` URL — `plotImage.data.src`, `video.data.src` (mp4 kind), `demo.data.imageSrc`, `code.data.inputs[].src`, `code.data.outputMedia.src`, and every inline `![alt](/api/courses/<slug>/assets/...)` in `theory.markdown`. The pipeline enforces this gate after schema validation; missing files fail the attempt and feed the missing list back into the retry brief.
- [ ] **Every `/inputs/<file>` a Code/Sandbox widget reads is declared in THAT widget's own `inputs[]`.** Each widget mounts only its own `inputs[]` — there is no shared `/inputs/` across widgets, so a sibling declaring the same file does not help. For each `code` / `sandbox` section, scan its `starterCode`, `solution`, and every `tests[].body` for literal `/inputs/<filename>` reads (`cv2.imread('/inputs/x.png')`, `open('/inputs/data.csv')`) and confirm each `<filename>` matches an `inputs[]` entry's mount name (the basename of `src`, or its explicit `filename` override). An undeclared reference raises `FileNotFoundError` at Run time; the pipeline's asset gate now fails the attempt and lists each one in the retry brief.
- [ ] **All matplotlib PNGs from `plotImage.sourceCode` have been generated by actually running the code via Bash.** Do not assume the file exists from a previous lesson or that the renderer will execute the source — the static `<img src>` references a file that must already be on disk.
- [ ] **No external `http(s)://` URLs survive in image positions.** `grep -E '!\[[^\]]*\]\(https?://' courses/<slug>/lessons/<lesson-slug>.json` must return zero lines (covers inline theory images). Check the JSON-level fields too: `plotImage.data.src`, `demo.data.imageSrc`, `code.data.inputs[].src`, `code.data.outputMedia.src`, and `video.data.src` for `kind: "mp4"` must all start with `/api/courses/<slug>/assets/...`, never `http(s)://`. Every external image you wanted to use must have been downloaded into `courses/<slug>/assets/images/<descriptive-filename>` via `curl -L -o ...` and rewritten to its local API path. Only `video` sections with `kind: "youtube"` are allowed to keep their external URL. The pipeline's asset gate rejects external URLs in any other position.
- [ ] `LessonSchema.safeParse` returns `success: true`.
- [ ] `npm run typecheck` passes (clean for a JSON-only change; if you authored a new widget in *Step 3a*, this is the gate that catches half-wired registry / lesson-schema imports).
- [ ] **No file written under `scripts/ralph/`** — this skill is fully decoupled from the ralph orchestrator.
- [ ] **If a new widget type was authored** (Step 3a): all 9 sub-steps complete — tokens.css var (light + dark), `<Name>/schema.ts`, `<Name>Widget.tsx`, `<Name>Editor.tsx` wired into the lesson page, `sample.ts`, `widgetRegistry` entry, `WidgetType` union extended, `schemas/build.ts` updated and `npm run build:schemas` run, `SectionSchema` discriminated union extended in `src/lib/schemas/lesson.ts`. `npm run test -- src/lib/schemas/schemas.test.ts` clean.

---

## Cross-references

- [`research_course/SKILL.md`](../research_course/SKILL.md) — wrote `research.md` + `sources.md` you read in Step 2.
- [`design_course/SKILL.md`](../design_course/SKILL.md) — wrote `course.json` you read in Step 1.
- `src/lib/schemas/lesson.ts` — `LessonSchema`, `SectionSchema` (discriminated union), Zod source of truth.
- `src/lib/schemas/course.ts` — `CourseSchema`, `ModuleSchema`, `LessonRefSchema` — describe the parent course you're authoring against.
- `src/widgets/<Name>/schema.ts` — per-widget Zod schemas. JSON mirrors live in `src/widgets/schemas/*.json` (regenerated via `npm run build:schemas`).
- `src/widgets/registry.ts` — the canonical list of `WidgetType` values and which component renders each.
- [`src/widgets/README.md`](../../../../src/widgets/README.md) — the 5-step procedure for adding a new widget type. **Authoring a new widget is in scope** for this skill when no existing type fits the lesson's pedagogical need; see *Step 3a* above for the gating criteria and the build/validation steps you must run after.
