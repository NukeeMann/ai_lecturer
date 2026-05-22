# Static course exporter

Standalone tool that exports AI Lecturer content to a self-contained static
website — every interactive widget works, **no AI chat / no server**. Drop
the output on any static host (Netlify, GitHub Pages, S3, nginx, a USB
stick…) and share a link.

Two output shapes:

- **Single course** — `dist/<slug>/`, course index + per-lesson pages.
- **Library** (one or more collections) — `dist/library/`, a home page with
  one section per collection, each holding tiles for its courses.

## Why it's separate

This tool lives entirely in `tools/static-export/`. It has its **own**
`package.json` and build, and it reads the widget code **read-only** from
`../../src` via Vite's `@` alias. Editing anything in this folder can never
change the main app. Runtime libraries (React, react-markdown, dnd-kit,
KaTeX, the Pyodide worker, …) resolve to the main project's `node_modules`,
so an exported course renders byte-for-byte like the running app and there is
exactly one React instance.

## Setup (once)

```bash
cd tools/static-export
npm install            # installs ONLY Vite + the React plugin, in this folder
```

The main project must already have its dependencies installed
(`npm install` in the repo root) — this tool reuses them.

## Export a single course

```bash
cd tools/static-export
npm run export -- <course-slug>
```

`<course-slug>` is a directory name under `<repo>/courses/`. Output lands in
`tools/static-export/dist/<course-slug>/`:

```
dist/<slug>/
  index.html                 # course overview + lesson links
  lessons/<lessonSlug>.html  # one page per lesson
  assets/app/…               # the shared widget bundle (hashed)
  assets/course/…            # copied audio / plots / images
```

## Export a library (one or more collections)

Collections live in `~/.ai-lecturer/collections.json` — the same file the
main app uses to group courses (e.g. "Matematyka", "Widget Demos"). The
exporter reads it and bundles the chosen collections into a single
`dist/library/` site whose **home page** has one section per collection and
tiles for each course inside.

```bash
# one collection (matches case-insensitively, quote names with spaces)
npm run export -- --collection "Matematyka"

# several collections — repeat the flag, or comma-separate
npm run export -- --collection "Matematyka" --collection "Widget Demos"
npm run export -- --collections "Matematyka,Widget Demos"

# everything in collections.json
npm run export -- --all-collections
```

Output:

```
dist/library/
  index.html                            # library home (collections + tiles)
  <course-slug>/
    index.html                          # course overview
    lessons/<lessonSlug>.html           # one page per lesson
  assets/app/…                          # ONE shared widget bundle
  assets/course/<course-slug>/…         # per-course audio / plots / images
```

When the exported library has exactly one collection the home title becomes
that collection's name; otherwise it's "AI Lecturer library". Course pages
get a "← Library" back-link; lesson pages get one too, in the sidebar.

## Preview locally

```bash
npx serve dist/<slug>          # single-course
npx serve dist/library         # library
# then open the printed URL
```

Deploy: upload the **contents** of the chosen `dist/…` directory to any
static host.

## What works / what doesn't

**Works fully (interactive):** theory (Markdown + KaTeX), quiz, code &
sandbox (Pyodide — needs internet for the CDN on first run), codeCloze,
dragMatch, parametricExplorer, histogram, dataTable, plotImage, demo,
audioPlayer & transcriptCloze (audio is copied into the export), video.
Per-section completion is remembered in the visitor's `localStorage`.

**Intentionally excluded:** the AI tutor / lesson chat, and any in-app edit /
regenerate UI.

**Degrades gracefully (needs the full app + a server):** the `sttDemo` and
`ttsDemo` widgets — they record/synthesize via server-side Whisper/Coqui, so
in a static export they render but show an "unavailable" notice instead of
calling a backend.

## Notes

- Code cells fetch Pyodide from the jsDelivr CDN on first run, so the
  visitor needs an internet connection the first time they run Python
  (matches the app's behaviour; an offline Pyodide bundle is out of scope).
- `dist/` and `.bundle/` are git-ignored build output.
