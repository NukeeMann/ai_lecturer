import { z } from 'zod';

export const CodeTestSchema = z.object({
  name: z.string(),
  body: z.string(),
  hidden: z.boolean().default(true),
});

export const CodeInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    src: z.string().min(1),
    alt: z.string().optional(),
    caption: z.string().optional(),
    // Optional override of the virtual filename inside /inputs/ for the
    // Pyodide worker. When omitted, the runner derives the basename from
    // `src`. Set this when `src` is opaque (e.g. signed URL with no path).
    filename: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('video'),
    src: z.string().min(1),
    caption: z.string().optional(),
    filename: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('file'),
    src: z.string().min(1),
    filename: z.string().min(1),
    caption: z.string().optional(),
  }),
  z.object({
    kind: z.literal('text'),
    content: z.string(),
    label: z.string().optional(),
  }),
]);

/**
 * Resolve the virtual filename a Code-widget input mounts at inside the
 * Pyodide worker's `/inputs/` directory. Returns `null` for kinds that do
 * not represent a binary file (currently `text`).
 *
 * Filename priority:
 *   1. explicit `filename` field if present
 *   2. basename of `src` (last `/`-separated segment, query string stripped)
 *
 * Returns `null` when neither is usable so callers can decide how to react
 * (the worker treats nulls as "skip this input").
 */
export function inputMountName(input: CodeInput): string | null {
  if (input.kind === 'text') return null;
  if ('filename' in input && input.filename) return input.filename;
  return basenameFromSrc(input.src);
}

function basenameFromSrc(src: string): string | null {
  if (!src) return null;
  // Strip query + fragment so `?token=...` does not become part of the name.
  const cleaned = src.split('?')[0].split('#')[0];
  const seg = cleaned.split('/').filter(Boolean).pop();
  return seg && seg.length > 0 ? seg : null;
}

export const CodeOutputMediaSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    src: z.string().min(1),
    alt: z.string().optional(),
    caption: z.string().optional(),
    // When true, the static `src` acts as a placeholder until the user runs
    // their code; the matplotlib figure produced by the run replaces it
    // (US-174). Falsy or missing = current static behavior.
    live: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('video'),
    src: z.string().min(1),
    caption: z.string().optional(),
  }),
]);

export const CodeDataSchema = z.object({
  taskMarkdown: z.string(),
  starterCode: z.string(),
  tests: z.array(CodeTestSchema),
  solution: z.string().optional(),
  inputs: z.array(CodeInputSchema).optional(),
  outputMedia: CodeOutputMediaSchema.optional(),
  // Real pip packages that must be importable in the kernel runtime (US-196),
  // e.g. ['cv2', 'numpy'] for real OpenCV/NumPy. Declared names are checked as
  // a precondition before a run (US-202) — they are NOT installed at run time.
  // Accepts import names (e.g. 'cv2') or PyPI dist names (e.g. 'Pillow').
  requiresPackages: z.array(z.string()).optional(),
});

export type CodeTest = z.infer<typeof CodeTestSchema>;
export type CodeInput = z.infer<typeof CodeInputSchema>;
export type CodeOutputMedia = z.infer<typeof CodeOutputMediaSchema>;
export type CodeData = z.infer<typeof CodeDataSchema>;
