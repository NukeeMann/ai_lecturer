---
name: generate_quiz_lesson
description: "Author a single quiz-only lesson JSON file at /courses/<slug>/lessons/<lesson-slug>.json. The lesson is composed of EXACTLY 10–15 widget sections, each of type `quiz` or `dragMatch` — no theory, no code, no demos, no images. Accepts two explicit arguments — the course slug and the lesson slug — from the invoking prompt. Reads ONLY /courses/<slug>/course.json (find lesson by slug → recover title / moduleId / estimatedMinutes) plus the per-widget JSON Schemas for quiz and dragMatch. Invoked once per lesson by the webapp's course-generation backend after design_course has written course.json for a quiz-tagged course. Triggers on: generate_quiz_lesson, Run generate_quiz_lesson, generate quiz lesson <slug>/<lesson-slug>."
user-invocable: true
---

# Generate Quiz Lesson

Produce one valid lesson JSON file for a **quiz-only** lesson. Each invocation handles exactly one lesson identified by `(slug, lesson-slug)` and emits a lesson composed solely of `quiz` and `dragMatch` widgets.

This skill is the quiz-only branch of the course-generation pipeline. It is invoked instead of `generate_lesson` when the course's `course-spec.json` (and downstream `course.json`) carries `tags: ['quiz']`. The research_course stage is **deliberately skipped** in quiz-only mode, so `research.md` and `sources.md` are NOT on disk — do not try to Read them.

**Do NOT touch other lesson files. Do NOT modify `course.json`. Do NOT write to `scripts/ralph/`. Do NOT author any new widget types — quiz-only mode uses ONLY `quiz` and `dragMatch`.**

---

## The Job

1. Receive **two arguments** from the invoking prompt: the course `slug` and the `lesson-slug`. Validate both against the safe-slug rule (`[a-z0-9-]`, no `..`, no `/` — same rule as `assertSafeSlug` in `src/lib/server/paths.ts`).
2. Read `/courses/<slug>/course.json`. Find the lesson by `slug` to recover its `moduleId`, `title`, and `estimatedMinutes`. Do NOT Read `research.md` or `sources.md` — they do not exist in quiz-only mode.
3. Read the per-widget JSON Schemas for the **two allowed widgets**:
   - `src/widgets/schemas/quiz.json`
   - `src/widgets/schemas/drag-match.json`
4. Compose a lesson with **EXACTLY 10–15 widget sections**, each of type `quiz` or `dragMatch`. The mix is yours to pick (see *Section mix* below).
5. Write `/courses/<slug>/lessons/<lesson-slug>.json`.
6. Validate the file against `LessonSchema` (`src/lib/schemas/lesson.ts`). On failure, read the Zod issues, fix the JSON, retry. Never write invalid JSON.
7. Stop.

---

## Step 1: Receive Arguments and Locate the Lesson

The invoking prompt passes two explicit arguments — the course `slug` and the `lesson-slug`. Typical shape:

```
Run generate_quiz_lesson, slug=linear-algebra-quiz, lesson-slug=vectors-and-spans
```

Parse both slugs and validate against `[a-z0-9-]+`. Reject anything else and stop.

The output path is fixed:

```
/courses/<slug>/lessons/<lesson-slug>.json
```

To recover lesson context, open `/courses/<slug>/course.json` and find the matching lesson:

```ts
const lesson = course.modules
  .flatMap(m => m.lessons.map(l => ({ ...l, moduleId: m.id, moduleTitle: m.title })))
  .find(l => l.slug === lessonSlug);
```

