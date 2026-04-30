# AI Lecturer

A single-user, locally-hosted web app for studying interactive AI-generated lessons. The webapp renders courses produced by the offline `ralph` agent chain (course-spec → lesson generation) and tracks per-lesson progress on disk; it does not run the agents itself.

## Stack

- Next.js 15+ (App Router) · TypeScript (strict)
- Tailwind CSS v3
- shadcn/ui (initialized; components added per-story)

## Run

```bash
npm install
npm run dev       # http://localhost:3000
npm run build     # production build
npm run start     # serve the built app
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```

## Layout

- `src/app/` — Next.js routes
- `src/components/` — shared UI (with `ui/` from shadcn)
- `src/widgets/` — per-widget lesson components (theory, quiz, code, demo, sandbox)
- `src/lib/` — utilities; `src/lib/schemas/` holds the Zod schemas shared with the agent chain

Generated courses live under `/courses/<slug>/`; per-user progress is stored at `~/.ai-lecturer/progress.json`.
