---
name: insert_section
description: "Generate ONE brand-new lesson section to be inserted directly AFTER a named anchor section, given the full Lesson JSON, the anchor sectionId, and a free-text user instruction (e.g. 'add a worked example', 'explain the edge case', 'insert a quick recap'). Defaults to a theory section unless the instruction clearly calls for another widget kind. Read-only: emits a single JSON object on stdout — never writes files, never touches existing sections. Triggers on: insert section, insert_section, add a section, new section after, expand the lesson here."
user-invocable: true
---

# Insert Section

Generate **exactly one** new section to be inserted into a lesson, directly **after** a named anchor section. The user is reading a lesson and wants the tutor to add a little more explanation in the middle — a worked example, a clarifying recap, a quick check — **without overwriting any existing content.** You produce one new section; the webapp splices it in after the anchor and persists the lesson. **You do not write any files. You do not touch any existing section.**

This skill is invoked by the webapp's `POST /api/courses/<slug>/lessons/<lessonSlug>/sections/<sectionId>/insert` route. The route hands you a JSON input on stdin and parses your stdout JSON back out. If your stdout cannot be parsed, the route returns 422 to the client — keep the output strict.

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
  "anchorSectionId": "intro",
  "instruction": "<user's free-text instruction, 1..1000 chars — e.g. 'add a worked example', 'explain why this edge case matters', 'insert a quick recap quiz'>"
}
```

`lessonContext` is the **full lesson** — every section, in order — so you can make the new section coherent with what comes before and after it.

`anchorSectionId` must match exactly one section's `id` inside `lessonContext.sections`. Your new section will be inserted **immediately after** that anchor. Read the anchor section AND the section that currently follows it: your new section sits *between* them, so it should pick up where the anchor left off and lead naturally into what comes next (don't duplicate either one).

---

## Output

A **single JSON object on stdout** — nothing else. No leading prose, no markdown code fences, no trailing commentary. The route reads stdout and pipes it directly into a Zod parser; any extra characters cause a 422.

```json
{
  "newSection": {
    "id": "recap-after-intro",
    "title": "...",
    "type": "theory",
    "data": { "markdown": "..." }
  }
}
```

`newSection` is a **whole new section object** — every field its `Section` variant requires must be present and valid. The route validates `newSection` against `SectionSchema`. The route then assigns the section a **collision-free id** of its own (it does not trust the `id` you emit to be unique), so you may pick any reasonable slug-style `id` — a short kebab-case hint like `"example-after-<anchor>"` is fine.

---

## Rules

1. **Generate exactly ONE section.** Not a list, not the anchor plus a new one — a single replacement-free addition. The output is `{ "newSection": { … } }`, one object.
2. **Default to `type: "theory"`.** A mid-lesson insertion is almost always an extra explanation, worked example, intuition, or clarification — that's a theory block. Only choose a different `type` (`quiz`, `code`, `sandbox`, `codeCloze`, `demo`, …) when the user's `instruction` clearly asks for it ("add a quick check" → quiz; "let me practise this" → code/sandbox). When in doubt, theory.
3. **Fit the section between the anchor and what follows it.** The new section is inserted *after* `anchorSectionId`. Read the anchor and the next section. Your content should continue from the anchor and dovetail into the following section without repeating their material. Don't re-define a term the anchor already defined; don't preview content the next section is about to deliver.
4. **Per-widget content rules carry over from `generate_lesson` / `regenerate_section`** — they are the contract for *what makes a good section of this kind*:
   - **Theory:** plain markdown with KaTeX support (`$inline$` / `$$block$$`); 150–400 words; break with bullets / sub-headings / inline images / KaTeX where the topic invites it; an inline `![alt](url)` from Wikimedia / official-docs is encouraged when content is ≥ 300 chars and visually anchorable; alt text MUST be meaningful, not `![image](...)`. Don't open with `# ` (the section title is already a heading).
   - **Quiz:** single unambiguous prompt; ≥ 2 options (3–4 typical); ≥ 1 correct index (multi-select supported); `multiSelect` set explicitly; non-empty `explanation` that *justifies* the right answer rather than paraphrasing the question; pick **plausible** distractors.
   - **Code:** short `taskMarkdown` brief; runnable Python `starterCode` (executes on the local IPython kernel — baseline venv ships numpy, real cv2, matplotlib, torch, tensorflow; 30 s per-run cap; declare any non-baseline import in `requiresPackages`); 2–4 tests, each with a descriptive `name` and a small body (one or two `assert` lines); always populate `solution` with a runnable reference implementation; `inputs?` / `outputMedia?` only when the task acts on a concrete artefact.
   - **CodeCloze / Demo / Sandbox / Histogram / DataTable / DragMatch / ParametricExplorer / Video / PlotImage / Image / Custom:** match the existing widget's schema exactly (see `src/widgets/<Name>/schema.ts`); never invent fields the schema does not declare (`additionalProperties: false`).
