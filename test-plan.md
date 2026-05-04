# AI Lecturer — End-to-End QA Test Plan

A single-pass, checkbox-driven walkthrough that lets a maintainer sanity-check a release. Targets **≤30 minutes** for someone who has used the app before, **≤60 minutes** for a first-time reviewer. Every item has an explicit pass criterion — if you can't tick the box because the symptom is fuzzy, treat it as a fail and file a bug.

Each section references the `US-NNN` story (or stories) that originated it so failures can be traced back to the right PR / progress.txt entry.

---

## 1. Setup (US-001, US-002)

Run from the repo root.

- [ ] `npm install` completes with **no peer-dep errors** (warnings about optional deps are OK).
- [ ] `npm run typecheck` exits 0.
- [ ] `npm test` passes (≥200 tests green).
- [ ] `npm run dev` starts and prints `Ready in <Xs>` with `Local: http://localhost:3000`.
- [ ] `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/` prints `200`.
- [ ] (Optional, for LessonChat) `claude --version` resolves on `$PATH` AND `claude -p "say hi"` returns text within ~10s. If absent, LessonChat will respond with the documented 503 error string — see §4.5.
- [ ] (Optional, for cleanest start) wipe persisted state: `rm -f ~/.ai-lecturer/progress.json` and clear `localStorage` for `localhost:3000`.

Throughout this plan, "the app" = `http://localhost:3000`.

---

## 2. Test Courses to Generate

Generate **all three** before running the widget walkthroughs. The three are chosen so that — between them — every widget type, every duration tier, every level, and every theory/practice slider band is exercised.

The webapp does **not** run the agent chain. For each course you will:

1. Walk Stages 1–5 of the wizard (§3.2). Stage 5 writes `courses/<slug>/course-spec.json`.
2. From a separate terminal, invoke the `init_course` skill: `claude` → `/init_course <slug>` (US-027).
3. Run `./scripts/ralph/ralph.sh` to iterate the per-lesson stories (US-028).
4. Wait until ralph reports all stories `passes: true`. Course appears in the dashboard.

If you only have time to test the **app**, not generation, you can skip steps 2–4 and use the existing seed course `gauss-basics` (US-029) plus `pexp-test`, `cloze-test`, `dragmatch-test`, `datatable-test`, `video-test` already under `/courses/`. Mark such items as "tested against seed" in your report.

> **Canonical smoke-test target (US-064): `smoke-test`.** A static fixture under `/courses/smoke-test/` with one section per widget type across 4 lessons (Text & assessments → Python → Visualization → Data & media). Use it as the fastest "did rendering still work after my change?" pass — open the dashboard, navigate into each of the 4 lessons in order, and verify every section renders without console errors. The §3.4 widget walkthroughs each map to a section in this course; if a generated course has not been built yet, default to the smoke-test course for §3.4.

### 2.1 Course A — Short / narrow / mostly theory (US-024, US-042)

| Field | Value |
|---|---|
| Stage 1 topic prompt | `Bubble sort algorithm` |
| Level | **Beginner** |
| Duration | **Short (3–5 lessons)** |
| Theory ⇄ practice | slider ≈ 25 (label "Mostly theory") |
| Expected modules | 1–2 |
| Expected lessons | 3–5 total |
| Slug | `bubble-sort-algorithm` |
| Widgets exercised | Theory (heavy), Quiz (single), Image / inline-image, optionally PlotImage, Sources panel |

**Why this course:** smallest possible course → fastest end-to-end sanity check; theory-leaning slider verifies the agent emits readable prose with inline images (US-051) without forcing Code widgets on a non-Python topic.

### 2.2 Course B — Standard / mid-level / balanced (US-024, US-042)

| Field | Value |
|---|---|
| Stage 1 topic prompt | `Linear regression for machine learning` |
| Level | **Some experience** |
| Duration | **Standard (8–12)** |
| Theory ⇄ practice | slider ≈ 50 (label "Balanced") |
| Expected modules | 3–4 |
| Expected lessons | 8–12 total |
| Slug | `linear-regression-for-machine-learning` |
| Widgets exercised | Theory, Quiz (single + multi), Code (with peek + stop), Sandbox, PythonPlot, ParametricExplorer, DataTable, Histogram, Sources, Video |

