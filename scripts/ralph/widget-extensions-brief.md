# Widget Extensions Brief

**Cel dokumentu:** Brief dla agenta, który wygeneruje user stories (US‑031, US‑032, …) i dopisze je do `scripts/ralph/prd.json`. Jeden widget = jedna user story; zmiana runtime'u Pyodide = osobna user story z najwyższym priorytetem (musi być zrealizowana przed widgetami zależnymi od matplotlib).

---

## 1. Konwencje projektu, których agent MUSI przestrzegać

### 1.1 Numeracja i metadane US

- Ostatnia istniejąca story: **US‑030** (Custom widget extensibility — README + Histogram example). Nowe stories: **US‑031** w górę.
- `branchName` per story: `ralph/us-NNN`.
- Tag `"ui"` na każdej story dotykającej widoku w przeglądarce — wymusza playwright‑skill verification (per `scripts/ralph/CLAUDE.md`).
- Pola: `id`, `title`, `description` (As X, I want Y so Z), `acceptanceCriteria[]`, `priority` (rosnące, kontynuuj numerację po 30), `passes: false`, `notes: ""`, `tags`.
- Tytuł US w angielskim (zgodnie z istniejącym stylem prd.json), AC w angielskim, opisy mogą wzmiankować kontekst PL gdzie potrzeba.
- Polish content w seed‑courses pozostaje — nie tłumaczyć.

### 1.2 Wzorzec dodania nowego widgetu (5 punktów wiring)

Cytat z `src/widgets/README.md` — KAŻDA story dodająca widget MUSI pokryć wszystkie 5:

1. **CSS var** `--widget-<name>` w **obu** blokach (light + dark) `src/styles/tokens.css`
2. **Zod data schema** w `src/widgets/<Name>/schema.ts` + rejestracja w `src/widgets/schemas/build.ts`; `npm run build:schemas` emituje `<name>.json`
3. **Registry entry** w `src/widgets/registry.ts` (component / label / icon / accentVar) + rozszerzenie unii `WidgetType`
4. **`<Name>Editor.tsx`** wg wzorca US‑023 + import + branch w `WidgetEditPanel` i `SectionRenderer` w [src/app/courses/[slug]/lessons/[lessonSlug]/page.tsx](../../src/app/courses/[slug]/lessons/[lessonSlug]/page.tsx)
5. **Section variant** w `SectionSchema` discriminated union w `src/lib/schemas/lesson.ts` (pominięcie tego = lesson JSON nie waliduje)

Histogram (US‑030) jest referencyjną implementacją.

### 1.3 Standardowe AC dla każdej story typu „nowy widget"

Każda widget‑story zawiera w AC (skopiuj i dostosuj):

- "Zod schema in `src/widgets/<Name>/schema.ts` defines all required fields"
- "JSON Schema regenerates via `npm run build:schemas` and is committed to `src/widgets/schemas/<name>.json`"
- "Registry entry added in `src/widgets/registry.ts`; `WidgetType` union extended"
- "`<Name>SectionSchema` variant added to `SectionSchema` discriminated union in `src/lib/schemas/lesson.ts`"
- "`--widget-<name>` CSS var defined in both `:root[data-theme='light']` and `:root[data-theme='dark']` blocks of `src/styles/tokens.css`"
- "`<Name>Editor.tsx` follows US‑023 pattern; wired into `WidgetEditPanel` and `SectionRenderer` in lesson page"
- "Sample data file `src/widgets/<Name>/sample.ts` exports a minimal valid instance"
- "Vitest unit tests cover: schema parses minimal valid object, rejects missing required field"
- "Browser verification (playwright‑skill): widget renders in lesson view with correct accent color in light + dark themes"
- "Typecheck passes"
- "Tests pass"

Pozostałe AC są specyficzne per widget — patrz sekcja 4.

### 1.4 Persystencja

Per‑section state widgetów oceniających zapisywany do `~/.ai-lecturer/progress.json` przez `PATCH /api/progress` z body `{ courseSlug, lessonSlug, sectionState: { [sectionId]: {...} } }`. Pole `done?: boolean` per sekcja flaguje zaliczenie. Patrz pattern w [progress.txt](progress.txt) — sekcja Codebase Patterns.

