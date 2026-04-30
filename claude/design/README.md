# Handoff: AI Lecturer

A web app for **creating and consuming interactive AI-generated lessons**. Single-user, local-first, desktop-priority. Inspired by Jupyter / Observable / Distill.pub (cells, living documents, interactive math) crossed with Linear/Notion's editorial restraint.

---

## ⚠️ About these files

The files in `source/` are **design references** — HTML/JSX prototypes that show the intended look, feel, and behavior. They are **not production code to copy directly**. They were built to be read in a browser by reviewing humans, not to ship.

Your job is to **recreate these designs in the target codebase's environment** (or pick the most appropriate framework if there is none yet) using its established patterns and libraries. Treat the HTML as a high-resolution spec.

The full prototype is interactive — open `source/index.html` in a browser to explore every screen, toggle light/dark, switch accent color, change density, etc. The Tweaks panel (toggle from the toolbar) is for exploring design variants only — **do not ship it**.

---

## Fidelity

**High fidelity.** Every color, spacing value, type size, border radius, and shadow is final and intentional. Reproduce them exactly.

The exception: the lesson's interactive demo (gradient descent SVG plot), the code editor, and the agent log animations are **functional sketches** — they communicate UX intent (what should happen, what controls the user has) but a real implementation will use proper libraries (e.g. CodeMirror/Monaco for the editor, Pyodide for code execution, real plotting library, real LLM streaming).

---

## What's in this bundle

```
design_handoff_ai_lecturer/
├── README.md                      ← you are here
├── DESIGN_TOKENS.md               ← exhaustive token reference (colors, type, spacing, etc.)
├── SCREENS.md                     ← per-screen breakdown (layout, components, behavior)
├── WIDGETS.md                     ← the 5 lesson-widget types in detail
├── INTERACTIONS.md                ← keyboard shortcuts, animations, state, a11y
├── source/
│   ├── index.html                 ← entry point — open this in a browser to see everything
│   ├── tokens.css                 ← the canonical design system file (copy values from here)
│   ├── components.jsx             ← atomic components (Icon, Button, Widget, Callout, etc.)
│   ├── screen-lesson.jsx          ← 3-column lesson view + LessonChat (AI tutor)
│   ├── screen-create.jsx          ← course creation wizard (5 stages)
│   ├── screen-dashboard.jsx       ← course list / continue-learning
│   ├── screen-system.jsx          ← design system showcase board
│   ├── design-canvas.jsx          ← presentation shell (not part of the product)
│   └── tweaks-panel.jsx           ← exploration tool (not part of the product)
```

> **Tip:** Open `source/index.html` in a real browser. You'll land on a pannable design-canvas board with every screen as an artboard. Click any artboard's expand button (top-right) to focus it fullscreen. Use ←/→ to navigate between artboards, Esc to exit. The canvas chrome and the Tweaks panel are exploration tools — you're recreating the *content* of each artboard, not the canvas itself.

---

## Project goals (the product brief)

The app helps a single user **learn something deeply** — not skim, not consume passively. They tell an AI agent what they want to learn; a chain of agents proposes a course structure; the user approves it; the agents generate it; the user works through interactive, notebook-style lessons that mix prose, math, demos, quizzes, and code exercises.

**Aesthetic:** minimalist, content-first, warm-but-not-childish. For someone who *wants* to learn — not for kids, not for corporations. Light + dark are both first-class.

**Visual references** (study these before implementing):
- **Jupyter / Observable** — cells, editable blocks, "living document" feel
- **Distill.pub** — typography as hero, generous prose width, KaTeX math, callouts
- **Linear / Notion** — clean professional UI, lots of whitespace, restraint
- **Khan Academy / Brilliant** — clear progress, minimal gamification
- **3blue1brown explorables** — interactive viz feels like *play*, not a form

**Anti-patterns** (do not do):
- Confetti, celebration explosions, achievement badges
- Cartoon mascots, rainbow gradients
- Heavy borders, drop-shadowed cards, "bento grid" maximalism
- Stat slop / decorative numbers / decorative iconography
- Inter / Roboto as default — use Geist (or IBM Plex / Source Serif as alternatives)

