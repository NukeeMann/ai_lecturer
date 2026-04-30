# Widgets

The lesson stream is composed of **widgets** — self-contained content blocks. Five core types ship; the system is **extensible**: a "custom" type lets future widgets (graphs, histograms, embedded videos) slot into the same container.

All widgets share a common shell — header chrome, body, optional footer.

---

## Shared widget container

**Source:** `Widget` component in `source/components.jsx`.

### Anatomy

```
┌─ 1px border, --radius-lg, --bg-elevated, --shadow-xs ────────────────┐
│                                                                       │
│  ┌────┬─────────────────────────────────────────────┬──────────────┐ │
│  │ ◉  │  TYPE LABEL · §N                            │  STATUS      │ │
│  │    │  Title of this section                      │  BADGE       │ │
│  └────┴─────────────────────────────────────────────┴──────────────┘ │
│  ────────────────────────────────────────────────────────────────── │  ← 1px border
│                                                                       │
│  BODY (children — varies per widget type)                            │
│                                                                       │
│  ────────────────────────────────────────────────────────────────── │  ← optional
│  FOOTER (controls — varies per widget type)                          │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### Header

- Padding: `var(--space-4) var(--space-5)`. Background `--bg-elevated`. Border-bottom 1px `--border`.
- **Type icon** (left, 28×28 round): `--bg-subtle` background, color = widget type's accent color (see `--widget-{type}` tokens). 14px icon.
- **Eyebrow + title stack**:
  - Eyebrow: `[TYPE LABEL] · §[NUMBER]` — e.g. `THEORY · §1` — `--fs-xs` weight 600 letter-spacing 0.06em uppercase, color `--text-tertiary`.
  - Title: `--fs-md` weight 600, color `--text`.
- **Status badge** (right): "Completed" (success), "In progress" (accent), or absent (todo).

### Body

The widget container does **no body padding by default** — children control their own padding. This is intentional: the Code widget needs flush-edge code blocks, the Theory widget needs generous prose padding, and the Demo widget needs a full-bleed plot.

### Widget-type accent rail

A 1px-tall colored bar along the **top edge** of the widget header (not the left edge) using the widget's `--widget-{type}` token. Subtle — keeps the visual rhythm without screaming.

---

## Type 1 — Theory

**Long-form prose with math, callouts, code blocks.** The reading experience.

- **Body padding**: `var(--space-5) var(--space-6)` (vertical / horizontal). Generous horizontal breathing room.
- **Prose**: `--font-prose`, `--fs-md` (16px), `--line-height-prose` (1.7). Color `--text`.
  - Paragraphs separated by `var(--space-4)` margin. Use `text-wrap: pretty` for orphans.
- **Inline code**: `--font-mono`, 0.88em, `--bg-subtle` bg, 1px `--border`, `--radius-xs`, padding `2px 5px`.
- **Math blocks** (KaTeX): centered, `--bg-subtle` bg, 1px `--border`, `--radius-md`, padding `var(--space-4) var(--space-5)`, `var(--space-4)` vertical margin.
- **Callouts** (`Callout` component, four tones — info/insight/warning/danger):
  - Tinted background per tone (`--{tone}-subtle`), 1px tinted border (`--{tone}-border`), `--radius-md`, padding `var(--space-4) var(--space-5)`.
  - Icon (left, in tone's solid color) + title (weight 600) + body in `--text-secondary`.
- **Headings inside theory**: H2 `--fs-lg` weight 600 with `var(--space-5)` margin-top.

### KaTeX setup

Install `katex`. Render inline as `\(...\)` and block as `\[...\]` or `$$...$$`. Use `react-katex` or render-on-mount. Style override: KaTeX defaults are fine; just ensure font color uses `--text`.

---

## Type 2 — Demo (Interactive)

**Live, manipulable visualization.** The "explorable explanation" widget — 3blue1brown vibes.

In the prototype, it's the **gradient descent plot**: an SVG showing a loss curve with iterative descent steps animating as the user drags sliders.

### Layout

- **Plot area** (top): full-width, ~260px tall. SVG. Loss curve as a path; descent trajectory as a dashed accent-colored path with circles at each step (last step filled solid). X-axis label, Y-axis ticks, grid lines in `--border`.
- **Controls** (below plot, padding `var(--space-4) var(--space-5)`):
  - Stack of 2-3 named sliders: each row is `[label]   [value]   [────●────]`.
  - Numeric values in `--font-mono`, `--fs-sm`.
  - Slider track: 4px tall, `--bg-subtle`, with `--accent` fill from min to value. Thumb: 14px round, `--accent`, `--shadow-sm`.
- **Reset button**: ghost, bottom-right of controls area, `↻ Reset` — restores all defaults.

### Footer (collapsible "What just happened?")

Optional. A `<details>`-style expandable strip under the controls (with `--bg-subtle` bg, 1px `--border` top), giving plain-language commentary on what the user is seeing. Critical for explorables: the text adapts to the slider values ("With η=0.9, the descent overshoots the minimum and bounces — this is divergence").

### Production notes

Build demos as **fully separate React components** that drop into the Widget container. Each demo is bespoke. The prototype's gradient-descent plot is one example — others might be matrix multiplications, neural network forward pass, etc. Use D3 for axes/scales, but render with React (no D3 DOM mutation).

---

## Type 3 — Quiz (ABCD)

Single- or multi-select multiple choice with **always-shown explanations** after submit.

- **Question** (top, padding `var(--space-5)`): `--fs-md` weight 500, color `--text`.
- **Options** (4 cards, full-width, stacked with `var(--space-3)` gap):
  - Each: 1px `--border-strong`, `--radius-md`, padding `var(--space-4) var(--space-5)`, `--bg-elevated` bg.
  - Letter prefix (A/B/C/D) in `--font-mono` `--text-tertiary`, then option text in `--fs-sm`.
  - Hover (pre-submit): border `--accent-border`, bg `--accent-subtle`.
  - Selected (pre-submit): border `--accent`, bg `--accent-subtle`, weight 500.
  - **Post-submit states**:
    - Correct (whether selected or not): border `--success-border`, bg `--success-subtle`, with check icon right.
    - User's incorrect choice: border `--danger-border`, bg `--danger-subtle`, with x icon right.
    - Other untouched: dimmed (`--text-tertiary`).
- **Submit / Try again button** (footer, padding `var(--space-4) var(--space-5)`): primary if not submitted, ghost if submitted.

### Always-shown explanation block

After submit, render a callout-style block below the options with the explanation. **This is non-negotiable** — it's the entire point of a quiz in a learning app. Even if correct, show *why* it's correct.

### Multi-select variant

Same UI; checkboxes instead of radio. Submit only enabled when ≥1 selected. Correctness = exact match of selected set.

---

## Type 4 — Code Exercise

**Editable code + tests.** Production should use **CodeMirror 6**.

- **Task description** (top, padding `var(--space-4) var(--space-5) 0`): prose at `--fs-sm`, line-height 1.5.
- **Editor**: full-width, ~200-300px tall depending on exercise size. `--code-bg` background, `--font-mono`, 13px, line-height 1.55. Syntax highlighting using the `--code-*` tokens. Line numbers in `--text-quaternary`. Active line subtly tinted.
- **Output panel** (below editor, in `--bg-subtle`, padding `var(--space-4) var(--space-5)`):
  - **Stdout** in `--font-mono` `--fs-sm`.
  - **Test results** as a checklist: each test = `✓ test_name` (success color) or `✗ test_name` (danger color), in `--font-mono` 12px. Clicking a failing test shows the assertion mismatch.
- **Footer controls** (right-aligned):
  - `↻ Reset` (ghost) — restores starter code.
  - `▶ Run` (secondary) — runs without testing.
  - `✓ Submit` (primary) — runs against test suite, marks complete on pass.

### Two modes

- **Experimental** (Jupyter-cell-like): no tests visible, just Run + output. Used inside Theory widgets for inline code playgrounds.
- **Graded** (the default Code widget): Submit runs tests, gates section completion.

### Pyodide setup

Load Pyodide in a Web Worker on app start (so it's warm by the time the user opens a code widget). Show a skeleton `Loading Python runtime…` state in the editor's output panel while it boots. ~3-5s on first load.

---

## Type 5 — Sandbox

**Like Code, but no tests — pure exploration.** Visually distinguished by the amber `--widget-sandbox` accent.

- Same editor as Code.
- No test panel. Just Run → output.
- **Encouragement copy** above the editor: a single italic line in `--text-secondary` like *"Try changing X and see what happens. Nothing breaks."*
- No completion gate — sandbox doesn't have a "submit" concept.

---

## Extensibility — the "custom" widget type

The Widget container accepts `type="custom"`. This lets future widget types (graph viz, histogram, embedded video, image annotator) slot in cleanly.

A custom widget contributes:
1. A **type token** in `tokens.css` (`--widget-{name}`).
2. An **entry in `widgetMeta`** (`source/components.jsx`) with `{ color, label, icon }`.
3. A React component that renders inside the body.

Show this extensibility in the design system board (`screen-system.jsx`) — there's a "Custom Widget" example using a placeholder graph viz.

### Per-widget concerns to honor

- **Padding**: each widget's body controls its own padding. Don't add padding to the container.
- **Color discipline**: the widget rail color (`--widget-{type}`) and the header icon color are the **only** places the type-color appears. Don't tint backgrounds, don't color body text, don't draw colored borders. Restraint.
- **Status**: every widget has a `status` prop (`'todo' | 'progress' | 'done'`) that controls the badge in the header.