**Why this course:** the most representative course shape. Balanced slider should produce a realistic theory/code mix; "Some experience" level should yield Quiz `multiSelect: true` items in addition to single-correct ones.

### 2.3 Course C — Comprehensive / advanced / mostly practice (US-024, US-042, US-043, US-044, US-045, US-047, US-049)

| Field | Value |
|---|---|
| Stage 1 topic prompt | `Computer vision: convolutions, edges, and Fourier transforms` |
| Level | **I know the basics** |
| Duration | **Comprehensive (40+)** |
| Theory ⇄ practice | slider ≈ 80 (label "Mostly practice") |
| Expected modules | 5–8 |
| Expected lessons | 40+ total |
| Slug | `computer-vision-convolutions-edges-and-fourier-transforms` |
| Widgets exercised | Theory, Code, CodeCloze, Demo (Gaussian), ParametricExplorer (live sliders), PythonPlot (live matplotlib), PlotImage (pre-rendered figures), DragMatch (term↔definition), DataTable, Image (Wikimedia figures), Video (3Blue1Brown / StatQuest links), Sources (lesson + section), Histogram |

**Why this course:** stress-tests every interactive widget AND the Pyodide pipeline (matplotlib lazy install, namespace sharing, worker stop, parametric debounce). Practice-heavy slider should bias the agent toward Code / CodeCloze / ParametricExplorer over Theory.

---

## 3. Walkthroughs

Each subsection is independent. Pick the seed course or one of the test courses generated above as the surface for each section. Some boxes refer to widgets that may only appear in Course C — those are flagged.

### 3.1 Dashboard (US-014, US-019, US-036)

- [ ] **Empty state.** With `~/.ai-lecturer/progress.json` deleted and no courses present, the dashboard shows the centered "Create your first course" card with **exactly 4** starter chips ("Linear algebra basics", "How transformers work", "Computer vision basics", "Bayesian statistics"). The grid and Continue-learning hero are **absent**.
- [ ] Click a starter chip → URL changes to `/create?topic=<chip-text-url-encoded>` and Stage 1 input is **pre-filled** with that text.
- [ ] **Populated state (≥1 course, none started).** Each card shows badge **"New"**, a 4 px progress bar at 0 % fill, and a 36 px round icon tinted with the course's `accentColor`.
- [ ] **In-progress state.** Open any lesson, then return to dashboard via the breadcrumb. Card badge updates to **"In progress · 1/N"** within ~1 s (refetch on focus). Progress bar fills proportionally.
- [ ] **Continue learning hero** (only when ≥1 course has `lastVisitedAt`). It shows the most-recently-visited course's lesson title (`--fs-2xl`, weight 600), and the **Resume** button routes to `/courses/<slug>/lessons/<lessonSlug>`. Clicking Resume lands on that exact lesson.
- [ ] **Search — substring (no prefix).** Type `gauss` (or any word in a course title). Non-matching cards hide; matching card stays. Type `xqzpdgarbage` → grid is replaced by a centered **"No courses match"** state.
- [ ] **Search — slug-prefix autocomplete.** Type `gauss-b` → dropdown suggests `gauss-basics:`. Click the suggestion → input becomes `gauss-basics:` with cursor focused after the colon.
- [ ] **Search — slug-prefix scoped result.** Type `gauss-basics: kernel` → result list under the input shows lesson titles with snippets (≤120 chars each) containing the word `kernel`. Click a result → navigates to that lesson.
- [ ] Empty input restores the full grid (no filtering, no result list).
- [ ] **+ Nowy kurs** primary button (top-right of content area) routes to `/create`.

### 3.2 Course Creation Wizard — Stages 1–5 (US-024, US-025, US-026, US-042)

Test against Course A (smallest scope) for speed; repeat for B and C only if specifically auditing wizard regressions.

#### Stage 1 — Topic

- [ ] Step indicator at top shows 5 circles. **Topic** is filled (active = `--accent`); the other 4 are outlined.
- [ ] Big text input has only an **underline border** (not a full box).
- [ ] Placeholder text **cycles through 4 examples every 3 s** (watch for ~10 s: it changes ≥2 times).
- [ ] **4 chip suggestions** below the input prefill the text on click ("Backpropagation", "Linear algebra for ML", "How GPT works", "Bayesian statistics").
- [ ] **Next** is disabled until input has **≥3 words**. After typing `bubble sort algorithm`, Next becomes enabled (border becomes accent).
- [ ] **Back** from Stage 1 with non-empty input shows a confirm dialog before returning to dashboard.

