# Interactions, Keyboard, Animation, State, A11y

---

## Keyboard shortcuts

**First-class.** This product targets focused learners; keyboard navigation is essential.

### Global

| Shortcut | Action |
|---|---|
| `?` | Open keyboard shortcuts modal |
| `⌘ K` / `Ctrl K` | Command palette (jump to any course/lesson, future) |
| `⌘ ,` / `Ctrl ,` | Settings |
| `Esc` | Close modal / dismiss focused widget |

### Lesson view

| Shortcut | Action |
|---|---|
| `j` / `↓` | Next section in lesson |
| `k` / `↑` | Previous section in lesson |
| `⌘ B` / `Ctrl B` | Toggle TOC sidebar |
| `⌘ .` / `Ctrl .` | Toggle AI tutor chat |
| `⌘ Enter` | Run code (when code widget is focused) |
| `⌘ ⇧ Enter` | Submit code (run tests) |
| `Space` | Mark current section complete |
| `n` | Next lesson (when current marked complete) |
| `p` | Previous lesson |
| `f` | Toggle focus mode (collapses both panels) |

### LessonChat composer

| Shortcut | Action |
|---|---|
| `Enter` | Send message |
| `⇧ Enter` | New line |
| `↑` (in empty input) | Edit last sent message |

### Course creation flow

| Shortcut | Action |
|---|---|
| `Enter` | Advance to next stage (when valid) |
| `Esc` | Cancel and return to dashboard (with confirm if started) |
| `←` | Back to previous stage |

---

## Animations

Use the easing tokens (`--t-fast`, `--t-base`, `--t-slow`). All cubic-bezier(0.16, 1, 0.3, 1) — quick start, gentle settle.

### Lesson view

- **Section scroll** (TOC click → smooth scroll to section): `behavior: 'smooth'`, with a 60ms TOC-row highlight pulse on land.
- **Mark complete**: status dot animates from hollow → success solid with a 280ms scale spring (1.0 → 1.3 → 1.0). Soft, not celebratory. **No confetti.**
- **TOC collapse / expand**: 180ms width transition.
- **Chat panel toggle**: 180ms slide-in from right edge.
- **Lesson advance** (when "Next" clicked): 240ms fade-out, scroll reset, fade-in.

### LessonChat

- **Message enter**: 180ms fade + 4px Y-translate from below.
- **Thinking dots**: 3 dots, 1200ms `chatDotPulse` keyframes (defined in `tokens.css`), 150ms stagger.
- **Reference chip hover**: 120ms background tint.

### Course creation — agent log

- **Card status changes**: pending → active = 280ms scale + dot start pulsing. Active → done = check icon morph in.
- **Sub-task append**: each sub-task fades + slides in (180ms, 80ms stagger).
- **Streaming text**: token-by-token append (no animation per token — just feels alive).

### General

- **Hover**: 120ms color/border/bg.
- **Focus**: instant (no transition on focus shadow — accessibility).
- **Modal enter**: 180ms scale 0.96 → 1.0 + fade.

---

## State management

Local-first. No server-side state for the user's progress.

### Persistence layers

- **IndexedDB (via Dexie)**:
  - `courses` table: course metadata, structure, ownership.
  - `lessons` table: lesson content (markdown/MDX + widget configs).
  - `progress` table: `{lessonId, sectionId, status, completedAt, code, quizAnswer, scrollY}`.
  - `chat_history` table: per-lesson tutor conversations.
- **localStorage**: theme, accent, density, font preference, sidebar collapsed state.
- **In-memory only** (Zustand or Jotai): currently-streaming responses, transient UI state.

### Auto-save semantics

- **Code edits**: debounced 800ms.
- **Quiz answers**: immediate on submit (and persist the "submitted" state to gate explanation visibility).
- **Notes (if added later)**: debounced 1200ms.
- **Scroll position per lesson**: throttled 200ms.
- **Course creation drafts**: every transition between stages.

### Save-status indicator

A subtle 5px dot in the toolbar (or near the relevant editor) — `--success` filled when saved, `--warning` filled when saving, `--text-quaternary` ring when offline. Accompanied by tiny text `Saved` / `Saving…` / `Offline`.