### 1.5 Pyodide Worker

- Singleton w [src/lib/pyodide/client.ts](../../src/lib/pyodide/client.ts), worker w [src/lib/pyodide/worker.ts](../../src/lib/pyodide/worker.ts)
- Typowane wiadomości: `'run' | 'runWithTests' | 'gaussFilter'`. Nowe widgety dodają nowe typy (`'runWithPlot'`, `'runWithPlotParam'`, `'resetNamespace'` — szczegóły w US‑031)
- Pakiety preinstalowane: numpy, scipy. Pakiety on‑demand przez `pyodide.loadPackage(...)` z singleton flag (wzorzec `gaussInstalled`).

---

## 2. Globalna zmiana runtime'u — Shared Python Session w lekcji

**To OSOBNA user story (proponowane US‑031), priorytet wyższy niż widgety zależne od Pythona (PythonPlot, ParametricExplorer, CodeCloze).** Bez tej zmiany niektóre widgety nie działają tak, jak się od nich oczekuje.

### Kontekst

Dziś Pyodide Worker trzyma jeden globalny namespace; nigdy nie jest czyszczony. Konsekwencja: między lekcjami pozostaje stan poprzedniej (kontaminacja), ale w obrębie jednej lekcji wszystkie Code/Sandbox widgety i tak dzielą namespace. Decyzja produktowa: **w obrębie lekcji shared session JEST POŻĄDANA** (flow Jupyter‑like), **między lekcjami namespace się resetuje**.

### Specyfikacja zmiany

- Worker przechowuje per‑lesson namespace dict; trzyma `currentLessonSlug`
- Każdy run widgetu Pythonowego (`Code`, `Sandbox`, `PythonPlot`, `ParametricExplorer`) wykonuje `exec(code, globals=lessonGlobals)` — definicje funkcji, importy, zmienne persistują przez całą lekcję
- Klient (lesson page) wywołuje `worker.resetNamespace(lessonSlug)` na lesson mount; worker resetuje gdy `lessonSlug !== currentLessonSlug`
- Przycisk **„Reset session"** w lesson toolbar — manual wipe namespace bez zmiany lekcji
- **Test isolation:** w `runWithTests` testy wykonują się w *kopii* namespace (`dict(lessonGlobals)`), nie w referencji. Już częściowo zaimplementowane w runnerze Pythona — utrzymać i zweryfikować testem.
- **Optional schema flag** w `LessonSchema`: `pythonSession?: 'shared' | 'isolated'`, default `'shared'`. Furtka dla rzadkich kursów wymagających izolacji.

### AC dla US‑031 (propozycja)

- "Pyodide Worker maintains per‑lesson namespace dict keyed on `lessonSlug`"
- "New worker message type `'resetNamespace'` clears namespace and stores new `lessonSlug`"
- "Client hook `usePyodide()` exposes `resetNamespace(lessonSlug)` and is called by lesson page on mount"
- "All Python‑executing widgets (Code, Sandbox, PythonPlot, ParametricExplorer) share the same namespace within a lesson"
- "Test runner in Code widget executes each test against `dict(lessonGlobals)` copy, NOT the reference (verify by test that defines a global in lesson, then ensures graded test cannot see it unless explicitly imported)"
- "Lesson toolbar exposes 'Reset session' button that triggers namespace clear without lesson navigation"
- "Optional `pythonSession: 'shared' | 'isolated'` field in LessonSchema, default `'shared'`"
- "Vitest unit tests cover: namespace persists across runs in same lesson; namespace clears on lesson change; test runner isolation"
- "Playwright verification: define `helper()` in Code widget, call from later Sandbox cell — succeeds; navigate to other lesson and back — call fails (namespace cleared)"
- "Typecheck passes; tests pass"
- Tagi: `["ui"]`

---

## 3. Lista widgetów do user stories

11 widgetów w 4 kategoriach. Każdy → osobna user story. Pole `Priority` poniżej **mapuje na sprint**, nie wprost na pole `priority` w prd.json (tam kontynuuj numerację rosnąco po istniejących).

### Sprint 1 — fundament wykresów

#### 3.1 PlotImage  `Sprint 1`  `S`