#### Stage 2 — Refinement

- [ ] Three radio cards for level (Beginner / Some experience / I know the basics) — exactly one selectable at a time.
- [ ] **Four** duration chips: `Short (3–5 lessons)`, `Standard (8–12)`, `Extensive (20–30)`, `Comprehensive (40+)` — confirms US-042 enum extension.
- [ ] Theory/practice slider goes 0 → 100; live label updates: 0–33 → "Mostly theory"; 34–66 → "Balanced"; 67–100 → "Mostly practice".
- [ ] Next is disabled until level + duration + slider are all set.

#### Stage 3 — Structure cascade

- [ ] 3-column layout: **Course | Modules | Lessons**.
- [ ] Click a module card → Column 3 updates to that module's lessons.
- [ ] Drag a module to reorder → its position in Column 2 changes; lessons follow.
- [ ] Inline rename: click a lesson title, edit, blur or Enter → new title persists when you click another module and back.
- [ ] **+** button at end of each list adds a new card; **trash** icon shows inline confirm before remove.
- [ ] For Comprehensive duration courses, Stage 3 seeds **≥5 modules** (US-042).
- [ ] Sticky bottom bar shows **Back** (ghost) | **Looks good — generate** (primary).

#### Stage 4 — Approval

- [ ] Read-only summary: course title + description, then per module the lesson list with descriptions + estimated minutes.
- [ ] Cost-estimate line reads `≈ X minutes to generate, Y lessons` (rough — `lessonCount × 3min`).
- [ ] Big primary **Generate course** button at bottom.

#### Stage 5 — Export

- [ ] Click **Generate course** → success card with confirmation `Course spec saved to /courses/<slug>/course-spec.json`.
- [ ] Open the file from terminal — it exists, validates against `CourseSpecSchema`, and the slug equals the slugified course title.
- [ ] Three monospace command blocks have **Copy** buttons (clicking copies to clipboard — paste in terminal to verify).
- [ ] **Back to dashboard** link returns to `/`.
- [ ] Re-running the wizard with the same course title → POST `/api/courses` returns **409**; UI prompts the user to pick a different title.

### 3.3 Lesson View — Layout & Navigation (US-015, US-016, US-017, US-018, US-019, US-021, US-031)

Use `gauss-basics/wprowadzenie-do-filtrowania` (or any populated lesson).

- [ ] Three-column grid: TOC (276 px) | content (max 760 px wide, centered) | tutor panel (0 px when closed).
- [ ] Top toolbar 52 px: breadcrumb left (`Course › Module › Lesson`, lesson name in `--text`), section progress pill `N/M` + 60 × 4 px segmented bar, vertical divider, theme toggle, `?` shortcuts, `⌘.` tutor.
- [ ] Bottom bar 56 px: Prev (left) / Mark complete (center) / Next (right). Prev disabled on first lesson, Next disabled on last.
- [ ] **TOC dots:** finished = solid `--success` green, started = solid `--accent`, not_started = hollow `--border-strong` ring. Open a fresh lesson → its dot flips to "started" within 1 s.
- [ ] **TOC collapse.** Click the chevron in TOC header → 180 ms width animation 276 → 52 px. Hover a status dot → tooltip with the lesson title appears. Reload the page → state persists (read from `localStorage['toc-collapsed']`).
- [ ] **Active lesson row** has `--accent-subtle` background + 2 px left accent stripe + label color `--accent-text` weight 600.
- [ ] **Mark complete.** Click the center button → it morphs into "Lesson completed" with a check icon. After **600 ms fade-out**, router pushes to next lesson. Returning to dashboard, the card badge has updated to "In progress · X/Y".
- [ ] **Auto-advance** does NOT fire when there is no next lesson (last lesson) — the button stays as "Lesson completed" with no navigation.
- [ ] **Keyboard shortcuts.** Press `?` → modal opens with backdrop blur. Modal lists groups Global / Lesson / Code editor / Chat composer. Press `Esc` → modal closes. (US-021)
- [ ] Press **`j`** → smooth scroll to next `#section-…`; **`k`** → scrolls to previous. Verify `window.scrollY` increases / decreases.
- [ ] Press **`⌘B`** (or `Ctrl+B`) → TOC toggles collapsed/expanded with 180 ms animation.
- [ ] Press **`⌘.`** → tutor panel slides in (320 px); pressing again slides it out. Confirm the toolbar `tutor-btn` shows `data-active="true"` while open (US-052).
- [ ] **Reset session.** Toolbar contains `[data-testid="reset-session-btn"]`; click it → toast `[data-testid="session-toast"]` appears within 500 ms. Pyodide lesson namespace is wiped (any subsequent Code section sees no leftover variables) — verified by typing `print(x)` in a Sandbox after Reset; output should be `NameError`.
- [ ] On lesson mount, `PATCH /api/progress` sets status to `'started'` only when previously `not_started`. Open a finished lesson → status stays `'finished'` (does NOT downgrade).
- [ ] **Section completion checkbox (US-065).** Each section header renders a checkbox (`[data-testid="section-complete-<id>"]`). Click it → wrapper gets `data-section-manually-completed="true"`, opacity drops to ~0.65, header title gets `text-decoration: line-through`, and the `Completed` badge appears. Toggling fires `PATCH /api/progress` with `manuallyCompletedSections: { [sectionId]: true }`; toggling off sends `false` and removes the entry from the persisted map. State survives reload. Existing per-lesson `status` is unaffected.

