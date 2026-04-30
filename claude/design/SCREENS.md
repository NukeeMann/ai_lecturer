# Screens

Four user-facing screens. Build in this order: **Lesson View** (the heart) → **Dashboard** → **Course Creation** → **Empty state** (not in prototype).

The design-system board (`screen-system.jsx`) is a designer-facing showcase, not a user-facing screen. Don't ship it.

---

## 1. Lesson View — `screen-lesson.jsx`

The notebook-style learning surface. **This is the heart of the product.**

### Layout

3-column grid + top + bottom bars:

```
┌──────────────────────────────────────────────────────────────────────┐
│  TOOLBAR  (52px height)                                              │
├──────────┬──────────────────────────────────┬────────────────────────┤
│          │                                  │                        │
│  TOC     │  CONTENT STREAM (widgets)        │  LESSON CHAT (AI       │
│  276px   │  flexible, scrolls               │  tutor) 320px          │
│  (52px   │                                  │  collapsible           │
│  collapsed)                                 │                        │
│          │                                  │                        │
├──────────┴──────────────────────────────────┴────────────────────────┤
│  BOTTOM BAR  (56px)  ← prev | mark complete | next →                 │
└──────────────────────────────────────────────────────────────────────┘
```

CSS grid: `grid-template-columns: ${tocCollapsed ? '52px' : '276px'} minmax(0, 1fr) ${chatOpen ? '320px' : '0px'}`, rows `52px 1fr 56px`.

### Toolbar (top, 52px)

Left → right:
- **Breadcrumb** in `--text-tertiary`, `--fs-sm`: `Course name › Module name › Lesson name`. The lesson name is `--text` (primary). Breadcrumbs are clickable.
- **(spacer, flex: 1)**
- **Section progress pill**: `2/5` in `--font-mono`, `--fs-sm`, in a tinted pill (`--bg-subtle` background, 1px `--border`, `--radius-md`, padding `4px 10px`). Followed by a 60×4px segmented progress bar.
- **Vertical divider** (1px × 22px in `--border`).
- **Icon button — keyboard shortcuts** (`?`). Opens shortcuts modal.
- **Icon button — toggle AI tutor** (`⌘.`). Active state: `--accent` color, `--accent-subtle` background.

### TOC sidebar (left, 276px collapsed → 52px)

- **Header**: course title in `--fs-sm` weight 600, with a chevron-back-style "All courses" link above it in `--fs-xs` `--text-tertiary` uppercase eyebrow.
- **Module groups**: each module is a collapsible section with a header (`--fs-sm` weight 600), and child lessons indented.
- **Lesson row**: 28px tall, padding `0 12px`, `--fs-sm`, gap-2 between status dot + label.
  - **Status dot** (left, 6px): `--success` (done), `--accent` (in progress), `--border-strong` (todo, hollow).
  - **Active lesson**: full row gets `--accent-subtle` background, label color `--accent-text`, weight 600, with a 2px-wide left accent border bleeding into the row.
- **Collapsed state (52px)**: only the status dots visible, vertically stacked. Hover = tooltip with full label.

### Content stream (center)

Vertical scroll. **Widgets** stream top-to-bottom with `var(--space-section)` gaps. Max content width: 760px, centered with horizontal padding of `var(--space-6)`.

Above the first widget: a **lesson header** with:
- Eyebrow (`Module 2 · Lesson 5`, `--fs-xs` uppercase letter-spacing 0.06em weight 600 `--text-tertiary`)
- H1 lesson title (`--fs-3xl` weight 600 letter-spacing -0.02em)
- 1-line description in `--text-secondary` `--fs-md`

Then the widgets — see **WIDGETS.md** for each type.

### LessonChat (right, 320px) — AI tutor

A **collapsible chat panel** anchored to the right edge. **This is the live LLM tutor**, not a notes field. Toggle via `⌘.` or the toolbar button.

- **Header** (52px, matches toolbar height):
  - 22px round avatar in `--accent-subtle` background, `--accent` color, sparkle icon
  - 2-line stack: "Tutor" (`--fs-sm` weight 600) + "Knows this lesson" (`--text-tertiary` 10.5px)
  - Right: small refresh icon button (new conversation)
