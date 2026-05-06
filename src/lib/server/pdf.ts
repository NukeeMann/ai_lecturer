// Server-only helper that converts an uploaded `.pdf` to a markdown text file
// next to the original (US-127). Mirrors `extractDocxToMarkdown` (US-124):
// Claude Code's Read tool can only parse PDFs via `pdftoppm` (poppler-utils),
// which is missing on the reference machine — so without this pre-extraction,
// every PDF flowed through generation as `binary-unsupported`.
//
// `pdf-parse` (≥2.x, built on `pdfjs-dist`) is a pure-Node text extractor with
// no native binary dependency, so the runtime environment never needs poppler.
//
// Mammoth-style result shape: `{ ok: true, markdown, pages, warnings }` on
// success, `{ ok: false, reason }` on parser failure (corrupt PDF, encrypted
// PDF the lib cannot read, etc.). Image-only / scanned PDFs are NOT a failure
// — pdf-parse returns empty page text for them and the markdown will be a
// sequence of empty pages; OCR is out of scope for this story.
//
// pdf-parse ships ESM + CJS; Next/Node resolution picks the correct flavour
// automatically. Types come from the package itself.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';

export interface ExtractPdfSuccess {
  ok: true;
  markdown: string;
  pages: number;
  warnings: string[];
}

export interface ExtractPdfFailure {
  ok: false;
  reason: string;
}

export type ExtractPdfResult = ExtractPdfSuccess | ExtractPdfFailure;

/** Per-page separator inserted before each page's body. The non-empty
 *  blank lines on either side mean a markdown reader treats the marker as
 *  its own paragraph; the literal `--- page <N> ---` is what the smoke
 *  test asserts on. */
function pageSeparator(n: number): string {
  return `--- page ${n} ---`;
}

/**
 * Convert `srcPath` (a .pdf) to markdown text and write it to `destPath`.
 *
 * The output is the per-page text joined with a `\n\n--- page <N> ---\n\n`
 * separator (the marker comes BEFORE each page so the very first thing
 * the model reads is `--- page 1 ---` followed by that page's body).
 *
 * Returns `{ ok: true, markdown, pages, warnings }` on success — `pages` is
 * the total page count from pdf-parse and is always > 0 on success;
 * `warnings` is currently always empty (pdf-parse does not surface
 * non-fatal warnings like mammoth does) but is part of the API for
 * symmetry with `extractDocxToMarkdown` and so future versions can fill it
 * in without a breaking change.
 *
 * Returns `{ ok: false, reason }` when pdf-parse throws (the file is not a
 * valid PDF, the document is encrypted with a password, the trailer is
 * corrupt, etc.). Callers in upload-sources/route.ts log the reason and
 * continue — the pdf upload itself is never blocked by an extraction
 * failure.
 */
export async function extractPdfToMarkdown(
  srcPath: string,
  destPath: string,
): Promise<ExtractPdfResult> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(srcPath);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  let pages: { num: number; text: string }[];
  let total: number;
  let parser: PDFParse | null = null;
  try {
    // pdfjs-dist takes ownership of the underlying buffer (transfers it to
    // its worker thread on browsers; in Node this means the array is
    // emptied after the load). Pass a fresh Uint8Array so we don't leave a
    // detached Buffer lying around in the caller's scope.
    parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    pages = result.pages;
    total = result.total;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    // Release pdfjs-dist resources — best-effort; a destroy() failure here
    // is not a parser failure.
    if (parser) await parser.destroy().catch(() => {});
  }

  // Order by page number; pdf-parse returns pages in document order but
  // we sort defensively so a future version that streams pages out of
  // order doesn't silently break the page sequence.
  const ordered = [...pages].sort((a, b) => a.num - b.num);
  const markdown = ordered
    .map((p) => `${pageSeparator(p.num)}\n\n${p.text}`)
    .join('\n\n');

  try {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, markdown, 'utf8');
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true, markdown, pages: total, warnings: [] };
}