### 3.4 Widgets

For each widget, the boxes describe the **happy path** and the **pass criteria explicitly visible in the UI**. If a widget is not present in any of your generated courses, generate a tiny test lesson with that widget type or use the dedicated seed course (`pexp-test`, `cloze-test`, `dragmatch-test`, `datatable-test`, `video-test`).

#### 3.4.1 Theory (US-007, US-022, US-051)

- [ ] Markdown renders with KaTeX math (e.g. `$\sigma$` shows as σ glyph, not raw text).
- [ ] Callouts (info/warning/tip) render with the appropriate background tint and icon.
- [ ] Inline images (`![alt](url)`) render at the inline width with `alt` exposed in DOM (`page.$$eval('img', els => els.map(e => e.alt))`).
- [ ] Click the **pencil/Edit** icon in the Theory header → body swaps to a CodeMirror markdown editor seeded with the current text.
- [ ] **Write/Preview** segmented toggle works: Preview re-renders react-markdown + KaTeX live.
- [ ] **Save** (disabled if unchanged) → PUT lesson succeeds, view re-renders with new text. Reload → text persists on disk.
- [ ] **Cancel** reverts to original text without disk write.

#### 3.4.2 Quiz — single-select (US-008)

- [ ] Question text + options A/B/C/D rendered.
- [ ] Click the wrong option → button morphs to the **incorrect** state (red border + ✗ icon); explanation panel opens below with the explanation.
- [ ] Click the correct option → button morphs to **Submitted ✓** (green/`--success`); status badge in widget header flips to `data-status="done"`.
- [ ] PATCH `/api/progress` fires (check Network tab) with `sectionState: { [sectionId]: { done: true } }`.

#### 3.4.3 Quiz — multi-select (US-008)

- [ ] Header shows `Select all that apply` (or equivalent). Options become checkboxes (multi).
- [ ] Submit with a partially-correct selection → result shows incorrect; explanation reveals.
- [ ] Submit with all correct → green submitted state; status badge updates.

#### 3.4.4 Code Exercise (US-010, US-011, US-038, US-039)

- [ ] CodeMirror editor renders with Python syntax highlighting (keywords colored, strings green-ish, etc.).
- [ ] Type `print(2+2)` → click **▶ Run**. Output panel shows `4` within ~3 s on first Pyodide load (≤1 s subsequent).
- [ ] Click **Submit** with passing code → tests panel shows green checkmarks per test; widget status badge goes to `data-status="done"`. Submit button morphs to **Submitted ✓**.
- [ ] **Hidden tests.** Test bodies are hidden by default ("Tests hidden — will run on submit"); a small disclosure ("Show test names") only reveals names, not bodies (US-011 final decision).
- [ ] **Peek solution** button (`Peek solution` text). Click it → an inline read-only CodeMirror block expands **below** the test panel labeled "Reference solution". Code is **not** auto-injected into the editor. Button text flips to **Hide solution**. Click again → collapses.
- [ ] **Stop running code.** Type `while True: pass`. Click Run → button morphs to **Stop** with `--danger` styling. Click Stop → output shows a Callout (warning tone): `Session restarted — re-run previous cells if needed.`. Then run `print(1+1)` and confirm `2` appears within ~3 s without page reload.
- [ ] **Auto-timeout.** Run an infinite loop and wait. After ~30 s, output shows the Callout `Execution timed out after 30s. Session restarted.` (timeout variant of the same restart).
- [ ] **Reset code.** Click Reset → editor reverts to starter code; persisted user code is wiped (PATCH `/api/progress` with `sectionState: { [sectionId]: {} }`).

