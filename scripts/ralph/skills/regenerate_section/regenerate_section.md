---
name: regenerate_section
description: "Regenerate a single lesson section given the full Lesson JSON, the target sectionId, and a free-text user instruction (e.g. 'more code-focused', 'shorter', 'add a comparison'). Read-only: emits a single JSON object on stdout — never writes files, never touches other sections. The section's id and kind (theory/quiz/code/etc.) MUST be preserved; only the content / prompt / widget-specific fields may change. Triggers on: regenerate section, regenerate_section, rewrite section, redo section."
user-invocable: true
---

# Regenerate Section

Rewrite a single section of a lesson. The user has an existing `Lesson` JSON on disk and wants to refresh **one** section in place — keep its `id`, keep its `type` (theory stays theory, quiz stays quiz, …) — only its content fields change. **You do not write any files. You do not touch any other section.** The webapp will diff your output against the original and offer the user an Accept / Reject preview; persistence happens via a separate Apply endpoint.

This skill is invoked by the webapp's `POST /api/courses/<slug>/lessons/<lessonSlug>/sections/<sectionId>/regenerate` route. The route hands you a JSON input on stdin and parses your stdout JSON back out. If your stdout cannot be parsed, the route returns 422 to the client — keep the output strict.

---

## Input

A single JSON object with this shape:

```json
{
  "lessonContext": { /* full Lesson object validated by LessonSchema (src/lib/schemas/lesson.ts) */
    "schemaVersion": 1,
    "slug": "...",
    "courseSlug": "...",
    "moduleId": "...",
    "title": "...",
    "eyebrow": "...",
    "description": "...",
    "estimatedMinutes": 12,
    "sections": [
      { "id": "intro", "title": "...", "type": "theory", "data": { "markdown": "..." } },
      { "id": "check-1", "title": "...", "type": "quiz", "data": { "question": "...", "options": ["..."], "correct": [0], "explanation": "...", "multiSelect": false } }
    ],
    "sources": [ /* optional lesson-level source list */ ]
  },
  "sectionId": "check-1",
  "instruction": "<user's free-text instruction, 1..1000 chars — e.g. 'more code-focused', 'shorter', 'add a comparison', 'rephrase as a multi-select with two correct answers'>"
}
```

`lessonContext` is the **full lesson** — every section, including the one you are rewriting — so you can keep the regenerated section coherent with the rest of the lesson (don't duplicate explanations the next theory beat already covers; don't ask quiz questions about content the lesson never introduced; pick code task ideas that respect what was already practised).

`sectionId` must match exactly one section's `id` inside `lessonContext.sections`. If it does not, treat the input as malformed and stop without emitting JSON — the route will report it as an agent failure.

---

## Output

A **single JSON object on stdout** — nothing else. No leading prose, no markdown code fences, no trailing commentary. The route reads stdout and pipes it directly into a Zod parser; any extra characters cause a 422.

```json
{
  "newSection": {
    "id": "check-1",
    "title": "...",
    "type": "quiz",
    "data": { "question": "...", "options": ["..."], "correct": [0], "explanation": "...", "multiSelect": false }
  }
}
```

`newSection` is the **whole replacement section object** — every field the original section's `Section` variant requires must be present and valid. The route validates `newSection` against `SectionSchema`, then re-asserts:

- `newSection.id === sectionId`
- `newSection.type === <original section's type>`

If either drifts, the route returns 422 to the client — your output is rejected. **There is no escape hatch.** A regenerated quiz must still be a quiz; a regenerated theory must still be a theory.

---

## Rules

