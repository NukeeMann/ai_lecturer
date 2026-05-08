---
name: coherence_pass
description: "Audit a generated course as a SET — read /courses/<slug>/course.json plus every /courses/<slug>/lessons/<lesson-slug>.json and emit a markdown report with three named sections (Prerequisite Order, Redundancy, Notation Consistency). Read-only audit: never edits course or lesson files. Invoked by the webapp's generation backend as the FINAL stage after every per-lesson generate_lesson call has succeeded. Triggers on: coherence_pass, Run coherence_pass, coherence pass <slug>."
user-invocable: true
---

# Coherence Pass

Audit one finished course end-to-end and emit a human-readable markdown report. This skill is the FINAL stage of the course-generation pipeline (after [`init_course`](../init_course/SKILL.md) and one [`generate_lesson`](../generate_lesson/SKILL.md) per lesson have completed). The report's purpose is to give a course author a checklist of issues to consider before shipping the course OR before regenerating individual lessons.

**This is a READ-ONLY audit. Do not modify `course.json`. Do not modify any lesson file. Do not edit `research.md` / `sources.md`. The single output is the markdown report streamed to stdout.**

---

## Your Role

You are an editor reviewing a freshly generated curriculum as a coherent unit. Each lesson was authored independently by a separate agent invocation that did NOT see the other lessons; your job is to surface the cross-lesson seams the per-lesson agents could not see by construction:

- **Did lesson 4 use a concept that wasn't introduced until lesson 6?**
- **Did lessons 2 and 5 both re-explain Bayes' rule from scratch with no acknowledgement that the other did?**
- **Does lesson 1 call the input vector $\mathbf{x}$, lesson 3 call it $\vec{x}$, and lesson 7 call it `X`?**