#### 3.4.5 Demo — Gaussian filter (US-012)

- [ ] Two side-by-side images (input | filtered) render.
- [ ] Sigma slider drag → filtered image updates; debounce ~150 ms (no lag past 200 ms).
- [ ] Sigma label below the slider matches the slider value within 0.1.
- [ ] Edit panel: `Edit` pencil icon → side panel with sigmaMin / sigmaMax / sigmaDefault number inputs + image src dropdown populated from `/public/demo-images/`. Save → widget re-renders with new defaults.

#### 3.4.6 Sandbox (US-013)

- [ ] Editor + Run + output panel; **no tests panel, no Submit button** (this is what distinguishes it from Code).
- [ ] Encouragement text renders above the editor.
- [ ] User code persists across page reloads (PATCH `/api/progress` with `userCode`); reload → editor re-seeds with the persisted text, not the starter.

#### 3.4.7 PlotImage (US-043)

- [ ] `<figure>` with `<img>` (max-width 100%, `--radius-md`, 1 px `--border`). Caption (if present) renders in `<figcaption>`.
- [ ] **Show source** disclosure → read-only CodeMirror block with the original Python (or R) syntax-highlighted using the same theme as the Code widget.
- [ ] Image src is served via `/api/courses/<slug>/assets/...`; check the response Content-Type matches the file extension (`image/png`, `image/svg+xml`, etc.).
- [ ] No `../` traversal: `curl http://localhost:3000/api/courses/<slug>/assets/../../etc/passwd` returns 400 (asserted by `assertSafeSlug`).

#### 3.4.8 PythonPlot (US-044)

- [ ] First load: click **Run** → ~3–10 s pause for `loadPackage('matplotlib')`. PNG appears within 10 s of first matplotlib install (subsequent runs are <2 s).
- [ ] Modify the code (`np.cos(x)` instead of `np.sin(x)`) → Run → new PNG visibly different from the first.
- [ ] On error path (e.g. typo), red error panel renders the Python traceback.
- [ ] If user code produces no figure, output panel renders the hint `No figure produced — did you call plt.show() or create a figure?`.
- [ ] Pyodide namespace shared with other Python widgets in the same lesson (verify by defining `x = 42` in a Sandbox above, then `print(x)` in this widget → outputs `42`).
- [ ] **NOTE:** PythonPlot was specced in US-044 but is **not currently wired** in `src/widgets/registry.ts` or `src/lib/schemas/lesson.ts` (verify with `grep -i pythonPlot src/widgets/registry.ts`). Mark as N/A if the widget type is missing — see §4.

#### 3.4.9 ParametricExplorer (US-045)

Use the seed course `pexp-test` if no generated course has it.

- [ ] Renders the param controls (slider / select / toggle) above an output area.
- [ ] Drag a slider → output (PNG plot or computed value or both, per `outputType`) updates within ~150 ms (the configured `debounceMs`).
- [ ] First slider drag triggers matplotlib install (~5–10 s pause if not already loaded).
- [ ] `setupCode` runs once per session — on second slider drag the recompute is fast (<500 ms even for non-trivial setups).
- [ ] Toggle a boolean param → output updates correspondingly.
- [ ] Numeric formatting is sensible (e.g. value-output displays `result = 0.123` not `0.12300000001`).

#### 3.4.10 CodeCloze (US-046)

Use the seed course `cloze-test` if no generated course has it.

- [ ] Template renders with **inline editable inputs** at each `{{slotId}}` position; surrounding code is read-only and syntax-highlighted.
- [ ] Type a wrong value into a slot → blur → input border turns **red** + slot's `hint` shows below the slot.
- [ ] Type the correct value → blur → border turns **green** + ✓ icon.
- [ ] When all slots are correct → `finalTests` run automatically; on pass, the section status badge flips to `data-status="done"`.
- [ ] Repeated wrong attempts on a single slot reveal progressive hints (after `revealAfterAttempts` is hit) — only when defined in the data.

