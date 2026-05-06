// Server-only helper that converts an uploaded `.docx` to a markdown text file
// next to the original (US-124). Claude Code's Read tool cannot parse a docx
// (it's a zip-of-XML), so without this pre-extraction the curriculum / lesson
// generators would silently skip every Word document the user uploaded.
//
// Exposes a single function `extractDocxToMarkdown` that runs mammoth's
// markdown converter and writes the result. Non-fatal mammoth messages
// (warnings about unrecognised styles, etc.) are surfaced as `warnings`, not
// failures — only thrown errors (corrupt zip, not actually a docx) are
// reported as `{ ok: false }`.
//
// Mammoth ships without TypeScript types so a minimal local interface for the
// bits we actually use is declared at the bottom of this file.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import mammothModule from 'mammoth';

const mammoth = mammothModule as unknown as MammothModule;

export interface ExtractDocxSuccess {
  ok: true;
  markdown: string;
  warnings: string[];
}

export interface ExtractDocxFailure {
  ok: false;
  reason: string;
}

export type ExtractDocxResult = ExtractDocxSuccess | ExtractDocxFailure;

/**
 * Convert `srcPath` (a .docx) to markdown and write it to `destPath`.
 *
 * Returns `{ ok: true, markdown, warnings }` on success — `warnings` carries
 * mammoth's non-fatal messages (e.g. "Unrecognised paragraph style: ..."),
 * which the caller may want to log but should never treat as a hard failure.
 *
 * Returns `{ ok: false, reason }` when mammoth throws (the file is not a
 * valid docx, the zip is corrupt, etc.) or when the destination cannot be
 * written. Callers in upload-sources/route.ts log the reason and continue —
 * the docx upload itself is never blocked by an extraction failure.
 */
export async function extractDocxToMarkdown(
  srcPath: string,
  destPath: string,
): Promise<ExtractDocxResult> {
  let result: MammothResult;
  try {
    // Override the default `data:image/...;base64,` inline embedding (US-126):
    // the wizard / curriculum generators consume this markdown as plain text,
    // and base64 image blobs add no comprehension value while burning the prompt
    // budget (one reference fixture went from 2.26M chars → ~107k chars after
    // this change). The non-empty placeholder src ensures mammoth's markdown
    // writer actually emits the image marker — it skips images whose src AND
    // alt are both empty — and the post-process below collapses it to `[image]`.
    result = await mammoth.convertToMarkdown(
      { path: srcPath },
      { convertImage: mammoth.images.imgElement(() => ({ src: '[image]' })) },
    );
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  const warnings = (result.messages ?? [])
    .filter((m) => m.type !== 'error')
    .map((m) => m.message);
  const markdown = stripImageMarkdown(result.value);
  try {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, markdown, 'utf8');
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, markdown, warnings };
}

// Replace every `![alt](src)` produced by mammoth with the literal `[image]`
// token. Mammoth emits images inline within paragraphs, so the surrounding
// blank lines from the source paragraph break already preserve placement —
// we do not need to inject extra newlines around the placeholder.
function stripImageMarkdown(md: string): string {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]');
}

interface MammothMessage {
  type: string;
  message: string;
}

interface MammothResult {
  value: string;
  messages: MammothMessage[];
}

interface MammothImageElement {
  contentType: string;
  altText?: string;
  readAsBase64String(): Promise<string>;
}

interface MammothImageAttributes {
  src?: string;
  alt?: string;
}

interface MammothImagesApi {
  imgElement(
    func: (image: MammothImageElement) =>
      | MammothImageAttributes
      | Promise<MammothImageAttributes>,
  ): unknown;
}

interface MammothConvertOptions {
  convertImage?: unknown;
}

interface MammothModule {
  convertToMarkdown(
    input: { path: string } | { buffer: Buffer },
    options?: MammothConvertOptions,
  ): Promise<MammothResult>;
  images: MammothImagesApi;
}