You are NOT re-grading individual lessons (that's the per-lesson agent's job). You are NOT proposing rewrites (the report is read-only — the human decides what to do with it). You are NOT auditing factual correctness (out of scope; `generate_lesson`'s sources/research pass owns that).

Be precise: every finding must cite the lesson slug(s) involved. Be conservative: if you're not sure something is a real issue, don't flag it. A short, accurate report beats a long, speculative one.

---

## The Job

1. Receive **one argument** from the invoking prompt: the course `slug`. Validate it against the safe-slug rule (`[a-z0-9-]+`, no `..`, no `/` — same rule as `assertSafeSlug`).
2. Read `/courses/<slug>/course.json` to recover the canonical lesson order: walk `course.modules.flatMap(m => m.lessons)` in declaration order — that is the order a learner will see, and the order against which prerequisite ordering must be judged.
3. For each lesson in that order, read `/courses/<slug>/lessons/<lesson-slug>.json`. If a lesson file is missing or fails to parse, note it in the report but continue — do not stop the pass.
4. Run the three audit passes described below.
5. Emit the markdown report to stdout — **only** the markdown text, no JSON wrapper, no preamble like "Here's the report:", no closing remarks. The webapp captures stdout verbatim and writes it to `/courses/<slug>/coherence-report.md`.
6. Stop.

---

## Step 1: Receive Arguments

The invoking prompt passes one argument — the course `slug`. Typical shape:

```
Run the coherence_pass skill, slug=edge-detection-basics.
```

Parse and validate (`[a-z0-9-]+`, no `..`, no `/`). If the slug fails validation, stop with an error.

The output path is fixed (the webapp owns it — you only write to stdout):

```
/courses/<slug>/coherence-report.md
```

---

## Step 2: Read the Course as a Set

Open `/courses/<slug>/course.json` and walk every lesson in declared order:

```ts
const lessons = course.modules.flatMap(m =>
  m.lessons.map(l => ({ ...l, moduleId: m.id, moduleTitle: m.title })),
);
```

For each entry, read `/courses/<slug>/lessons/<lesson-slug>.json`. Keep the parsed lesson objects keyed by slug AND in declaration order — both views are needed (slug lookup for cross-references; ordered iteration for prerequisite checks).

If a lesson file is missing or invalid JSON, note it under a leading `## Missing Lessons` section (see *Output Format* below) and skip that lesson in the three audit passes — do not abort.

You do **not** need to re-read `research.md` or `sources.md`. The audit is purely against the lesson set.

---

## Step 3: The Three Audit Passes

### Pass 1 — Prerequisite Order

Walk the lessons in declaration order. For each lesson, identify the **named concepts it relies on** (terms, formulas, algorithms, notation conventions, library APIs introduced earlier in the course). Then for each concept, check: was it **introduced** by an earlier lesson, or does this lesson use it without context?

A concept is "introduced" by a lesson when one of its `theory` sections defines it (a definition, a formula, a worked example, or a clear plain-English statement). Casual mentions in passing don't count.

Flag a finding when:
- Lesson N uses concept X but no lesson 1..N−1 introduces X.
- Lesson N relies on a derivation step from lesson M (M > N) — i.e. the order is wrong.
- A lesson explicitly references "as we saw in lesson Y" but lesson Y doesn't actually cover that.

Skip findings for concepts that the course's intended audience would already know (e.g. a calculus course doesn't need to "introduce" derivative notation; a Python course doesn't need to "introduce" `print`).

### Pass 2 — Redundancy

For each pair of lessons that BOTH explain the same concept from scratch, flag the redundancy. The signal is: two `theory` sections in different lessons cover the same definition / derivation / motivation, and **neither** acknowledges the other (no "as we saw in lesson 3..." or "we'll deepen this in lesson 7..." cross-reference).

A small amount of repetition is healthy (a 1-line recap is fine; a re-derivation is not). The bar for flagging: would a learner reading both lessons feel they wasted time on duplicate content?

Skip findings for:
- Recap sections that explicitly say they're recapping ("Recall from lesson 2 that …").
- Concepts deliberately re-explained from a different angle (e.g. lesson 1 introduces Bayes' rule informally; lesson 4 re-derives it formally with measure theory). Note these only if neither lesson signals the relationship.

### Pass 3 — Notation Consistency

Compare the notation, variable names, and conventions used in mathematical / code contexts across lessons. Flag drift such as:
- The same quantity rendered as `$\mathbf{x}$` in one lesson and `$\vec{x}$` (or `$X$`, or `x`) in another, without explanation.
- Same algorithm variable called `lr` in lesson 1's code and `learning_rate` in lesson 4's code.
- Inconsistent function naming style (`compute_loss` vs `computeLoss`) within Python / JS code blocks.
- Index conventions that flip (1-indexed in one lesson, 0-indexed in another) without acknowledgement.
- Unit conventions (e.g. one lesson in radians, another in degrees, with no callout).

Some drift is acceptable when it reflects a real distinction (e.g. `x` for input, `X` for design matrix). Flag only when the drift is unexplained AND likely to confuse a learner moving between lessons.

---

## Step 4: Emit the Markdown Report

The output **must** be plain markdown — exactly three top-level `##` sections, in this exact order, with these exact headings:

```markdown
## Prerequisite Order

<findings, one per bullet — cite the lesson slug(s) — or "No issues found." when the pass surfaced nothing>

## Redundancy

<findings, one per bullet — cite both lesson slugs — or "No issues found.">

## Notation Consistency

<findings, one per bullet — cite the lesson slugs — or "No issues found.">
```

Emit `## Missing Lessons` (with bullets listing the missing/invalid slugs) **only** when one or more lesson files failed to load — place it BEFORE the three audit sections so the reader sees the data-quality caveat first. Omit the section entirely when every lesson loaded cleanly.

Bullet style: each finding is one short paragraph (≤ 3 sentences). Always cite the specific lesson slug(s):

> - `the-canny-edge-detector` uses **non-maximum suppression** in its theory section but the technique is not introduced until `edge-thinning`. Either move the introduction earlier or add a forward-pointer in `the-canny-edge-detector`.

> - `gaussian-blur` and `bilateral-filter` both re-derive the 1-D Gaussian kernel from scratch with no cross-reference. Pick one as the canonical derivation and have the other cite it.

> - `gradient-descent` uses `lr` in code but `learning_rate` in the matching `theory` formula in `momentum`. Pick one and use it everywhere.

When a pass surfaces no issues, the section body is exactly `No issues found.` — do not pad with preamble.

**Do NOT** emit:
- A leading title (`# Coherence Report`).
- A preamble paragraph ("Below is the coherence report …").
- A trailing summary or recommendations.
- Any JSON, frontmatter, or wrapper structure.
- Any text outside the three (or four, with `## Missing Lessons`) named sections.

The webapp pipes stdout straight into `coherence-report.md` byte-for-byte, so anything above or below the section blocks lands in the file as-is.

---

## Step 5: Stop

You're done. The webapp captures stdout, writes `/courses/<slug>/coherence-report.md`, and emits a `stage:done` event for `coherence-pass`. Do not author any other files. Do not invoke `generate_lesson` or `init_course`. Do not modify the course directory.

---

## Cross-references

- [`init_course/SKILL.md`](../init_course/SKILL.md) — wrote the `course.json` you walked in Step 2.
- [`generate_lesson/SKILL.md`](../generate_lesson/SKILL.md) — wrote each lesson JSON file you read in Step 2; the per-lesson agent never sees other lessons, which is precisely why this final pass exists.
- `src/lib/schemas/course.ts` / `src/lib/schemas/lesson.ts` — the Zod schemas that define what's actually inside `course.json` / `lessons/*.json`.