Pull `lesson.title`, `lesson.estimatedMinutes`, parent `module.id` and `module.title` (for the lesson's `eyebrow`).

If the lesson is not found, stop with an error.

**Difficulty calibration:** there is no `level` field in quiz-only mode (the wizard omits it; see `CourseSpecSchema` in `src/lib/schemas/courseSpec.ts`). Judge difficulty from the **topic itself** — a *"Vectors and spans"* quiz for a linear-algebra course should be tougher than a *"Verbs of motion"* quiz for a beginner-language course. Use the course title, lesson title, and lesson summary as your sole signal.

---

## Step 2: Read Widget Schemas

Open the per-widget JSON Schemas for the **only two allowed types**:

- `src/widgets/schemas/quiz.json` — `{ question, options: string[≥2], correct: int[≥1], explanation, multiSelect }`
- `src/widgets/schemas/drag-match.json` — `{ prompt, items: {id, label}[≥1], zones: {id, label, accepts: string[]}[≥1], multipleItemsPerZone, requireAll, explanation? }`

`additionalProperties: false` everywhere — extra fields on `data` objects are validation errors. Stick to what the schema declares.

**Do NOT read any other widget schemas.** Quiz-only mode forbids every other widget type (see *Ban list* below).

---

## Step 3: Compose the Lesson

### Top-level shape

```ts
{
  schemaVersion: 1,
  slug: "<lesson-slug>",
  courseSlug: "<courseSlug>",
  moduleId: "<m1 | m2 | ...>",        // from course.json
  title: "<lesson title>",
  eyebrow: "<short uppercase tag>",   // typically the module title in caps, or "QUIZ"
  description: "<one-sentence lesson description>",
  estimatedMinutes: <int>,            // see "Sizing" below
  sections: [ ... ],                  // EXACTLY 10–15 quiz / dragMatch entries
}
```

The top-level `sources` field on `LessonSchema` is **optional** and omitted in quiz-only mode (there is no `sources.md` to draw from).

### Section count and mix

- **EXACTLY 10–15 widget sections per lesson** — every section is `type: "quiz"` or `type: "dragMatch"`. No theory, no code, no demo, no sandbox, no images, no other widgets.
- **Mix is your call.** 100% quiz (10–15 quiz sections, zero dragMatch) is perfectly acceptable and often the right answer.
- **Use `dragMatch` only when the topic naturally yields term↔definition pairs** (e.g. *match each Greek letter to its name*, *match each sorting algorithm to its time complexity*, *match each verb conjugation to its tense*). Forcing a dragMatch onto a topic that doesn't naturally pair things is worse than a clean all-quiz lesson.
- **Mix freely.** When `dragMatch` does fit, intersperse 1–3 `dragMatch` sections across the 10–15 — they pace nicely against the more uniform quiz flow.

### Section IDs

`section.id` must be unique within the lesson. Use stable, content-bearing slugs (`"q-greek-letters"`, `"q-derivative-rules"`, `"match-algorithms-to-complexity"`) — not opaque counters like `s1`/`s2`.

### Sizing — `estimatedMinutes`

Use the same `~10–20 min base` envelope as theory lessons, scaled to the number and difficulty of questions:

| Question count + difficulty                        | `estimatedMinutes` |
|---------------------------------------------------|--------------------|
| 10 quick recall quizzes (multiSelect=false)       | ~10                |
| 12–13 mixed quizzes, some multiSelect             | ~12–15             |
| 15 quizzes including multi-step reasoning         | ~18–20             |
| Add a `dragMatch` with 5+ pairs                   | +2–3 min           |

Cross-check against `lesson.estimatedMinutes` from `course.json` — that is the lesson's planned size and should be your starting point.

### Quiz section rules (mandatory)

Every `quiz` section must have:

```ts
{
  id: "<unique slug>",
  title: "<short prompt-style title, ≤ 60 chars>",
  type: "quiz",
  data: {
    question: "<single unambiguous prompt>",
    options: ["..."],          // ≥ 2; aim for 3–4 plausible options
    correct: [<int indices>],  // ≥ 1; for single-answer quizzes, exactly one index
    explanation: "<1–3 sentences>",  // REQUIRED, see below
    multiSelect: <boolean>     // false for "exactly one right answer", true for "select all that apply"
  }
}
```

- **`explanation` is MANDATORY and MUST be 1–3 sentences.** It justifies the right answer specifically — name the rule / concept / formula that makes the correct option correct, and (when useful) name the misconception each distractor encodes. Do NOT paraphrase the question. Do NOT ship a one-word explanation.
- **`options` are 2–4 entries**, with plausible distractors (wrong answers a learner could *realistically* pick). Avoid throwaway "obviously wrong" options.
- **`correct` is an array of integer indices into `options`.** For single-answer quizzes set `multiSelect: false` and use exactly one index. For "select all that apply" set `multiSelect: true` and use ≥ 1 indices.

### DragMatch section rules

When you ship a `dragMatch`, every section must have:

```ts
{
  id: "<unique slug>",
  title: "<short title>",
  type: "dragMatch",
  data: {
    prompt: "<one-sentence instruction>",
    items: [
      { id: "item-1", label: "..." },
      ...
    ],
    zones: [
      { id: "zone-1", label: "...", accepts: ["item-1"] },
      ...
    ],
    multipleItemsPerZone: <boolean>,
    requireAll: <boolean>,
    explanation: "<1–3 sentences>"  // STRONGLY recommended
  }
}
```

- Each zone's `accepts` lists the `item.id` values that belong in it. For a clean 1:1 term↔definition match, every zone accepts exactly one item.
- Use `multipleItemsPerZone: true` only when the topic genuinely groups multiple items per zone (e.g. *"sort each prime / composite into its bucket"*).
- Use `requireAll: false` only when you intentionally include distractor items that don't belong anywhere — otherwise every item must be placed before Submit unlocks.
- The `explanation` field on `dragMatch` is optional in the schema, but **author one anyway** so the learner gets a closing-rationale paragraph on submit.

---

## Step 4: Ban List

A quiz-only lesson must NOT contain any of the following:

- ❌ `theory` sections
- ❌ `code` / `demo` / `sandbox` / `image` / `video` / `plotImage` / `histogram` / `parametricExplorer` / `audioPlayer` / `dataTable` / `custom` / `codeCloze` / `transcriptCloze` / `sttDemo` / `ttsDemo` sections
- ❌ Inline `![alt](url)` markdown images **anywhere** — there is no `theory` body to host them and the quiz/dragMatch widgets do not render markdown images. (The widget data fields are plain text; markdown image syntax would render as literal characters.)
- ❌ Authoring a new widget type. The corresponding *Step 3a* from `generate_lesson/SKILL.md` does NOT apply in quiz-only mode. If the existing two widgets don't fit, stop and pick a different question — do NOT invent a new widget.
- ❌ A visual-illustrations pass. The corresponding *Step 5* from `generate_lesson/SKILL.md` does NOT apply in quiz-only mode. There are no images to plan, no `Image` widget sections to author, no `assets/images/` cache to manage.

If the topic genuinely needs theory or visuals to be teachable, that's a signal the user should have authored it as a full course — surface a clean error rather than smuggling banned widgets into the quiz JSON.

---

## Step 5: Write and Validate

Write `/courses/<courseSlug>/lessons/<lessonSlug>.json` directly via the Write tool. Then validate against `LessonSchema` — every quiz / dragMatch variant lives in the discriminated union, so a clean parse means the lesson is shape-correct:

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

If validation fails: print the Zod issues, fix the JSON, re-run. **Never write an invalid lesson file.**

Only finish when the validator prints `OK`.

---

## Validation Checklist Before Finishing

- [ ] File written at `/courses/<courseSlug>/lessons/<lessonSlug>.json`.
- [ ] Top-level fields present: `schemaVersion`, `slug`, `courseSlug`, `moduleId`, `title`, `eyebrow`, `description`, `estimatedMinutes`, `sections`.
- [ ] `schemaVersion` is `1`.
- [ ] `slug` matches the filename and the slug listed in `course.json`.
- [ ] `courseSlug` matches the directory.
- [ ] `moduleId` matches the parent module in `course.json`.
- [ ] `estimatedMinutes` is within the `~10–20 min` envelope and consistent with `course.json`'s entry.
- [ ] **`sections.length` is between 10 and 15 (inclusive).**
- [ ] **Every section is `type: "quiz"` or `type: "dragMatch"`** — no other types.
- [ ] **Every `quiz.data.explanation` is 1–3 sentences and non-empty.**
- [ ] Every quiz has ≥ 2 options, ≥ 1 correct, `multiSelect` set explicitly, plausible distractors.
- [ ] Every `dragMatch` has ≥ 1 item, ≥ 1 zone, every `zone.accepts` references a real item id.
- [ ] No inline `![alt](url)` markdown images anywhere in the lesson JSON.
- [ ] No banned widget types appear (`theory`, `code`, `demo`, `sandbox`, `image`, `video`, `plotImage`, `histogram`, `parametricExplorer`, `audioPlayer`, `dataTable`, `custom`, `codeCloze`, `transcriptCloze`, `sttDemo`, `ttsDemo`).
- [ ] All `section.id` values are unique within the lesson.
- [ ] `LessonSchema.safeParse` returns `success: true`.
- [ ] No file written under `scripts/ralph/`.

---

## Cross-references

- [`design_course/SKILL.md`](../design_course/SKILL.md) — wrote the `course.json` (with `tags: ['quiz']`) that you Read in Step 1.
- [`generate_lesson/SKILL.md`](../generate_lesson/SKILL.md) — the full-course sibling skill (theory + practice). Reference only; do NOT follow its steps in quiz-only mode.
- `src/lib/schemas/lesson.ts` — `LessonSchema`, `SectionSchema` discriminated union, Zod source of truth.
- `src/widgets/Quiz/schema.ts` and `src/widgets/DragMatch/schema.ts` — the only two widget data schemas allowed here.
- `src/widgets/schemas/quiz.json` and `src/widgets/schemas/drag-match.json` — JSON Schema mirrors (regenerated via `npm run build:schemas`).