1. **Preserve `id`.** Copy the original section's `id` verbatim into `newSection.id`. The lesson's other sections reference IDs (progress tracking, navigation), so changing it would corrupt persisted state. The route rejects with 422 if `newSection.id !== sectionId`.
2. **Preserve `type` (kind).** A theory section must come back as a theory section; a quiz must come back as a quiz; a code section must come back as a code section. Same for `codeCloze`, `demo`, `sandbox`, `histogram`, `plotImage`, `parametricExplorer`, `dragMatch`, `dataTable`, `video`, `image`, `custom`. The route rejects with 422 if the type changed.
3. **Only `data` (and `title` / `description` / `sources` when warranted) may change.** The whole point of regenerating is to refresh the section's content. You SHOULD freely rewrite `data` — that's what the user asked for. You MAY revise `title` if the new content materially shifts the section's framing; otherwise keep the original `title`. You MAY add/update an OPTIONAL `description` (≤ 160 chars) when a one-sentence framing helps. You MAY update `sources` only when the regenerated content draws on a specific reference; otherwise omit the field.
4. **Per-widget content rules carry over from `generate_lesson`.** When rewriting a section, follow the same per-widget rules `generate_lesson` enforces — they are the contract for *what makes a good section of this kind*:
   - **Theory:** plain markdown with KaTeX support (`$inline$` / `$$block$$`); 150–400 words; break with bullets / sub-headings / inline images / KaTeX where the topic invites it; an inline `![alt](url)` from Wikimedia / official-docs is encouraged when content is ≥ 300 chars and visually anchorable; alt text MUST be meaningful, not `![image](...)`. Don't open with `# ` (the section title is already a heading). **Mermaid diagrams** render from a fenced ```` ```mermaid ```` block (`flowchart` / `sequenceDiagram` / `mindmap`) — use one when the *relationship between parts* is the point (pipeline, data/control flow, concept map, architecture); keep KaTeX for formulas and `plotImage` for quantitative charts. Keep it **≤ ~15 nodes**, valid Mermaid syntax, and **no inline `style` / `classDef` colour overrides** (they break the light/dark/sunset theme mapping). Example flowchart: `flowchart LR; A[Raw frame] --> B[Grayscale] --> C[Threshold] --> D[Contours]`.
   - **Quiz:** single unambiguous prompt; ≥ 2 options (3–4 typical); ≥ 1 correct index (multi-select supported); `multiSelect` set explicitly; non-empty `explanation` that *justifies* the right answer rather than paraphrasing the question; pick **plausible** distractors.
   - **Code:** short `taskMarkdown` brief; runnable Python `starterCode` (executes on the local IPython kernel — baseline venv ships numpy, **real cv2**, matplotlib, torch, tensorflow; 30 s per-run cap; declare any non-baseline import in `requiresPackages`); 2–4 tests, each with a descriptive `name` (`returns_zero_for_empty_input`, not `t1`) and a small body (one or two `assert` lines); always populate `solution` with a runnable reference implementation; `inputs?` / `outputMedia?` only when the task acts on a concrete artefact (image, signal, file, sample text).
   - **CodeCloze:** preserve the `template` blank syntax; ensure each blank's `expected` value(s) match the surrounding code semantically.
   - **Demo:** only `demoType: "gauss"` is registered; `imageSrc` must be a path the webapp can serve; `params.sigmaMin < params.sigmaDefault < params.sigmaMax`.
   - **Sandbox:** open-ended `starterCode` (typically the same shape as the preceding code exercise minus assertions); one tasteful sentence in `encouragement` — warm but brief, no emoji.
   - **Histogram / DataTable / DragMatch / ParametricExplorer / Video / PlotImage / Image:** match the existing widget's schema exactly (see `src/widgets/<Name>/schema.ts`); never invent fields the schema does not declare (`additionalProperties: false`).
   - **Custom:** `data` is a free-form record; rewrite within the same shape the original used.
5. **Stay coherent with the rest of `lessonContext`.** Read the surrounding sections so the regenerated section fits the lesson's narrative. Don't repeat a definition the next theory beat already covers; don't ask a quiz question about machinery the lesson never introduced; don't introduce a new function name the next code exercise contradicts. When the invoking prompt names the course's working-memory files (`/courses/<slug>/research.md`, `/courses/<slug>/sources.md`), Read them BEFORE rewriting and stay consistent with the terminology, notation, and bibliography they establish.
6. **Apply the user's `instruction` literally and minimally.** "Shorter" means actually trim the prose, not rewrite from scratch. "More code-focused" means lean on a code example or fenced snippet, not invent a new framing. "Add a comparison" means add a side-by-side table or X-vs-Y framing. Don't change things the user didn't ask about.
7. **No new sources unless warranted.** If the regenerated content draws on a specific reference, attach `sources` to the section using the same `SourceSchema` shape (`{ url, title, kind, author?, year? }`). Prefer Wikipedia, arxiv, official docs, recognised textbooks, recognised educational videos. Avoid `medium.com`, `towardsdatascience.com`, `dev.to`, personal blogs, social-media URLs.
8. **Do not write any files.** The ONLY files you may Read are this skill file and the course working-memory files the invoking prompt names (`research.md` / `sources.md` — read-only context, never modify them). Do not invoke other skills. Do not use the Bash tool. Your only job is to produce the JSON object on stdout.
9. **JSON only on stdout.** The very first character of your output must be `{` and the very last must be `}`. No fences, no prose. Do not emit logging on stdout — if you need scratch notes, send them to stderr (the route ignores stderr unless the agent exits non-zero).