- **Use‑case:** statyczny wykres pre‑renderowany przez matplotlib w build‑time (ralph). Lekcja niesie tylko ścieżkę do PNG.
- **Schema (`src/widgets/PlotImage/schema.ts`):**
  ```ts
  PlotImageData = {
    src: string,                 // ścieżka do PNG (z assets/)
    alt: string,                 // wymagane (a11y)
    caption?: string,
    sourceCode?: string,         // collapsible „pokaż kod"
    sourceLanguage?: 'python' | 'r'
  }
  ```
- **Asset convention:** `courses/<slug>/assets/plots/<lesson-slug>-<n>.png`. Należy dodać API route `GET /api/courses/[slug]/assets/[...path]` (atomic, ścieżki sanitizowane jak w `assertSafeSlug`).
- **AC specyficzne:**
  - "Asset API route `GET /api/courses/[slug]/assets/[...path]` serves files from `courses/<slug>/assets/`; rejects path traversal"
  - "Widget renders `<img>` with mandatory `alt`; caption rendered as `<figcaption>` if present"
  - "Collapsible 'Show source' section uses read‑only CodeMirror with same theme as Code widget"
  - "Editor allows uploading new PNG (writes to assets dir via API) OR pasting URL"
- **Tagi:** `["ui"]`

#### 3.2 PythonPlot  `Sprint 1`  `M` — **zależy od US‑031 (shared session)**

- **Use‑case:** live wykres jako output Code‑like widgetu. Student modyfikuje kod, wykres się przerysowuje.
- **Schema (`src/widgets/PythonPlot/schema.ts`):**
  ```ts
  PythonPlotData = {
    taskMarkdown?: string,
    starterCode: string,
    expectedFigures?: number,    // ile fig oczekiwanych (domyślnie 1)
    height?: number              // canvas height px
  }
  ```
- **Worker:**
  - Nowy typ message `'runWithPlot'` zwraca `{ pngBase64, stdout, error, figureCount }`
  - Pierwszy run waitsfor `pyodide.loadPackage('matplotlib')` — singleton flag `matplotlibInstalled` analogicznie do `gaussInstalled`
  - Code injectowany jest opakowany: `matplotlib.use('AGG')` + przechwycenie `plt.gcf().savefig(buf, format='png', dpi=110, bbox_inches='tight')` + `plt.close('all')` po
- **AC specyficzne:**
  - "First load: matplotlib installs lazily; subsequent loads skip install (singleton flag)"
  - "Output panel renders `<img src='data:image/png;base64,...'>`; loading state visible while running"
  - "Error path: Python error renders in red panel as in Code widget; figureCount=0 renders 'No figure produced' hint"
  - "Shares Pyodide namespace with other Python widgets in same lesson (depends on US‑031)"
- **Tagi:** `["ui"]`

### Sprint 2 — interakcja parametryczna i niski próg wejścia

#### 3.3 ParametricExplorer  `Sprint 2`  `M` — **zależy od US‑031 i PythonPlot**

- **Use‑case:** generalizacja obecnego `Demo`. Slidery/select/toggle wstrzykiwane jako globale Pythona → `renderCode` exec → plot/value.
- **Schema (`src/widgets/ParametricExplorer/schema.ts`):**
  ```ts
  ParametricExplorerData = {
    setupCode: string,           // raz, do shared namespace lekcji
    renderCode: string,          // per slider change, w lokalnym scope czytającym z shared
    params: Array<{
      name: string,              // wstrzykiwany jako var Python
      label: string,
      type: 'slider' | 'select' | 'toggle',
      min?: number, max?: number, step?: number,
      default: number | string | boolean,
      options?: Array<{label: string, value: string | number}>
    }>,
    outputType: 'plot' | 'value' | 'both',
    debounceMs?: number          // domyślnie 150
  }
  ```
- **Migracja:** istniejący `Demo` widget zostaje, ale można go traktować jako preset `parametricExplorer` z hardkodowanym setupCode dla gauss. Nie blokować istniejącego seed course `gauss-basics`.
- **AC specyficzne:**
  - "Worker exposes message type `'runWithPlotParam'` accepting `{ setupCode, renderCode, params: {[name]: value} }`"
  - "setupCode runs once per lesson session (cached via hash); renderCode runs on every param change"
  - "Slider input uses native setter override pattern (per progress.txt patterns) — verified by playwright"
  - "Debounce 150ms by default; configurable per widget"
