# gemini-polish

Samodzielne narzędzie do **polerowania języka polskiego** w wygenerowanym
kursie AI Lecturer przy pomocy Gemini. Poprawia wyłącznie gramatykę, styl i
płynność prozy, którą czyta uczeń — **nigdy** sens, fakty, liczby, matematykę,
kod ani obrazki. Czyta `courses/<slug>` w trybie read-only; pliki lekcji
zapisuje tylko krok `apply` (zawsze z backupem `<lesson>.json.bak`).

## Po co to jest

Prozę z generatora warto przepuścić przez drugi model językowy, ale LLM-y
chętnie „poprawiają" przy okazji wzory, kod i fakty. To narzędzie czyni to
fizycznie niemożliwym:

- **Maskowanie** — przed wysłaniem każdy chroniony fragment (`$…$`, `$$…$$`,
  `` `kod` ``, ```` ``` ````-bloki, `![alt](url)`, `[tekst](url)`, gołe URL-e,
  numery rysunków `Rys. N`) jest podmieniany na nieprzezroczysty placeholder
  `⟦N⟧`. Gemini widzi tylko prozę + placeholdery.
- **Brama bajtowa** — przy aplikacji placeholdery wracają bajt-w-bajt; zgubiony
  lub zmieniony chroniony token ⇒ pole **odrzucone** (zostaje oryginał).
- **Guard „stale"** — pole, którego tekst w lekcji zmienił się po exporcie
  (np. ręczna poprawka merytoryczna), nigdy nie zostanie nadpisane.
- **Schemat** — każda lekcja przed zapisem przechodzi walidację `LessonSchema`.
- Podejrzane błędy merytoryczne Gemini **flaguje** w `concerns`, nie poprawia.

## Workflow

### Krok 0 — przygotowanie (zawsze, jedna komenda)

```bash
cd tools/gemini-polish
npm run export -- <course-slug>
```

Tworzy `out/<slug>/` z batchami: `NNN.prompt.md` (gotowy prompt),
`NNN.map.json` (sidecar dla apply — nie ruszać), `NNN.result.json` (pusty stub
`[]` — **tutaj** wkleisz odpowiedź Gemini), `MANIFEST.md` (spis).
To jest podstawa zarówno pracy automatycznej, jak i ręcznej.
Ponowny export **odmówi** skasowania folderu tylko wtedy, gdy są w nim już
**wypełnione** `NNN.result.json` (puste stuby `[]` nie blokują — są nadpisywane;
`--fresh` wymusza czysty start).

### Ścieżka A — automatycznie przez API (Gemini CLI)

```bash
npm run run -- <course-slug>
```

Przerabia zaległe batche **po kolei** i od razu aplikuje wyniki. Wbudowane:

- **auto-resume** — postępem są pliki `NNN.result.json`; przerwany run po
  prostu uruchamiasz ponownie i kontynuuje od ostatniego ukończonego batcha
  (puste/zepsute resulty też liczą się jako zaległe);
- **ochrona przed paleniem tokenów** — domyślnie tani `gemini-2.5-flash-lite`
  bez „thinking" (`--model auto` przywraca routing CLI — drogo!), twardy limit
  wywołań na run (`--max-calls`, domyślnie 120, łącznie z retry), natychmiastowy
  stop na quota/rate-limit, stop po 3 nieparsowalnych batchach z rzędu
  (problem systemowy — nie płacimy za kolejne porażki), timeout per call
  z ubiciem całej grupy procesów.

Wymaga zalogowanego Gemini CLI (najlepiej OAuth — „Login with Google").

### Ścieżka B — ręcznie przez Gemini web (za darmo)

1. Otwórz `out/<slug>/MANIFEST.md` — lista batchy.
2. Dla każdego `NNN.prompt.md`: wklej **cały plik** do Gemini (web/AI Studio),
   a odpowiedź (tablicę JSON) wklej do gotowego `out/<slug>/NNN.result.json`,
   **nadpisując** jego początkowe `[]`. (Plik jest już utworzony przez export —
   nie tworzysz go ręcznie; `map.json` zostaw w spokoju, to nie tu idzie wynik.)
3. Podgląd i zapis:

```bash
npm run apply -- <course-slug> --dry    # podgląd: nic nie zapisuje
npm run apply -- <course-slug>          # zapis (lekcje + .bak)
```

Można pracować przyrostowo — `apply` przetwarza te batche, które mają już
result, resztę wypisuje jako *pending*. Pojedynczy batch: `--file NNN`.

## Taski VS Code

| Task | Co robi |
|---|---|
| `Gemini Polish: 1) PRZYGOTUJ batche` | `npm run export` — buduje `out/<slug>/` |
| `Gemini Polish: 2) RUN przez API` | `npm run run` — auto-przerób + resume + limity |
| `Gemini Polish: 3) APPLY (dry-run)` | podgląd ręcznie wklejonych wyników |
| `Gemini Polish: 4) APPLY (zapis)` | zapis do kursu z backupem `.bak` |

## Pliki i raporty

```
out/<slug>/NNN.prompt.md    ← wklej całość do Gemini (ścieżka B)
out/<slug>/NNN.map.json     ← sidecar dla apply (nie ruszać — NIE tu idzie wynik)
out/<slug>/NNN.result.json  ← odpowiedź Gemini (stub `[]` z exportu → nadpisz wynikiem)
out/<slug>/MANIFEST.md      ← spis batchy
reports/<slug>/*.diff.md      ← per-pole przed/po + status (nadpisywany per run!)
reports/<slug>/*.concerns.md  ← podejrzane błędy + dodane zdania (addedContext)
```

Statusy pola w raporcie: `applied` / `unchanged` / `rejected` (token zmieniony —
zostaje oryginał) / `missing` (model uciął id) / `stale` (tekst lekcji zmienił
się po exporcie — pomijane, zrób ponowny export).

## Opcje

- `export`: `--lesson <slug>` (jedna lekcja), `--max-chars N` (budżet
  znaków/batch, domyślnie 10000 — zmniejsz, gdy Gemini ucina odpowiedzi;
  zwiększ np. do 25000 w AI Studio z max output 8192), `--max-fields N`,
  `--out <dir>`, `--fresh`.
- `run`: `--model M|auto`, `--limit N` (batchy w tym runie), `--max-calls N`,
  `--delay-ms N`, `--timeout-ms N`, `--no-apply`. Debug nieparsowalnych
  odpowiedzi: `GP_DEBUG=1` (zrzuca `NNN.rawfail.*`).
- `apply`: `--file NNN`, `--dry`, `--force` (nadpisz istniejący `.bak`),
  `--out <dir>`, `--report <dir>`.

## Co jest polerowane, a co zamrożone

Polerowana jest wyłącznie proza widoczna dla ucznia (tytuły, opisy, markdown
teorii, pytania/odpowiedzi/wyjaśnienia quizów, podpisy rysunków, treści zadań…)
— pełna mapa per typ widgetu w `src/polishableMap.mjs`. Zamrożone na zawsze:
kod, `src`/`url`, identyfikatory, dane liczbowe, indeksy poprawnych odpowiedzi,
transkrypty z timingiem, `alt` obrazków oraz każdy fragment matematyki / kodu /
URL wewnątrz prozy.

## Dobre praktyki

- Po dosypaniu **ręcznych poprawek merytorycznych** do lekcji nie bój się
  ponownego `apply` — guard `stale` pominie zmienione pola. Żeby je wypolerować
  od nowa, zrób świeży export.
- Backup `.bak` powstaje przy pierwszym zapisie lekcji i nie jest nadpisywany —
  to zawsze stan sprzed pierwszego polishu (baseline do diffów).
- Raporty są nadpisywane przy każdym runie apply — jeśli chcesz historię,
  kopiuj je na bok (`--report <dir>`).