---

## Worked Example — Regenerate a quiz to be multi-select

**Input** (abbreviated):

```json
{
  "lessonContext": {
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
        "data": { "markdown": "Salt-and-pepper noise plants a few extreme outliers …" }
      },
      {
        "id": "check-mean-vs-median",
        "title": "Quick check: mean vs. median",
        "type": "quiz",
        "data": {
          "question": "An image has 5% of its pixels replaced by salt noise. Which filter best removes the noise without softening edges?",
          "options": [
            "A 3×3 box (mean) filter",
            "A 3×3 median filter",
            "A 3×3 Gaussian filter with σ = 1",
            "Any of the above — they are equivalent on impulse noise"
          ],
          "correct": [1],
          "explanation": "Mean and Gaussian filters average the noisy white pixels with their neighbours …",
          "multiSelect": false
        }
      }
    ]
  },
  "sectionId": "check-mean-vs-median",
  "instruction": "Make this multi-select with two correct answers — add an option about a bilateral filter."
}
```

**Output** (the entire stdout):

```json
{"newSection":{"id":"check-mean-vs-median","title":"Quick check: edge-preserving denoisers","type":"quiz","data":{"question":"An image has 5% of its pixels replaced by salt noise. Which filters best remove the noise without softening edges? Select all that apply.","options":["A 3×3 box (mean) filter","A 3×3 median filter","A 3×3 Gaussian filter with σ = 1","A 3×3 bilateral filter"],"correct":[1,3],"explanation":"Both the median and the bilateral filter are edge-preserving on impulse noise: the median throws outlier pixels away as long as they are a minority of the window; the bilateral filter weights neighbours by both spatial and intensity distance, so pixels across an edge contribute almost nothing. Mean and Gaussian filters average noise into the surrounding edges and smear them.","multiSelect":true}}}
```

Notes on the example:

- `id` preserved: `"check-mean-vs-median"` round-trips verbatim.
- `type` preserved: still `"quiz"`.
- `title` revised because the new framing genuinely covers more than the original (mean vs. median → edge-preserving denoisers). Skip this kind of title revision when the topic of the section is unchanged.
- `data` rewritten end-to-end: new `question` (asks for "all that apply"), new `options` (added the bilateral filter as a fourth option, which is the second correct answer), new `correct: [1, 3]`, new `explanation` (justifies *both* correct answers rather than paraphrasing the question), `multiSelect: true`.
- No `sources` attached because the question doesn't lean on a specific reference. (Adding a Wikipedia link to the bilateral-filter article would also be reasonable.)
- The whole output is a **single JSON object** on stdout — no fences, no leading prose.

---

## Worked Example — "Shorter" applied to a theory section

**Input** (abbreviated): `instruction: "Shorter — keep the intuition but drop the algorithm details."`, target section is the intuition theory block.

**Output**: a new theory section whose `markdown` keeps the intuition paragraph + the inline image but trims the formula and the algorithm-detail paragraph; same `id`, same `type`, same `title`. The `data.markdown` is now ~180 words instead of ~350.

---

## Stop

You're done after emitting the single JSON object on stdout. The route:

1. Reads your stdout, parses it as JSON.
2. Validates `newSection` against `SectionSchema`.
3. Re-asserts `id` and `type` preservation.
4. Returns `{ newSection, oldSection }` to the client for the Accept / Reject preview.

You do not need to do anything else. Persistence is the Apply route's job, not yours.