#### 3.4.11 DragMatch (US-047)

Use the seed course `dragmatch-test` if no generated course has it.

- [ ] Item bank panel renders at top with draggable cards; zones below.
- [ ] Drag an item over a zone → zone background flashes `--accent-subtle` while hovered.
- [ ] Drop into a zone → item visually moves into the zone.
- [ ] Click **Submit**:
  - Correct zones: `--success-border` + `--success-subtle` background.
  - Wrong zones: `--danger-border` + `--danger-subtle` background.
  - Misplaced items show a subtle outline.
- [ ] Explanation Callout (neutral tone) renders below after submit, regardless of correctness.
- [ ] Rearrange to all-correct, Submit → status badge flips to `data-status="done"`; PATCH `/api/progress`.
- [ ] Keyboard accessibility: Tab to a draggable item — `aria-roledescription="draggable"` and `aria-pressed` are present (verify in DOM inspector).

#### 3.4.12 DataTable (US-048)

Use the seed course `datatable-test` if no generated course has it.

- [ ] Initial rows render in row-insertion order (or `initialSort` if set in data).
- [ ] Click a numeric column header → sort indicator chevron appears; rows reorder ascending. Second click → descending. Third click → back to insertion order.
- [ ] Filter input on a string column: type a substring → non-matching rows hidden; row count visibly drops.
- [ ] Filter on a numeric column: enter min=10, max=20 → only rows in range stay.
- [ ] Numeric values formatted with locale separators (e.g. `1,234.56` in en-US).
- [ ] Boolean values render as ✓ / —.
- [ ] If `rows.length > pageSize`, pagination controls appear: `Page 1 of N`, prev disabled, next enabled. Click next → page increments.
- [ ] Sticky header: when the table scrolls inside its container, the header stays at the top of the wrapper.

#### 3.4.13 Video (US-049)

Use the seed course `video-test` if no generated course has it.

- [ ] `kind: youtube` → renders a 16:9 `<iframe src='https://www.youtube-nocookie.com/embed/<id>?...'>` element.
- [ ] `startAt` (if set) appends `?start=<sec>` to the iframe src.
- [ ] `kind: mp4` → HTML5 `<video controls>` with the configured src loads and plays.
- [ ] Transcript panel (collapsible) renders below the video. Click a transcript segment → for MP4, `video.currentTime` jumps to the segment's `tStart`.
- [ ] As the video plays, the active transcript segment highlights with `--accent-subtle` bg.
- [ ] Speaker labels (if present) render as small uppercase prefix.

#### 3.4.14 Image (US-050)

- [ ] `<figure>` with `<img>` (max-width per `maxWidth` field, default 100%) and optional `<figcaption>` containing caption + attribution (linked if `attribution.url`).
- [ ] **Local cache.** After lesson save, image src has been rewritten from the original URL to `/api/courses/<slug>/assets/images/<sha256-prefix>.<ext>`. The file exists on disk under `courses/<slug>/assets/images/`.
- [ ] Caching is idempotent: re-saving the same lesson does not duplicate the file (filename is hash-based).
- [ ] Failed external fetch on save: response includes a `warning` field; image src remains the original URL (graceful degradation).
- [ ] **NOTE:** Image was specced in US-050 but is **not currently wired** in `src/widgets/registry.ts` or `src/lib/schemas/lesson.ts` (verify with `grep -i "image:" src/widgets/registry.ts`). Mark as N/A if the widget type is missing — see §4.

#### 3.4.15 Histogram (US-030)

- [ ] Renders a bar chart with the configured bin counts.
- [ ] Tooltip / hover state shows the bin range + count.
- [ ] Used as the canonical reference implementation for "Adding a new widget = 5 wiring points" (see `src/widgets/README.md`).

### 3.5 LessonChat — AI Tutor (US-052, US-053, US-054, US-055)

Requires Claude CLI on `$PATH` (`claude --version` must succeed).