---

## Technical recommendations

If you're starting from scratch, this design assumes:

- **Stack:** React + Vite (or Next.js if SSR is desired). The prototype is React-flavored; components map cleanly. TypeScript strongly recommended.
- **Styling:** CSS variables (the token system is already CSS-vars-native; see `tokens.css`). Use **CSS Modules** or **vanilla-extract** for component styles. Avoid Tailwind — the design depends on semantic tokens, not utility classes; if you do use Tailwind, configure its theme to read from CSS vars.
- **Math rendering:** KaTeX (the spec uses inline rendering — see math blocks in the Theory widget).
- **Code editor:** CodeMirror 6 (lighter than Monaco, fits the aesthetic better — see `WIDGETS.md → Code widget`).
- **Code execution:** Pyodide (browser-native Python; runs in a Web Worker).
- **State:** Local-first; this is a single-user desktop-priority app. Use Zustand or Jotai. Persist to IndexedDB (Dexie).
- **LLM:** Streaming responses required for both the course-creation agent chain and the LessonChat tutor. Anthropic's SDK or OpenAI's both work.
- **Icons:** The prototype rolls its own (`Icon` component in `components.jsx`). For production, use **Lucide** — the prototype's SVG paths are derived from Lucide and the visual feel matches.
- **Fonts:** Geist (sans + mono) is the default. IBM Plex Sans/Mono and Source Serif 4 are the supported alternates (the user can switch via tweaks; production should expose this as a settings preference).

### Theme application

The design system uses three orthogonal data attributes on `<html>`:

```html
<html data-theme="light|dark" data-accent="default|black|indigo|terracotta|emerald" data-density="compact|comfortable|spacious">
```

All tokens flow from these. See `DESIGN_TOKENS.md` for every variable.

---

## Screens to build (priority order)

1. **Lesson view** — the heart of the product. 3-column layout (TOC | content stream | AI tutor chat). 5 widget types stream vertically as a notebook. **Build this first.** See `SCREENS.md → Lesson View` and `WIDGETS.md`.
2. **Dashboard** — list of courses, "continue learning" hero. See `SCREENS.md → Dashboard`.
3. **Course creation flow** — 5-stage wizard (Topic → Refinement chat → Structure tree → Approval → Agent log). See `SCREENS.md → Course Creation`.
4. **Empty state** (first-time user, no courses) — designed but not in the prototype; produce a calm onboarding that points at "Create your first course".

The design-system board (`screen-system.jsx`) is **for designers**; it's a Storybook-equivalent. You don't need to ship it but it's a useful test page during development.

---

## Critical UX requirements (do not skimp)

- **Keyboard is first-class.** Section-by-section navigation in lessons (`j` / `k` or `↓` / `↑`), `Enter` runs code, `⌘+,` opens tutor, `⌘+B` toggles TOC, `?` shows shortcuts. See `INTERACTIONS.md`.
- **Auto-save is visible but not loud.** A small "Saved" indicator with a status dot in the corner. Never block the user. Notes/code/quiz answers/scroll position all persist.
- **Optimistic UI everywhere.** When Pyodide is loading, show skeleton in the code widget; when the LLM is streaming, show the response progressively; never show full-page spinners.
- **Transparency for AI work.** When an agent is doing something, the user sees *what* and *why* — not a black box. The course-creation log is the canonical example.
- **Honest progress.** Section completion = user clicked "Mark complete" OR finished the interactive thing (passed the quiz, ran the code that passes tests). Not arbitrary percentages.

---

## Read next

- **`DESIGN_TOKENS.md`** — every color, spacing value, type size, radius, shadow.
- **`SCREENS.md`** — every screen's layout, components, copy.
- **`WIDGETS.md`** — the 5 widget types (Theory, Demo, Quiz, Code, Sandbox) and the extensible container system.
- **`INTERACTIONS.md`** — keyboard, animations, accessibility, state management.

Then open `source/index.html` and click around for 10 minutes. The prototype is the source of truth; these docs index it.
