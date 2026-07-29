// Server-only helper that converts an uploaded `.pptx` to a markdown text file
// next to the original (US-213). Mirrors `extractDocxToMarkdown` (US-124) and
// `extractPdfToMarkdown` (US-127): Claude Code's Read tool cannot parse a pptx
// (it's a zip-of-XML), so without this pre-extraction every slide deck flowed
// through generation as `binary-unsupported` and the model never saw the slide
// content.
//
// Extraction is pure Node: `unzipper` (already a dependency, used by the course
// import route) opens the OOXML zip and the slide / notes XML parts are scanned
// for `<a:t>` text runs with a small regex — no XML DOM library, no native
// binary. Slides are emitted in numeric order under `## Slajd N` headers;
// speaker notes (ppt/notesSlides/) are appended when the slide's relationships
// point at one. Slides with no extractable text are skipped.
//
// Mammoth/pdf-style result shape: `{ ok: true, markdown, slides, warnings }`
// on success, `{ ok: false, reason }` on failure (not a zip, no slides, no
// extractable text). Callers in upload-sources/route.ts log the reason and
// continue — the pptx upload itself is never blocked by an extraction failure;
// it falls through to `binary-unsupported` in the prompt loaders.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import unzipper from 'unzipper';

export interface ExtractPptxSuccess {
  ok: true;
  markdown: string;
  /** Number of slides that produced output (empty slides are skipped). */
  slides: number;
  warnings: string[];
}

export interface ExtractPptxFailure {
  ok: false;
  reason: string;
}

export type ExtractPptxResult = ExtractPptxSuccess | ExtractPptxFailure;

/** Matches `ppt/slides/slide<N>.xml` (the slide parts), capturing N. The
 *  nested `_rels/` parts (`ppt/slides/_rels/slideN.xml.rels`) do NOT match
 *  because of the required `slide` prefix immediately after `slides/`. */
const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

/** Decode the five predefined XML entities plus numeric character references.
 *  `&amp;` is handled last so an already-decoded `&` from e.g. `&amp;lt;` is
 *  not re-interpreted. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/**
 * Pull readable text out of a slide / notesSlide XML part. Text lives in
 * `<a:t>…</a:t>` runs grouped under `<a:p>…</a:p>` paragraphs; runs within a
 * paragraph are concatenated (DrawingML splits a single visual line across
 * runs on formatting boundaries) and paragraphs are joined with newlines.
 * Empty paragraphs are dropped so a deck full of layout placeholders does not
 * emit blank lines.
 */
function extractTextFromXml(xml: string): string {
  const paragraphs: string[] = [];
  const paragraphRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = paragraphRe.exec(xml)) !== null) {
    const runRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
    const runs: string[] = [];
    let rMatch: RegExpExecArray | null;
    while ((rMatch = runRe.exec(pMatch[1])) !== null) {
      runs.push(decodeXmlEntities(rMatch[1]));
    }
    const line = runs.join('').trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs.join('\n');
}

/** Find the notesSlide relationship target in a slide's `.rels` XML. Returns
 *  the raw (relative) Target string, e.g. `../notesSlides/notesSlide1.xml`, or
 *  null when the slide has no notes. */
function findNotesTarget(relsXml: string): string | null {
  const relRe = /<Relationship\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = relRe.exec(relsXml)) !== null) {
    const tag = m[0];
    if (/Type="[^"]*\/notesSlide"/.test(tag)) {
      const t = /Target="([^"]*)"/.exec(tag);
      if (t) return t[1];
    }
  }
  return null;
}

/**
 * Convert `srcPath` (a .pptx) to markdown text and write it to `destPath`.
 *
 * Output is one section per slide that has text:
 *
 *   ## Slajd <N>
 *
 *   <slide body text>
 *
 *   _Notatki prelegenta:_
 *
 *   <speaker notes>
 *
 * Sections are joined with a blank line and ordered by slide number. Slides
 * with neither body text nor notes are skipped (per the AC). Speaker notes are
 * only included when the slide's `_rels` point at a notesSlide part that is
 * present in the archive.
 *
 * Returns `{ ok: true, markdown, slides, warnings }` on success — `slides` is
 * the count of emitted sections (always > 0 on success); `warnings` is
 * currently always empty but is part of the API for symmetry with the docx /
 * pdf extractors.
 *
 * Returns `{ ok: false, reason }` when the file is not a valid zip, contains no
 * `ppt/slides/slideN.xml` parts, or yields no extractable text from any slide.
 * The caller logs the reason and leaves the .pptx as `binary-unsupported`.
 */
export async function extractPptxToMarkdown(
  srcPath: string,
  destPath: string,
): Promise<ExtractPptxResult> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(srcPath);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  let directory: unzipper.CentralDirectory;
  try {
    directory = await unzipper.Open.buffer(buf);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const byPath = new Map<string, unzipper.File>();
  for (const f of directory.files) byPath.set(f.path, f);

  const slideEntries = directory.files
    .map((f) => {
      const m = SLIDE_PATH_RE.exec(f.path);
      return m ? { n: Number(m[1]), file: f } : null;
    })
    .filter((e): e is { n: number; file: unzipper.File } => e !== null)
    .sort((a, b) => a.n - b.n);

  if (slideEntries.length === 0) {
    return { ok: false, reason: 'No slides found in ppt/slides/' };
  }

  const sections: string[] = [];
  for (const { n, file } of slideEntries) {
    const slideXml = (await file.buffer()).toString('utf8');
    const body = extractTextFromXml(slideXml);

    // Speaker notes: resolve the slide's notesSlide relationship (if any) and
    // pull text from the referenced part. The Target is relative to the slide
    // part's directory (ppt/slides/), so resolve it there with posix joins —
    // zip entry paths are always forward-slash separated.
    let notes = '';
    const relsFile = byPath.get(`ppt/slides/_rels/slide${n}.xml.rels`);
    if (relsFile) {
      const target = findNotesTarget((await relsFile.buffer()).toString('utf8'));
      if (target) {
        const notesPath = path.posix.normalize(path.posix.join('ppt/slides', target));
        const notesFile = byPath.get(notesPath);
        if (notesFile) {
          notes = extractTextFromXml((await notesFile.buffer()).toString('utf8'));
        }
      }
    }

    if (!body && !notes) continue;

    let section = `## Slajd ${n}`;
    if (body) section += `\n\n${body}`;
    if (notes) section += `\n\n_Notatki prelegenta:_\n\n${notes}`;
    sections.push(section);
  }

  if (sections.length === 0) {
    return { ok: false, reason: 'No extractable text found in slides' };
  }

  // Strip U+0000 for the same reason the pdf extractor does (US-128): the
  // markdown may later be inlined into a `spawn('claude', ['-p', prompt])`
  // argv, which cannot carry null bytes.
  const markdown = sections.join("\n\n").replace(/\u0000/g, "");

  try {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, markdown, 'utf8');
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true, markdown, slides: sections.length, warnings: [] };
}