- [ ] **Open / close.** Press `⌘.` (or click the `tutor-btn` in the toolbar) → panel slides in from the right (320 px wide, 180 ms grid-template-columns transition). Toolbar button is `data-active="true"` while open. Press `⌘.` again or click the X in the panel header → closes; toolbar button `data-active="false"`. State persists to `localStorage['lessonChat-open']`.
- [ ] **Empty state.** Closed panel re-opened on a fresh lesson shows the empty-state placeholder (no message bubbles).
- [ ] **Compose.** Type a multi-line message in the textarea. Plain Enter inserts a newline (textarea grows to max 6 lines). `⌘+Enter` sends. Send button is **disabled when textarea is empty/whitespace-only**.
- [ ] **Draft persistence.** Type `draft test 123` (do **not** send), reload page (browser refresh) — textarea still contains `draft test 123`. Persisted under `localStorage['lessonChatDraft:<courseSlug>:<lessonSlug>']`.
- [ ] Different lessons keep separate drafts: navigate to another lesson, type something else, return → the original draft is preserved.
- [ ] **Send a question.** With a real `claude` CLI, type `What is this lesson about?` → click Send → user bubble appears, then a typing-dots placeholder bubble, then **streamed tokens** progressively fill the assistant bubble (text grows visibly as tokens arrive, US-055).
- [ ] **Stop mid-stream.** Send a longer question (`Explain in detail with examples`). When tokens start streaming, click **Stop** (button is enabled while `sending`). The assistant bubble freezes mid-paragraph; `data-stopped="true"`; the partial text is kept; an italic suffix `— stopped by user` renders on its own line in `--text-tertiary`. Stop button becomes disabled after end-of-stream.
- [ ] After Stop, send a follow-up question → it streams normally (no leftover state poisons the next request).
- [ ] **Section context.** Scroll the lesson so a Quiz section reaches the top of the viewport. Send "What is this question testing?" → the assistant's reply must reference the **specific quiz topic** of that section (not the lesson at large). Verify by inspecting the network POST body — `sectionId` should match the active section's `data-section-id`.
- [ ] **No CLI fallback.** With `claude` not on `$PATH`, send a question → a **red error bubble** renders with the exact text `AI Tutor unavailable: install Claude Code CLI or sign in to Claude Max.` (US-053 503 path).

### 3.6 Theme (US-002, US-020)

- [ ] Dashboard header shows the `<ThemeToggle>` icon button (28 px). In light mode it shows the **moon** icon; in dark mode it shows the **sun**.
- [ ] Click → `<html data-theme>` flips between `light` / `dark`. All CSS vars retint (background, surface, accents) within the same frame.
- [ ] Toggle inside the lesson toolbar (between section pill and `?` shortcuts) does the same.
- [ ] Reload page → theme **persists** (read from `localStorage['theme']`). No FOUC: the inline blocking `<head>` script applies the attribute before React hydrates.
- [ ] First load with no `localStorage['theme']` set: respects `prefers-color-scheme: dark` system setting (verify with browser dark-mode emulation).

### 3.7 Sources / Citations Panel (US-040, US-041)

- [ ] **Lesson-level sources.** Below the last section, above the bottom bar, a collapsible `Źródła / Sources` panel renders a list of cards for `lesson.sources[]`. Per-card: kind icon (paper=FileText, video=Video, article=Newspaper, book=BookOpen) + title + author/year inline + url in `--text-tertiary`.
- [ ] Click a source card → opens the URL in a new tab (`target="_blank" rel="noopener noreferrer"` — verify in DOM inspector).
- [ ] **Section-level sources.** A section that has `sources[]` set shows a small **Link icon** (16 px lucide) in its header next to the status badge.
- [ ] Click the Link icon → popover opens listing that section's sources only.
- [ ] If a section has no sources, the link icon is **absent** (not greyed — absent).
- [ ] Seed course `gauss-basics` Lesson 2 has ≥3 lesson-level sources (verify by opening it).

### 3.8 schemaVersion in JSON (US-037)

- [ ] Open `courses/gauss-basics/course.json` → top-level `schemaVersion: 1` field exists.
- [ ] Open any lesson JSON in `courses/gauss-basics/lessons/` → top-level `schemaVersion: 1` field exists.
- [ ] Generated JSON Schema files include the field: `grep schemaVersion src/widgets/schemas/course.json src/widgets/schemas/lesson.json` returns hits.
- [ ] Parse smoke: a lesson JSON without `schemaVersion` still parses (defaults to 1). Run `node -e "const z = require('./src/lib/schemas/lesson.ts')"` — actually, for the manual reviewer it's enough to verify the seed file has the field and the unit tests pass (see §1).