- **Tagi:** `["ui"]`

#### 3.4 CodeCloze  `Sprint 2`  `S` — **zależy od US‑031 (test isolation)**

- **Use‑case:** pre‑written code z `___` slotami, niski próg składniowy.
- **Schema (`src/widgets/CodeCloze/schema.ts`):**
  ```ts
  CodeClozeData = {
    taskMarkdown?: string,
    template: string,            // kod z {{slot1}}, {{slot2}} placeholderami
    slots: Array<{
      id: string,                // matches {{id}}
      hint?: string,
      validation:
        | { kind: 'exact', value: string }
        | { kind: 'regex', pattern: string }
        | { kind: 'oneOf', values: string[] }
    }>,
    finalTests?: Array<{ name: string, body: string, hidden?: boolean }>,  // po zaliczeniu wszystkich slotów
    hints?: Array<{ revealAfterAttempts: number, markdown: string }>
  }
  ```
- **AC specyficzne:**
  - "Each `{{slotId}}` in template renders as inline editable input"
  - "Per‑slot validation runs on blur; correct → green border, incorrect → red border + slot hint"
  - "All slots correct → finalTests run in copy of lesson namespace (test isolation per US‑031); pass → section marked done"
  - "Hints reveal progressively after N failed attempts per slot"
- **Tagi:** `["ui"]`

### Sprint 3 — content i interakcja

#### 3.5 DragMatch  `Sprint 3`  `S`

- **Use‑case:** drag boxes → zones. Generalizuje term↔definition, kategoria↔przykład, label↔diagram.
- **Schema (`src/widgets/DragMatch/schema.ts`):**
  ```ts
  DragMatchData = {
    prompt: string,
    items: Array<{ id: string, label: string }>,        // do przeciągnięcia
    zones: Array<{ id: string, label: string, accepts: string[] }>,  // accepts = item.id[]
    multipleItemsPerZone?: boolean,                     // default false
    explanation?: string                                // shown after submit
  }
  ```
- **Dependency:** dnd‑kit (`@dnd-kit/core` + `@dnd-kit/sortable`)
- **AC specyficzne:**
  - "Items draggable from item bank; zones are valid drop targets"
  - "Submit button validates: each zone contains exactly the items in `accepts` (multipleItemsPerZone respected)"
  - "Visual feedback: correct zones green, wrong red, item highlights its expected zone"
  - "Explanation always shown after submit (per project pattern from Quiz widget)"
  - "Keyboard accessibility (dnd‑kit's keyboard sensors enabled)"
- **Tagi:** `["ui"]`

#### 3.6 DataTable  `Sprint 3`  `S`

- **Use‑case:** sortable/filterable tabela. Dwa źródła: statyczne JSON albo output z Code/PythonPlot (DataFrame → JSON).
- **Schema (`src/widgets/DataTable/schema.ts`):**
  ```ts
  DataTableData = {
    columns: Array<{
      key: string,
      label: string,
      type?: 'string' | 'number' | 'boolean',
      sortable?: boolean,        // default true
      filterable?: boolean       // default false
    }>,
    rows: Array<Record<string, string | number | boolean | null>>,
    initialSort?: { key: string, dir: 'asc' | 'desc' },
    pageSize?: number            // default 25
  }
  ```
- **AC specyficzne:**
  - "Click column header → sort ascending; second click → descending; third click → unsorted"
  - "Filter input per filterable column (text contains for string, range for number)"
  - "Pagination if rows.length > pageSize"
  - "Numeric formatting follows locale (`toLocaleString`)"
- **Tagi:** `["ui"]`

#### 3.7 Video  `Sprint 3`  `S`

- **Use‑case:** embed YouTube/MP4 z opcjonalnym klikalnym transkryptem. Wartościowe materiały zewnętrzne (3Blue1Brown, StatQuest) jako uzupełnienie lekcji.
- **Schema (`src/widgets/Video/schema.ts`):**
  ```ts
  VideoData = {
    kind: 'youtube' | 'mp4',
    src: string,                 // YT: video ID lub URL; MP4: ścieżka lub URL
    title?: string,
    durationSeconds?: number,
    transcript?: Array<{
      tStart: number,            // sekundy
      tEnd?: number,
      text: string,
      speaker?: string
    }>,
    autoplay?: boolean,          // default false
    startAt?: number             // sekundy
  }
  ```
