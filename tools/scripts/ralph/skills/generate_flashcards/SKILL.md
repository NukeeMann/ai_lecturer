---
name: generate_flashcards
description: "Author the Anki flashcards for ONE course module: read the module's lesson files and write /courses/<slug>/flashcards/<module-id>.json validated against FlashcardDeckSchema (src/lib/schemas/flashcards.ts). The server bundles every module file into one .apkg (parent deck = course, one subdeck per module) that the learner imports into Anki with one tap. Invoked once per module by the course-generation pipeline (final flashcards stage) and by the on-demand 'Generate flashcards' job. Triggers on: generate_flashcards, Run generate_flashcards, generate flashcards <slug>/<module-id>."
user-invocable: true
---

# Generate Flashcards

Write the spaced-repetition flashcards for **one module** of an existing course. The learner will study them in Anki, days and weeks after reading the lessons — so every card must be answerable from memory, without the lesson open, and must test exactly one thing the course actually taught.

**Write exactly one file: `/courses/<slug>/flashcards/<module-id>.json`.** Do NOT modify `course.json`, any lesson file, or any other module's flashcards file. Do NOT write to `scripts/ralph/`.

Paths: `/courses/<slug>/…` means the `courses/` directory at the repository root (`./courses/<slug>/…`).

---

## The Job

