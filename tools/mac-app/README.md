# macOS app exporter

Packages AI Lecturer as a double-clickable, **read-only** macOS app: chosen
collections only, AI tutor included (chat, web research, images), no course
creation, editing, regeneration or deletion.

## Build

```bash
cd tools/mac-app
npm install                       # once (Electron + @electron/packager); needs Node ≥ 22.12
npm run build                     # "Neurologia Dziecięca", this Mac's arch
npm run build -- --arch x64       # Intel Mac; --arch arm64,x64 for both
npm run build -- --collection "Matematyka" --collection "Biologia"
npm run build -- --skin none      # plain app look (default: "zajawa", the static-export skin)
npm run build -- --skip-next      # repackage only (after editing app/main.cjs)
```

Output: `build/out/AI Lecturer-darwin-<arch>/AI Lecturer.app` and
`build/out/AI-Lecturer-<arch>.zip` (~500 MB, mostly the EEG course assets).
Collections are read from `~/.ai-lecturer/collections.json`.

## What the build does

1. `next build` with `AI_LECTURER_STANDALONE=1` into `.next-mac/` (never
   touches `.next/`; `tsconfig.json` is restored afterwards).
2. Assembles `build/payload/`: the Next standalone server + static files +
   `public/`, the tutor's image MCP server (`scripts/tutor/`), the selected
   courses (minus `logs/` and generation logs) and a `collections.json` with
   only those collections.
3. Downloads an official Node binary (cached in `.cache/`) — the server and
   the MCP server run on it, not on Electron.
4. Wraps it all with Electron (`app/main.cjs`), ad-hoc signs, zips.

## Runtime

`app/main.cjs` starts the server on a random `127.0.0.1` port with:

- `AI_LECTURER_READ_ONLY=1` — `src/proxy.ts` rejects every write API call
  except progress, chat history and tutor turns/images, and redirects
  `/create` and `/extend`; `globals.css` hides the authoring buttons.
- `AI_LECTURER_SKIN=zajawa` — `src/styles/skins/zajawa.css`, the
  static-export look (alabaster, matcha accent, serif headings, watermark),
  forced light. Token values mirror `tools/static-export/src/zajawa-theme.css`.
- `AI_LECTURER_TUTOR_DEFAULT_OPEN=1` — the AI tutor panel starts open in
  every lesson until the learner closes it once (then her choice is kept).
- Courses read from inside the `.app`; learner data (progress, chats, chat
  images) in `~/Library/Application Support/AI Lecturer/data`; server log in
  `…/AI Lecturer/logs/server.log`.
- Menu **AI Lecturer → Eksportuj rozmowy z tutorem… (⌘E)** zips `chats/` and
  `chat-media/` from the data dir — same layout as `~/.ai-lecturer/`, so the
  transcripts can be reviewed (or dropped into the dev app) to improve courses.
- `PATH` taken from the login shell plus `~/.local/bin`, `/opt/homebrew/bin`,
  … — Finder-launched apps otherwise can't see `claude`. If `claude` is
  missing, a dialog explains how to install it; courses still work.

## Installing on another Mac

1. Pick the right arch (Apple menu → About This Mac: "Apple M…" → arm64,
   "Intel" → x64).
2. Copy the zip, unzip, drag `AI Lecturer.app` to Applications.
3. The app is not notarized. First launch: right-click → Open → Open. If
   macOS says it is "damaged": `xattr -cr "/Applications/AI Lecturer.app"`.
4. Install and log in to Claude Code once in Terminal:
   `curl -fsSL https://claude.ai/install.sh | bash`, then `claude` → log in.
5. Drag the app to the Dock.

Not available in the packaged app: TTS/STT and the Python code runner (need
local servers); flashcard generation is blocked (existing decks work).
