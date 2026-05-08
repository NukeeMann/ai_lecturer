---
name: regenerate_lesson
description: "Regenerate an entire lesson given the full course schema, the current full Lesson JSON, and a free-text user instruction (e.g. 'more code-heavy', 'shorter', 'restructure as theory → quiz → code → wrap'). Read-only: emits a single JSON object on stdout — never writes files. The lesson's slug, title, and parent moduleId MUST be preserved verbatim; sections may be fully restructured (their ids may change) but the result must still be a valid Lesson with a reasonable section count + mix of kinds for the lesson's purpose. Triggers on: regenerate lesson, regenerate_lesson, rewrite lesson, redo lesson."
user-invocable: true
---

# Regenerate Lesson

Rewrite a complete lesson. The user has an existing `Lesson` JSON on disk and wants to refresh its contents end-to-end while keeping the lesson's identity (`slug`, `title`, `moduleId`) intact so the rest of the course (navigation, persisted progress keyed off `slug`, the parent module's lesson list) keeps working. **You do not write any files.** The webapp's regenerate route reads your stdout, validates it against `LessonSchema`, snapshots the previous `lesson.json` to `<slug>.lesson-prev.json`, and writes your output as the new `lesson.json` — your only job is to produce the JSON object.

This skill is invoked by `POST /api/courses/<slug>/lessons/<lessonSlug>/regenerate`. The route hands you a JSON input on stdin and parses your stdout JSON back out. If your stdout cannot be parsed (or the output drifts on `slug`/`title`/`moduleId`), the route returns 422 and `lesson.json` is left untouched (no snapshot is written either).

---

## Input

A single JSON object with this shape:

```json
{
  "courseSchema": { /* full Course object validated by CourseSchema (src/lib/schemas/course.ts) */
    "schemaVersion": 1,
    "slug": "image-denoising",
    "title": "Image denoising",
    "description": "...",
    "accentColor": "indigo",
    "icon": "Sparkles",
    "modules": [
      {
        "id": "m1",
        "title": "Foundations",
        "summary": "...",
        "lessons": [ { "slug": "intro", "title": "Intro", "estimatedMinutes": 8 } ]
      },
      {
        "id": "m2",
        "title": "Non-linear filters",
        "summary": "...",
        "lessons": [
          { "slug": "median-filter", "title": "Median filter", "estimatedMinutes": 12 }
        ]
      }
    ],
    "createdAt": "...",
    "updatedAt": "..."
  },
  "currentLesson": { /* full Lesson object validated by LessonSchema (src/lib/schemas/lesson.ts) */
    "schemaVersion": 1,
    "slug": "median-filter",
    "courseSlug": "image-denoising",
    "moduleId": "m2",
    "title": "Median filter",
    "eyebrow": "NON-LINEAR FILTERS",
    "description": "Replace each pixel with the median of its neighbourhood.",
    "estimatedMinutes": 12,
    "sections": [
      { "id": "intro", "title": "Why a median?", "type": "theory", "data": { "markdown": "..." } },
      { "id": "check-1", "title": "Quick check", "type": "quiz", "data": { "question": "...", "options": ["..."], "correct": [0], "explanation": "...", "multiSelect": false } },
      { "id": "code-1", "title": "Implement it", "type": "code", "data": { "taskMarkdown": "...", "starterCode": "...", "solution": "...", "tests": [ { "name": "small_window_keeps_outliers_out", "body": "..." } ] } }
    ],
    "sources": [ /* optional */ ]
  },
  "instruction": "<user's free-text instruction, 1..2000 chars — e.g. 'more code-heavy, less theory', 'shorter, drop the second quiz', 'restructure as theory → quiz → code → wrap'>"
}
```

`courseSchema` is the **full course** so you can keep the regenerated lesson coherent with the rest of the course (don't redefine concepts the parent module's earlier lessons already covered; preview what the next lesson is going to do). `currentLesson` is the **full Lesson on disk** — every section, every code body, every source — so you can keep the rewrite informed by what was already there (good wording, the example dataset the lesson built around, the way distractors were framed).

`courseSchema.slug` is the parent course slug; `currentLesson.courseSlug` will match it. `currentLesson.moduleId` will match the `id` of one of the modules in `courseSchema.modules` — do not change it.

---

## Output

A **single JSON object on stdout** — nothing else. No leading prose, no markdown code fences, no trailing commentary. The route reads stdout and pipes it directly into a Zod parser; any extra characters cause a 422.

```json
{
  "newLesson": {
    "schemaVersion": 1,
    "slug": "median-filter",
    "courseSlug": "image-denoising",
    "moduleId": "m2",
    "title": "Median filter",
    "eyebrow": "...",
    "description": "...",
    "estimatedMinutes": 12,
    "sections": [ /* fully regenerated sections */ ],
    "sources": [ /* optional */ ]
  }
}
```

`newLesson` is the **whole replacement lesson object** — every field the `LessonSchema` requires must be present and valid. The route validates `newLesson` against `LessonSchema`, then re-asserts:

- `newLesson.slug === currentLesson.slug`
- `newLesson.courseSlug === currentLesson.courseSlug`
- `newLesson.moduleId === currentLesson.moduleId`
- `newLesson.title === currentLesson.title`

If any of these drift, the route returns 422 and `lesson.json` is left untouched. **There is no escape hatch.** A regenerated lesson keeps the same identity tuple — only the body changes.

---

## Rules

