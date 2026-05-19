# Static course exporter

Standalone tool that exports **one** AI Lecturer course to a self-contained
static website — every interactive widget works, **no AI chat / no server**.
Drop the output on any static host (Netlify, GitHub Pages, S3, nginx, a USB
stick…) and share a link; the recipient can take the whole course in the
browser.

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

## Export a course

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

Preview locally:

```bash
npx serve dist/<slug>      # then open the printed URL
```

Deploy: upload the **contents** of `dist/<slug>/` to any static host.

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