- **Context chip strip** (below header, in `--bg`):
  - Eyebrow "Context" + a small monospace chip showing the section the tutor is anchored to (e.g. `§ See it descend`), with an ✕ to dismiss. The chip auto-updates to whichever section the user is reading.
- **Message thread**:
  - User bubbles: right-aligned, max-width 88%, `--accent-subtle` bg, `--accent-text` color, `border-radius: 10px 10px 2px 10px`, `padding: 8px 12px`.
  - Assistant messages: left-aligned, no bubble — just prose at `--fs-sm` line-height 1.6 in `--text`. After the message: optional tappable **section reference chips** in monospace 11px (e.g. `→ § The intuition`) that scroll the lesson to that section.
  - **Thinking state**: 3 small pulsing dots + "thinking…" while waiting on the LLM stream.
- **Suggested prompts** (only while conversation is short, ≤3 messages): 3 ghost buttons stacked vertically with sample questions. Disappear once the user starts chatting.
- **Composer** (bottom):
  - Multi-line textarea in a card-like wrapper (`--bg`, 1px `--border-strong`, `--radius-md`, padding 8px). Auto-grows.
  - Below textarea: tool buttons row (left: + attach, book reference) + send button (right, 26px square, `--accent` bg, white arrow icon, disabled state with `--bg-subtle`).
  - Helper text below: "Tutor sees the current section. ⌘. to toggle"
  - **Enter** sends; **Shift+Enter** newline.