- **AC specyficzne:**
  - "YouTube: embed via `<iframe>` privacy‑enhanced (`youtube-nocookie.com`)"
  - "MP4: HTML5 `<video controls>`; supports MP4 hosted in `courses/<slug>/assets/`"
  - "Transcript panel (collapsible) renders below video; click on segment seeks player to `tStart`"
  - "Active transcript segment highlights as player progresses"
  - "Speaker labels rendered if present"
- **Tagi:** `["ui"]`

### Backlog (nie generować US automatycznie — eskalować do użytkownika)

#### 3.8 Diagram (Mermaid)  `Backlog`  `S`
Render diagramów Mermaid (flowchart, sequence, ER, architektura). Dep: biblioteka `mermaid`.

#### 3.9 AlgoVisualizer  `Backlog`  `L`
Step‑by‑step animacja algorytmu na array/tree/graph. Data‑driven — lesson author definiuje listę snapshotów stanu. Złożoność: trzeba ustalić format snapshotów wystarczająco ogólny dla array/tree/graph.

#### 3.10 Hotspot  `Backlog`  `S`
Klikalne regiony (poly/rect) na obrazie. „Kliknij encoder w schemacie transformer". Format: image src + lista regionów z label + correct flag.

#### 3.11 TerminalSim  `Backlog`  `M`
Symulowany shell (git, bash, docker). Wymaga modelu stanu + transitions per komenda. Najwyższa złożoność z backlogu — warto zaplanować dopiero gdy konkretny kurs jej wymaga.

---

## 4. Sugerowana sekwencja w prd.json

| US | Tytuł (proponowany) | Priorytet | Tag |
|---|---|---|---|
| US‑031 | Pyodide shared lesson session + namespace reset between lessons | 31 | `["ui"]` |
| US‑032 | New widget — PlotImage (static matplotlib output + asset API) | 32 | `["ui"]` |
| US‑033 | New widget — PythonPlot (live matplotlib in Pyodide) | 33 | `["ui"]` |
| US‑034 | New widget — ParametricExplorer (generalizes Demo) | 34 | `["ui"]` |
| US‑035 | New widget — CodeCloze (fill‑in‑the‑blanks) | 35 | `["ui"]` |
| US‑036 | New widget — DragMatch (drag items to zones) | 36 | `["ui"]` |
| US‑037 | New widget — DataTable (sortable, filterable) | 37 | `["ui"]` |
| US‑038 | New widget — Video (YT/MP4 with clickable transcript) | 38 | `["ui"]` |

8 stories w sumie. Backlog (Diagram / AlgoVisualizer / Hotspot / TerminalSim) **nie dodawać** automatycznie — eskalować do użytkownika z prośbą o decyzję.

---

## 5. Instrukcje końcowe dla agenta

1. Wczytaj aktualny `scripts/ralph/prd.json` i potwierdź ostatnie istniejące story (powinno być US‑030).
2. Dla każdego punktu z sekcji 4: wygeneruj pełną user story (description, acceptanceCriteria, priority, passes:false, notes:"", tags:["ui"]) zgodnie z konwencjami sekcji 1.
3. Włącz wszystkie standardowe AC z sekcji 1.3 + AC specyficzne z sekcji 3.
4. Uruchom skill `prd_append` LUB ręcznie zmodyfikuj prd.json (atomic write — temp file + rename).
5. **Nie commituj** prd.json — to plik local‑only (per `.gitignore` i memory project_prd_not_tracked).
6. Backlog (sekcja 3, podsekcja „Backlog") — wypisz tytuły w komentarzu na końcu pracy, ale ich nie dodawaj.
7. Sprawdź zależności: PythonPlot, ParametricExplorer i CodeCloze wymagają US‑031 (shared session). W ich `notes` pole umieść `"depends on US-031"`.

Po zakończeniu: zwróć podsumowanie (8 dodanych US, ich numery, gdzie szukać szczegółów) i zaproponuj uruchomienie ralph loop dla US‑031 jako pierwszej.