---

## Accessibility

### Required behaviors

- **Focus ring**: never remove or override the global `:focus-visible` shadow. Tested at WCAG 2.1 AA contrast.
- **Tab order**: TOC → toolbar → content stream (top to bottom by widget) → tutor chat → bottom bar.
- **Skip links**: `Skip to main content`, `Skip to TOC` — visible on focus, off-screen otherwise.
- **Semantic HTML**: `<main>` for content stream, `<aside>` for TOC + chat, `<nav>` for breadcrumb, `<header>` / `<footer>` for the bars.
- **ARIA**:
  - Widget = `<section role="region" aria-labelledby="...">`.
  - TOC active lesson = `aria-current="page"`.
  - Streaming chat assistant message = `aria-live="polite"`.
  - Math blocks = `aria-label` with the LaTeX source as a fallback.
  - Code editor = use CodeMirror's built-in a11y (already strong).
- **Keyboard-only operability**: every interaction available via keyboard. No mouse-only flows.
- **Reduced motion**: respect `prefers-reduced-motion`. Disable scroll-smoothing, the mark-complete spring, and the agent-log card animations. Replace fades with instant.
- **Color contrast**: every text/bg pair in light + dark passes AA. Tested with `--text-tertiary` on `--bg` (the lowest pair) — passes.
- **Screen reader**: don't put critical content in pseudo-elements. The "completed" state of a lesson must be readable, not just visually shown.

### Reduced motion override

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## Error states

- **LLM stream interrupted**: assistant message shows partial text + a "⟳ Retry" link inline. No modal, no toast for transient errors.
- **Code execution error** (Python traceback): full traceback rendered in `--danger` color in the output panel, monospace, preserving stack indentation.
- **Pyodide failed to load**: code widget shows a `--danger-subtle` callout with "Python runtime unavailable. Refresh to retry." — disable Run/Submit buttons but keep the editor functional.
- **Network offline**: subtle banner under the toolbar in `--warning-subtle` — "Offline · changes saved locally." Auto-dismisses on reconnect.
- **Save failure**: the save-status dot turns `--danger` and reveals a tooltip with retry. Do NOT lose the user's input — keep it in memory and retry every 5s.

---

## Loading states

- **Pyodide warming up**: code widget output panel shows `Loading Python runtime…` with a 4-dot bouncing animation in `--text-tertiary`.
- **LLM thinking**: chat shows the 3-dot thinking pulse + "thinking…".
- **Course generation**: agent-log cards each have their own pending → active → done lifecycle (see SCREENS.md → Agent log).
- **Page-level**: never show a full-page spinner. If the lesson is loading, render the layout with skeleton bars where widgets will go.

---

## Empty states

- **No courses**: see `SCREENS.md → Empty state`.
- **No active lesson on dashboard**: hide the "Continue learning" hero entirely; don't show a stub.
- **Empty TOC** (shouldn't happen, but): show a single ghost row "No lessons in this course yet."
- **Empty chat**: shows the suggested-prompts list as the entire panel content.

---

## Responsive behavior (bonus, not required)

Desktop-first. The design assumes ≥1280px viewport. If you want to support smaller:

- **<1100px**: hide the chat panel by default; toggle replaces the full-width.
- **<900px**: hide TOC by default; toggle replaces the full-width.
- **<700px**: stack: TOC drawer (left, slides in) + content full-width + chat full-screen overlay. Bottom bar collapses to icon-only.

Mobile is **out of scope** for v1.

---

## Things to deliberately avoid

- **Confetti, fireworks, celebration explosions.** Mark-complete is a calm scale spring on the dot, no more.
- **Toasts for every action.** Auto-save = silent dot. Errors = inline. Use toasts only for system-level events (offline, sync conflict).
- **Decorative iconography.** Every icon must be functional or label something. No "stat slop" with icons next to numbers.
- **Tooltips that say what the button visually says.** Tooltips only for icon-only buttons or for keyboard shortcut hints.
- **Modal overload.** Settings, course creation, and lesson view are full-page. Modals are reserved for: keyboard shortcuts, command palette, destructive confirmations.
- **Loading spinners as a default.** Skeleton states or progressive content always preferred.