5. **Apply the user's `instruction` literally and minimally.** "Add a worked example" means one concrete worked example, not a new framing of the whole lesson. "Explain the edge case" means a focused paragraph on that edge case. Don't broaden scope beyond what was asked.
6. **Stay coherent with the rest of `lessonContext`.** Match the lesson's terminology, notation, and difficulty. When the invoking prompt names the course's working-memory files (`/courses/<slug>/research.md`, `/courses/<slug>/sources.md`), Read them BEFORE writing and stay consistent with the terminology, notation, and bibliography they establish.
7. **`id` and `title`.** Pick a short kebab-case `id` (the route will re-key it to guarantee uniqueness, so collisions are harmless). Give the section a clear, specific `title`.
8. **Sources only when warranted.** If the new content draws on a specific reference, attach `sources` using the `SourceSchema` shape (`{ url, title, kind, author?, year? }`). Prefer Wikipedia, arxiv, official docs, recognised textbooks, recognised educational videos. Avoid `medium.com`, `towardsdatascience.com`, `dev.to`, personal blogs, social-media URLs. Otherwise omit the field.
9. **Do not write any files.** The ONLY files you may Read are this skill file and the course working-memory files the invoking prompt names (`research.md` / `sources.md` — read-only context, never modify them). Do not invoke other skills. Do not use the Bash tool. Your only job is to produce the JSON object on stdout.
10. **JSON only on stdout.** The very first character of your output must be `{` and the very last must be `}`. No fences, no prose. Send any scratch notes to stderr (the route ignores stderr unless the agent exits non-zero).

---

## Worked Example — Insert a worked example after a theory section

**Input** (abbreviated): `anchorSectionId: "intuition"`, `instruction: "Add a concrete 3×3 worked example so I can see the median actually being computed."` The anchor is a theory block explaining *why* a median filter beats a mean filter on salt-and-pepper noise; the section after it is a quiz.

**Output** (the entire stdout):

```json
{"newSection":{"id":"worked-example-after-intuition","title":"A 3×3 median, step by step","type":"theory","data":{"markdown":"Let's run the median over one pixel. Take this noisy 3×3 neighbourhood (one salt pixel, value 255, sits dead centre):\n\n$$\\begin{bmatrix} 12 & 15 & 14 \\\\ 13 & 255 & 16 \\\\ 11 & 14 & 13 \\end{bmatrix}$$\n\n**Step 1 — flatten and sort** the nine values:\n\n`11, 12, 13, 13, 14, 14, 15, 16, 255`\n\n**Step 2 — take the middle one** (the 5th of 9): the median is **14**.\n\nThe centre pixel is rewritten from 255 to 14 — the outlier is gone, and 14 is a real value that already existed in the neighbourhood, so no new grey level is invented. Compare that to a mean filter: averaging the same nine values gives $(11+12+\\dots+255)/9 \\approx 40$, dragging the result far above every true pixel because the single 255 still contributes. That's the whole reason the median survives impulse noise the mean can't: sorting throws the outlier to the end of the list, where the middle element never sees it."}}}
```

Notes on the example:

- Exactly **one** new section is emitted.
- `type` is `theory` (the default) — the instruction asked for an explanation, not a quiz or an exercise.
- It slots between the anchor (the *why*) and the following quiz: it delivers the *how*, which is what a reader is primed to want next, and it doesn't pre-empt the quiz.
- `id` is a readable kebab-case hint; the route will guarantee its uniqueness.
- The whole output is a **single JSON object** on stdout — no fences, no leading prose.

---

## Stop

You're done after emitting the single JSON object on stdout. The route:

1. Reads your stdout, parses it as JSON.
2. Validates `newSection` against `SectionSchema`.
3. Assigns the section a collision-free `id`.
4. Snapshots the existing lesson, splices your section in directly after the anchor, and writes the lesson atomically.

You do not need to do anything else. Persistence and undo are the route's job, not yours.