**LLM-wise**: stream the assistant response token by token. Pass the current section (and ideally the rendered text of recent sections + user's recent quiz/code answers) as context. Section-reference chips should be **structured output** from the model — not parsed from prose — so they're reliable.

### Bottom bar (56px)

- **Prev** button (ghost, with eyebrow "Previous" + lesson title beneath)
- **Mark lesson complete** button — primary if all sections done, secondary otherwise. Becomes "Lesson completed" with check icon once clicked.
- **Next** button (mirror of Prev). Auto-advances when current lesson marked complete (with a 600ms delay + soft animation).

### Behavior

- **Section completion**: each widget has a "Mark complete" or auto-completes (quiz answered correctly, code tests pass). Section dots in the TOC update live.
- **Auto-save**: scroll position, code edits, quiz answers, and chat history persist per lesson per user. IndexedDB.
- **Focus mode** (variant in prototype): collapses TOC + chat, recenters content at narrower max-width. Triggered by a keyboard shortcut or toolbar button. Production should ship this.

---

## 2. Dashboard — `screen-dashboard.jsx`

The home screen. Course list + continue-learning hero.

### Layout

Top header (64px): logo / app name on left, search input centered, settings + avatar on right.

Below: max-width 1080px content area, padding `var(--space-7) var(--space-6)`.

1. **"Continue learning" hero card** (full width of content, `--radius-xl`, `--bg-elevated`, 1px `--border`):
   - Left side: course thumbnail/icon + module breadcrumb + lesson title (`--fs-2xl` weight 600).
   - Right side: a **mini loss-plot** SVG (240×80) showing the user's progress in the current lesson — a stylized echo of the demo widget. **This is a signature touch** — the dashboard winks at the lesson content.
   - Big "Resume" primary button.
2. **Course grid** (CSS grid, `repeat(auto-fill, minmax(320px, 1fr))`, gap `var(--space-5)`):
   - Each card: `--bg-elevated`, `--radius-lg`, 1px border, padding `var(--space-5)`.
   - Card header: 36px round icon in subtle accent, course title (`--fs-lg` weight 600), 1-line description.
   - Status badge: "New", "In progress · 3/12", "Completed".
   - Progress bar: 4px tall, full width, `--accent` fill, `--bg-subtle` track.
   - Hover: border darkens to `--border-strong`, subtle `--shadow-sm` lift.
3. **List view toggle** (top right of grid): icon buttons toggle between grid + dense list. List rows are 56px tall with the same info inline.
4. **Empty state**: when the user has zero courses, replace the grid with a centered card prompting "Create your first course" + a sample-topic suggestion grid (3-4 chips: "Linear algebra basics", "How transformers work", etc.).

### Big CTA — "New course"

Top-right of the page, primary button with `+` icon. Opens the Course Creation flow.

---

## 3. Course Creation — `screen-create.jsx`

A 5-stage wizard. **Each stage is a separate full-bleed view** (not a modal). A persistent step indicator at the top tracks progress.

### Step indicator (top, 64px)

Five circles connected by a 1px line, each labeled with its stage name. Active circle: `--accent` filled. Completed: `--success` checkmark. Future: outlined `--border-strong`.

`Topic → Refine → Structure → Approve → Generate`

The user can click back to any *completed* step but not jump ahead.

### Stage 1 — Topic

Centered, max-width 640px, vertically centered in the page.

- Eyebrow: "What do you want to learn?" `--fs-sm` `--text-tertiary`
- Big text input (no border, just a `--border` underline; `--fs-2xl` weight 500). Placeholder cycles through 3-4 example topics every 3s.
- Below: 4 chip suggestions ("Backpropagation", "Linear algebra for ML", "How GPT works", "Bayesian statistics") that pre-fill the input.
- "Next" button (primary, right-aligned, only enabled when input has ≥3 words).

### Stage 2 — Refinement chat

Conversational with the **planner agent**. **Structured chat**, not free-form.

- Centered max-width 720px, agent messages on left, user on right.
- Agent sends 4-6 questions in sequence, each shown as a **structured prompt**:
  - "What's your level with this?" + **3-4 button options** ("Beginner", "Some experience", "I know the basics") plus a small "type your own" affordance.
  - "How long should this take?" + 3 chips ("30 min", "An hour", "A weekend deep dive")
  - "Theory or practice?" + slider (theory 0% → 100% practice).
- After all questions: agent says "Got it. Generating a structure…" — this transitions to Stage 3.

### Stage 3 — Structure

The **proposed course structure** as an editable cascade. Three columns:

`Course → Modules → Lessons`

- Column 1 (Course): single card showing course title + 1-line description, both inline-editable.
- Column 2 (Modules): list of 3-5 module cards. Click selects → column 3 updates. Drag to reorder. Inline rename. + button to add.
- Column 3 (Lessons of selected module): list of 4-8 lesson rows with title + 1-line description + estimated minutes. Drag to reorder. Inline rename. + and trash icons.

This is **the alternative to a flat tree** — feels spatial and explorable.

Sticky bottom bar: "Back" (ghost) | "Looks good — generate" (primary).

### Stage 4 — Approval

A read-only summary view: the full course outline rendered as a clean document. Shows the cost estimate ("≈ 3 minutes to generate, 12 lessons") and a final confirmation. Big "Generate course" button.

### Stage 5 — Agent log

The **transparency screen** — what the agent chain is doing, in real time.

**Not a terminal.** Stack of **expanding cards**, one per agent phase:

- `Researcher` — gathering sources (with mini list of discovered references streaming in)
- `Architect` — finalizing module structure (shows updates)
- `Writer` — drafting lessons (shows current lesson being written, with token count incrementing)
- `Reviewer` — fact-checking (shows checks passing/failing)
- `Editor` — polishing prose (final pass)

Each card has:
- Status dot (pulsing dot for active, ✓ for done, neutral hollow for pending)
- Agent name + role description
- Sub-task list that expands as the agent works (live)
- Time elapsed in monospace
- Subtle progress bar at bottom of active card

When all done: redirect to the dashboard with the new course highlighted, OR offer "Open first lesson" CTA.

---

## 4. Empty state (not in prototype, but spec it)

First-time user. Show:
- Big welcome H1 ("What would you like to learn?")
- Prominent "Create your first course" primary CTA
- 4-6 starter topic chips
- Subtle, optional "How it works" 3-step explainer below the fold

Calm, restrained, single focal point. No marketing-y "features list".