1. **Preserve identity.** Copy `slug`, `courseSlug`, `moduleId`, and `title` verbatim from `currentLesson` into `newLesson`. The rest of the course (navigation, the parent module's `lessons` list, persisted progress keyed on `slug`, generation logs) all reference these fields. The route rejects with 422 if any of them drift.
2. **Refresh the body freely.** `eyebrow`, `description`, `estimatedMinutes`, `sections`, and `sources` are yours to rewrite — that is the whole point of regenerating. Section ids MAY change (you are rebuilding the section list end-to-end), but every section must satisfy its variant of `SectionSchema`.
3. **Reasonable section count + kind mix.** Aim for 4–8 sections. Match the *purpose* of the lesson:
   - A theoretical lesson is mostly `theory` interleaved with one or two `quiz` checks; a `code` or `sandbox` exercise is welcome but not mandatory.
   - A coding lesson opens with one or two `theory` setups, has a `code` task as its centrepiece, and may close with a `sandbox` for free play and/or a `quiz` to confirm the takeaway.
   - A widget-driven lesson (e.g. `histogram`, `parametricExplorer`, `demo`, `dragMatch`, `dataTable`, `video`, `plotImage`) keeps the canonical widget at the centre, with `theory` framing it and a `quiz` confirming the takeaway.
   - Don't drop the lesson's intuition — even an aggressive "shorter" instruction should leave at least one `theory` setup and one assessment (`quiz` / `code` / `codeCloze` / `dragMatch`).
4. **Per-widget content rules carry over from `generate_lesson`.** Each section variant has the same per-kind contract `generate_lesson` enforces — they are the contract for *what makes a good section of this kind*:
   - **Theory:** plain markdown with KaTeX support (`$inline$` / `$$block$$`); 150–400 words; break with bullets / sub-headings / inline images / KaTeX where the topic invites it; an inline `![alt](url)` from Wikimedia / official-docs is encouraged when content is ≥ 300 chars and visually anchorable; alt text MUST be meaningful, not `![image](...)`. Don't open with `# ` (the section title is already a heading).
   - **Quiz:** single unambiguous prompt; ≥ 2 options (3–4 typical); ≥ 1 correct index (multi-select supported); `multiSelect` set explicitly; non-empty `explanation` that *justifies* the right answer rather than paraphrasing the question; pick **plausible** distractors.
   - **Code:** short `taskMarkdown` brief; runnable Python `starterCode` (Pyodide; numpy is fine, exotic deps are not); 2–4 tests, each with a descriptive `name` (`returns_zero_for_empty_input`, not `t1`) and a small body (one or two `assert` lines); always populate `solution` with a runnable reference implementation; `inputs?` / `outputMedia?` only when the task acts on a concrete artefact (image, signal, file, sample text).
   - **CodeCloze:** preserve the `template` blank syntax; ensure each blank's `expected` value(s) match the surrounding code semantically.
   - **Demo:** only `demoType: "gauss"` is registered; `imageSrc` must be a path the webapp can serve; `params.sigmaMin < params.sigmaDefault < params.sigmaMax`.
   - **Sandbox:** open-ended `starterCode` (typically the same shape as the preceding code exercise minus assertions); one tasteful sentence in `encouragement` — warm but brief, no emoji.
   - **Histogram / DataTable / DragMatch / ParametricExplorer / Video / PlotImage / Image:** match the existing widget's schema exactly (see `src/widgets/<Name>/schema.ts`); never invent fields the schema does not declare (`additionalProperties: false`).
   - **Custom:** `data` is a free-form record; rewrite within the same shape the original used.
5. **Stay coherent with `courseSchema`.** Read the rest of the course so the regenerated lesson fits the curriculum's narrative. Don't redefine a concept an earlier module already established; don't preview machinery a later lesson hasn't introduced yet; don't adopt notation that contradicts a sibling lesson.
6. **Apply the user's `instruction` literally and minimally.** "Shorter" means actually trim the section count and prose, not rewrite from scratch. "More code-heavy" means swap one or more `theory` sections for a `code` / `sandbox` / `codeCloze`, not invent a new framing. "Restructure as theory → quiz → code → wrap" means produce exactly that order. Don't change things the user didn't ask about.
7. **Section ids may change.** You are regenerating the entire lesson, so section ids do not need to round-trip. They MUST be unique within `sections`. Use stable, human-readable kebab-case (e.g. `intro`, `intuition`, `check-mean-vs-median`, `code-implement`, `wrap`) — the editor surfaces them.
8. **`sources` only when warranted.** Attach `sources` to a section (or to the whole lesson) only when the content draws on a specific reference; otherwise omit the field. Same `SourceSchema` shape (`{ url, title, kind, author?, year? }`). Prefer Wikipedia, arxiv, official docs, recognised textbooks, recognised educational videos. Avoid `medium.com`, `towardsdatascience.com`, `dev.to`, personal blogs, social-media URLs.
9. **Do not** read or write any files. Do not invoke other skills. Do not use the Bash tool. Your only job is to produce the JSON object on stdout.
10. **JSON only on stdout.** The very first character of your output must be `{` and the very last must be `}`. No fences, no prose. Do not emit logging on stdout — if you need scratch notes, send them to stderr (the route ignores stderr unless the agent exits non-zero).

---

## Stop

You're done after emitting the single JSON object on stdout. The route:

1. Reads your stdout, parses it as JSON.
2. Validates `newLesson` against `LessonSchema`.
3. Re-asserts identity preservation (`slug`, `courseSlug`, `moduleId`, `title`).
4. Snapshots the existing `lesson.json` to `<lessonSlug>.lesson-prev.json` (overwriting any prior snapshot — only one level of undo).
5. Writes the validated `newLesson` to `lesson.json`.
6. Returns `{ newLesson, hasUndo: true }` to the client.

You do not need to do anything else. Persistence + snapshotting is the route's job, not yours.