### 3.9 Header Chrome — Logo & Avatar (US-034, US-035)

- [ ] **Logo navigates home.** From any lesson view, click the AI Lecturer logo in the top-left → navigates to `/` (dashboard).
- [ ] Logo is visible in **both** the dashboard header AND the lesson toolbar (not just one).
- [ ] **Avatar dropdown.** Click the avatar (top-right of dashboard header AND lesson toolbar) → dropdown opens with at least a **My courses** link.
- [ ] Click **My courses** from inside a lesson → navigates to `/`.
- [ ] Click the avatar again, or click outside the dropdown → it closes.

---

## 4. Known Limitations (out of MVP)

These are **expected** behaviors of the current build — failures here are not bugs.

1. **Single-user, no auth.** The avatar dropdown is decorative; there is no login, no per-user data isolation. All progress is stored in a single file at `~/.ai-lecturer/progress.json`.
2. **File-based persistence — no IndexedDB.** Despite the design folder mocks (`claude/design/source/`) referencing IndexedDB, the MVP uses local files: courses in `/courses/<slug>/`, progress in `~/.ai-lecturer/progress.json`. The webapp does not use any client-side database.
3. **Course generation runs offline via ralph CLI — not in-app.** Stage 5 only writes `course-spec.json`. The webapp does NOT spawn the `init_course` skill or `ralph.sh`. The reviewer must run those manually from a separate terminal. Do not look for an in-app "generate now" progress bar — there isn't one.
4. **LessonChat requires Claude Code CLI installed locally.** Without `claude` on `$PATH`, the panel returns the documented 503 error string `AI Tutor unavailable: install Claude Code CLI or sign in to Claude Max.`. This is the documented graceful-degradation path; do not file as a bug unless the error string differs.
5. **LessonChat does not stream multi-message conversations cleanly across page reloads.** Message history is local-only to the panel; reloading the page loses the conversation (but preserves the textarea draft). Out of MVP per US-052/053 scope.
6. **PythonPlot widget (US-044) and Image widget (US-050) may not be wired in the registry.** Per `scripts/ralph/progress.txt` (US-051 learnings), US-050 was marked `passes: true` in `prd.json` but the actual widget code, schema, and registry entry are not in the repo. Same suspicion applies to US-044. Verify with:
   ```bash
   grep -E "pythonPlot|image:" src/widgets/registry.ts
   ```
   If absent, the §3.4.8 (PythonPlot) and §3.4.14 (Image) sections are N/A for this build.
7. **Pyodide does not support cooperative interrupt.** The Stop button (US-039) terminates the worker outright and re-creates it; the lesson Python namespace is wiped. Subsequent widget runs in the same lesson will need to re-run any previously-defined helpers. The `Session restarted — re-run previous cells if needed.` Callout makes this explicit.
8. **Wizard draft is in-memory only.** Refreshing the page during the wizard resets the draft. Persistence is intentionally scoped to Stage 5's `course-spec.json` write.
9. **Search index is built at dashboard mount.** Editing a lesson's theory content via the in-place editor does NOT update the live search index until the dashboard is re-mounted (navigate away and back, or refresh).
10. **Quiz/Code/Demo/Sandbox widget data is excluded from search** (US-036 explicit decision). Only title + description + theory markdown is indexed.
11. **Polish accent-stripping in search is not required** — `Łódź` and `Lodz` are different substrings to the index.
12. **Light-mode is the default** for first-time visitors without a system preference; subsequent loads honor the manual toggle choice.
13. **The agent log / live agent terminal seen in design mocks is out of scope.** No agent-runner UI exists in the webapp; agent runs happen via `ralph.sh` in a terminal.
14. **`schemaVersion` is a forward-compat marker only** (US-037). No migration logic exists in MVP — bumping it later requires a follow-up migration story.

---

## 5. Sign-off

- [ ] All §3 boxes either ticked or marked **N/A — known limitation §4.<n>**.
- [ ] No console errors of `level >= 'warning'` in the browser DevTools console for any walkthrough section.
- [ ] No new `git status` artifacts (e.g. `.temp-execution-*.js` from a stray playwright run).
- [ ] `npm run typecheck` still exits 0 after the test session.