1. Receive two arguments from the invoking prompt: the course `slug` and the `module-id`. Both must match `[a-z0-9-]+` (same rule as `assertSafeSlug` in `src/lib/server/paths.ts`); stop otherwise.
2. Read `/courses/<slug>/course.json`. Find the module by `id` → its `title` and its `lessons[]` (slugs + titles, in order).
3. Read **every** lesson file of that module: `/courses/<slug>/lessons/<lesson-slug>.json`. Skip lesson files that don't exist. The material is the lesson content — theory markdown, quiz questions and their explanations, dragMatch pairs, dataTable rows, code comments, transcripts.
4. If `/courses/<slug>/flashcards/<module-id>.json` already exists, read it. You are regenerating: **reuse the `id` of every card that still covers the same fact** (rewording is fine — the id is what lets Anki update the card in place and keep the learner's review history). New facts get new ids; drop cards whose fact is no longer in the lessons.
5. Extract the facts worth remembering (see *What to card*), then write cards following *How to write a card*.
6. Write the file and validate it (Step 6). Never leave an invalid file behind.
7. Stop.

---

## Output format

```jsonc
{
  "schemaVersion": 1,
  "courseSlug": "<slug>",            // must equal the course directory name
  "moduleId": "<module-id>",         // must equal the module id in course.json
  "cards": [
    {
      "id": "powierzchnia-polski",   // stable, content-bearing slug: [a-z0-9-], ≤ 80 chars, unique in this file
      "kind": "basic",
      "front": "Jaka jest powierzchnia Polski?",
      "back": "322 716 km²",
      "extra": "Ok. 9. miejsce w Europie.",      // optional
      "lessonSlug": "polozenie-i-granice-polski" // optional but expected: the lesson the fact comes from
    },
    {
      "id": "izoamplituda-definicja",
      "kind": "basic",
      "front": "izoamplituda",
      "back": "linia łącząca punkty o jednakowej rocznej amplitudzie temperatury powietrza",
      "reverse": true,               // also make the back → front card
      "lessonSlug": "klimat-polski"
    },
    {
      "id": "skrajny-punkt-zachodni",
      "kind": "cloze",
      "text": "Najdalej na zachód wysunięty punkt Polski to {{c1::Osinów Dolny}} nad {{c2::Odrą}}.",
      "lessonSlug": "polozenie-i-granice-polski"
    }
  ]
}
```

Card kinds:

| kind    | fields                                   | Anki result |
|---------|------------------------------------------|-------------|
| `basic` | `front`, `back`, optional `reverse: true` | 1 card (2 with `reverse`) |
| `cloze` | `text` with `{{c1::…}}` deletions         | 1 card per distinct `cN` number |

Every card may also carry `extra` (shown under the answer) and `lessonSlug`.

Text dialect (all string fields): plain text, `**bold**` sparingly, `*italic*`, `` `code` ``, `- ` bullet lines (back / extra only), `$inline math$`, `$$display math$$`. **No HTML, no images, no headings, no tables, no links.**

---

## What to card

Card what the course would expect the learner to **recall later**: definitions, key numbers and dates, names, classifications, cause → effect links, order of stages, distinguishing features of easily-confused things, formulas, and the "why" behind the central claims. Draw from the whole module — theory text, but also quiz explanations and dragMatch pairs (they mark what the lesson considered testable).

Do **not** card: anything not in the module's lessons (no outside knowledge, even if true), meta-text ("in this lesson we will…"), trivially obvious statements, purely illustrative examples, code that must be typed out verbatim at length.

**Language:** write every card in the language of the lessons.

**Coverage and size:** cover every important fact once. Typical density is 8–20 notes per lesson, so roughly 20–80 per module; dense reference material (lists of names, numbers, regulations) may need more, light conceptual lessons fewer. Hard cap: 150 notes per module. Prefer covering the core thoroughly over carding every detail.

---

## How to write a card

These rules come from the research on spaced repetition (Wozniak's *Twenty rules of formulating knowledge*, Nielsen's *Augmenting long-term memory*) — they decide whether the deck gets studied or abandoned.

1. **One fact per card (minimum information principle).** If the answer has an "and", split it. Short answers — ideally one word or phrase, at most ~15 words. Detail and explanation go to `extra`, not to `back`.
2. **Unambiguous prompt.** The front must have exactly one correct answer. Add the context a learner needs weeks later: "W klimacie Polski: …", "(Pojezierze Mazurskie) …". Never rely on "this", "the above", "as shown in the lesson".
3. **No set enumerations.** Never "List the 8 types of lakes" — sets are the classic leech. Instead:
   - an **ordered sequence** or a short closed list (≤ 6) → one cloze note with a separate number per item (`{{c1::…}}`, `{{c2::…}}`, …) — each Anki card hides one item while showing the others as context;
   - a long list → several notes, each asking for one item via a distinguishing feature ("Który typ jeziora powstał w zagłębieniu po bryle martwego lodu?" → "oczko wytopiskowe").
4. **Cloze vs. basic.** Cloze for facts that read naturally as a sentence (numbers, names, sequences, definitions with a key term). Basic for questions — especially **"why?" / "what causes…?"** cards (elaborative interrogation: aim for a few per lesson on the central causal links) and **contrast** cards ("Czym różni się X od Y?" with a one-line answer).
5. **Cloze mechanics.** Delete the key term only — never half the sentence. One `cN` number per thing to recall; reuse the same number only for parts that must be recalled together. Use a hint (`{{c1::Warszawa::miasto}}`) when the gap is otherwise ambiguous. Inside math, never let a deletion end with `}` right before `}}` — add a space: `{{c1::\frac{a}{b} }}`.
6. **`reverse: true`** only when recall is valuable in both directions (term ↔ definition, symbol ↔ name, country ↔ capital). Not for questions, not for numbers.
7. **Mnemonics in `extra`.** When the lesson offers one (or a good one is obvious), add it to `extra`; also use `extra` for the short "because…" behind an answer and for "don't confuse with…". Keep `extra` to 1–2 sentences.
8. **No duplicates.** Each fact appears in one card (a basic+reverse pair counts as one note). Don't re-test the same fact with different wording.
9. **Ids** are content-bearing slugs of the fact (`skrajny-punkt-zachodni`, `masa-powietrza-pzm-cechy`), never counters (`card-1`). Keep ids from the existing file for unchanged facts (Step 4).
10. **`lessonSlug`** = the slug of the lesson the fact comes from (from `course.json`). It becomes the small source line under each answer.

---

## Step 6: Write and Validate

Write the file with the Write tool, then validate:

```bash
npx tsx -e "
const fs = require('node:fs');
const file = 'courses/<slug>/flashcards/<module-id>.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
import('./src/lib/schemas/flashcards').then(m => {
  const r = m.FlashcardDeckSchema.safeParse(data);
  if (!r.success) { console.error('FAIL:'); console.error(JSON.stringify(r.error.issues, null, 2)); process.exit(1); }
  if (data.courseSlug !== '<slug>' || data.moduleId !== '<module-id>') { console.error('FAIL: courseSlug/moduleId mismatch'); process.exit(1); }
  console.log('OK:', r.data.cards.length, 'notes');
});
"
```

On failure: read the issues, fix the JSON, re-run. Finish only when it prints `OK`.

---

## Checklist before finishing

- [ ] Exactly one file written: `/courses/<slug>/flashcards/<module-id>.json`.
- [ ] `courseSlug` and `moduleId` match the arguments.
- [ ] Every fact comes from this module's lesson files — nothing from outside.
- [ ] Cards are in the lessons' language.
- [ ] One fact per card; answers short; context in the prompt; no set enumerations.
- [ ] A few "why" / contrast cards per lesson on the central ideas.
- [ ] Ids unique, content-bearing, reused from the existing file where the fact is unchanged.
- [ ] Validator printed `OK`.
