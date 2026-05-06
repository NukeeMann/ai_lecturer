// Server-only helpers for the "Upload materials" entry path on /create
// (US-103). Owns the on-disk layout for both staged drafts and finalized
// course-attached source uploads, plus the filename sanitisation /
// collision-suffix logic shared between POST and DELETE routes.
//
// Disk layout:
//   <coursesRoot>/.drafts/<draftId>/sources/<sanitized-original-filename>
//   <coursesRoot>/<slug>/sources/<sanitized-original-filename>
//
// At slug-finalisation time (POST /api/courses), the draft sources directory
// (if any) is moved into the new course directory via `moveDraftSourcesToCourse`.

import path from 'node:path';
import { promises as fs, existsSync, readdirSync, readFileSync } from 'node:fs';
import { coursesRoot, courseDir, assertSafeSlug, InvalidSlugError } from './paths';

/** Per-file size cap for uploaded source materials. 50 MiB — large enough
 *  for typical lecture-deck PDFs/PPTX (~30–40 MB), small enough that a
 *  multi-file upload doesn't blow the Next.js dev server's RAM. */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Allowed extensions (lower-case, including the dot). The ACs name PDF /
 *  PPTX / DOCX / TXT / JSON; everything else is rejected. */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pdf',
  '.pptx',
  '.docx',
  '.txt',
  '.json',
]);

/** Per-extension allowed MIME types. Some browsers/operating systems lie
 *  about the MIME type for office documents (e.g. PPTX served as
 *  application/octet-stream by older Firefox), so we accept the empty
 *  string and `application/octet-stream` as a fallback whenever the
 *  extension is on the allow-list — extension is the source of truth. */
export const MIME_TYPES_BY_EXTENSION: Readonly<Record<string, readonly string[]>> = {
  '.pdf': ['application/pdf'],
  '.pptx': [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  '.txt': ['text/plain'],
  '.json': ['application/json'],
};

const FALLBACK_MIME_TYPES: ReadonlySet<string> = new Set(['', 'application/octet-stream']);

/** Subdirectory under coursesRoot where staged-but-not-yet-bound uploads
 *  live. The leading dot keeps it out of GET /api/courses (which iterates
 *  course.json under each entry — drafts have none and are silently
 *  skipped via ENOENT). */
export const DRAFTS_DIRNAME = '.drafts';

/** Subdirectory next to a /sources/ directory where pre-extracted text
 *  siblings live for binary formats Claude Code's Read tool cannot parse
 *  natively (currently: .docx → markdown). The leading dot keeps these
 *  helper files out of GET /api/courses/upload-sources (which lists files
 *  directly in /sources/, NOT recursively). See US-124. */
export const EXTRACTED_DIRNAME = '.extracted';

/** Same character class as `assertSafeSlug` — generated draft ids must be
 *  drawn from a safe alphabet so they cannot escape `<root>/.drafts/`. */
const DRAFT_ID_RE = /^[a-zA-Z0-9-]{6,64}$/;

export class InvalidDraftIdError extends Error {
  constructor(id: string) {
    super(`Invalid draftId: ${JSON.stringify(id)}`);
    this.name = 'InvalidDraftIdError';
  }
}

export function assertSafeDraftId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !DRAFT_ID_RE.test(id)) {
    throw new InvalidDraftIdError(String(id));
  }
}

/** Generate a fresh draft id. URL-safe, no dependency on randomUUID
 *  format (some Node versions return UUIDs with hyphens which DRAFT_ID_RE
 *  accepts). */
export function makeDraftId(): string {
  // Using crypto.randomUUID() — available since Node 14.17 / Next 15. Has
  // the form `xxxxxxxx-xxxx-...`; matches DRAFT_ID_RE.
  return globalThis.crypto.randomUUID();
}

export function draftsRoot(): string {
  return path.join(coursesRoot(), DRAFTS_DIRNAME);
}

export function draftDir(draftId: string): string {
  assertSafeDraftId(draftId);
  return path.join(draftsRoot(), draftId);
}

export function draftSourcesDir(draftId: string): string {
  return path.join(draftDir(draftId), 'sources');
}

export function courseSourcesDir(slug: string): string {
  return path.join(courseDir(slug), 'sources');
}

/** Sanitize an arbitrary user-supplied filename to a safe, basename-only
 *  string we can write under /sources/. The original filename is preserved
 *  as much as possible (per the AC) but path separators, leading dots, and
 *  control characters are stripped.
 *
 *  Returns null if the input cannot be coerced into a usable name (empty
 *  after sanitisation, no extension, or the extension isn't on the
 *  allow-list).
 */
export function sanitizeFilename(input: string): string | null {
  if (typeof input !== 'string') return null;
  // Reject overlong names — most filesystems cap basenames at 255 bytes.
  if (input.length > 255) return null;
  // Drop everything up to and including the last path separator (handles
  // both Unix and Windows paths). `path.basename` does not normalise
  // backslashes on POSIX, so do it manually.
  const lastSep = Math.max(input.lastIndexOf('/'), input.lastIndexOf('\\'));
  let name = lastSep >= 0 ? input.slice(lastSep + 1) : input;
  // Strip control chars + a small set of cross-platform-illegal characters.
  name = name.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '');
  // Collapse whitespace runs and trim.
  name = name.replace(/\s+/g, ' ').trim();
  // Strip leading dots so we don't accidentally create a hidden file.
  name = name.replace(/^\.+/, '');
  if (name.length === 0) return null;
  // Validate extension.
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;
  return name;
}

/** Given a desired filename and a list of names already present in the
 *  target directory, return a unique name that doesn't collide. Numeric
 *  suffix is inserted before the extension as ` (2)`, ` (3)`, ... . */
export function withCollisionSuffix(name: string, existing: ReadonlySet<string>): string {
  if (!existing.has(name)) return name;
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  let n = 2;
  // Hard cap so a pathological repeat doesn't loop forever.
  while (n < 10000) {
    const candidate = `${base} (${n})${ext}`;
    if (!existing.has(candidate)) return candidate;
    n += 1;
  }
  // Fallback: append a timestamp.
  return `${base} (${Date.now()})${ext}`;
}

/** Validate a single uploaded file's extension + MIME type + size before
 *  writing it. Returns the sanitised basename or an error reason. */
export function validateUpload(
  originalName: string,
  mimeType: string,
  size: number,
): { ok: true; sanitized: string } | { ok: false; reason: string } {
  if (size < 0) return { ok: false, reason: 'Empty or invalid file' };
  if (size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      reason: `File too large (${formatBytes(size)} > ${formatBytes(MAX_FILE_SIZE_BYTES)})`,
    };
  }
  const sanitized = sanitizeFilename(originalName);
  if (!sanitized) {
    return { ok: false, reason: `Unsupported filename "${originalName}"` };
  }
  const ext = path.extname(sanitized).toLowerCase();
  const allowedMimes = MIME_TYPES_BY_EXTENSION[ext];
  if (!allowedMimes) {
    return { ok: false, reason: `Unsupported extension "${ext}"` };
  }
  const mt = (mimeType ?? '').toLowerCase();
  const mimeOk = allowedMimes.includes(mt) || FALLBACK_MIME_TYPES.has(mt);
  if (!mimeOk) {
    return {
      ok: false,
      reason: `MIME type "${mimeType}" does not match extension "${ext}"`,
    };
  }
  return { ok: true, sanitized };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

export interface StoredSourceFile {
  originalName: string;
  sanitizedName: string;
  size: number;
  type: string;
}

/** Synchronously enumerate the absolute paths of every regular file under
 *  /courses/<slug>/sources/. Returns [] when the directory is missing or
 *  empty. Sorted lexicographically for stable prompt output. Used at
 *  generation-time by defaultInitCourseCommand / defaultLessonCommand
 *  (US-104) — sync because the factory functions are sync and the listing
 *  is small and local. */
export function listCourseSourceFilesSync(slug: string): string[] {
  assertSafeSlug(slug);
  const dir = courseSourcesDir(slug);
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.resolve(dir, e.name))
    .sort();
}

/**
 * Path of the extracted-text sibling for `absPath`. For
 * `<dir>/<name>.docx` this returns `<dir>/.extracted/<name>.docx.md`. The
 * extension is preserved in the sibling filename (rather than swapped to
 * `.md` in place of `.docx`) so that two source uploads with the same stem
 * but different extensions cannot collide on their siblings.
 *
 * Pure: does not check existence; callers (resolveSourcePathForPrompt, the
 * upload route, moveDraftSourcesToCourse, the DELETE route) decide based on
 * the result whether to read/write/unlink it.
 */
export function extractedSiblingPath(absPath: string): string {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);
  return path.join(dir, EXTRACTED_DIRNAME, `${base}.md`);
}

export interface ResolvedSourcePath {
  /** Absolute path the generation prompt should hand to the Read tool. For
   *  .docx with an extracted sibling this is the sibling .md; for everything
   *  else it's the original. */
  readPath: string;
  /** Original on-disk basename (e.g. `slides.docx`) for use in
   *  human-readable prompt annotations. */
  originalName: string;
  /** When `readPath` differs from the original, the original's basename so
   *  the prompt can label the line as "extracted text from <original>". */
  extractedFrom?: string;
}

/**
 * Resolve a source-file absolute path into a `{ readPath, originalName,
 * extractedFrom? }` triple suitable for building a generation prompt
 * (US-124). For `.docx` a pre-extracted markdown sibling under
 * `.extracted/` is preferred when it exists on disk (`existsSync`); for
 * `.pdf` / `.txt` / `.json` the original path is returned unchanged.
 *
 * Sync — called from the same generation-time code path as
 * listCourseSourceFilesSync, which is itself sync. The existsSync check
 * costs one stat per source file; that's negligible for the typical handful
 * of uploads per course.
 */
export function resolveSourcePathForPrompt(absPath: string): ResolvedSourcePath {
  const ext = path.extname(absPath).toLowerCase();
  const originalName = path.basename(absPath);
  if (ext === '.docx') {
    const sibling = extractedSiblingPath(absPath);
    if (existsSync(sibling)) {
      return { readPath: sibling, originalName, extractedFrom: originalName };
    }
  }
  return { readPath: absPath, originalName };
}

/**
 * Default token-budget caps for `loadStagedSourcesForPrompt` (US-125).
 *
 * 30k characters ≈ 7.5k tokens — leaves ample headroom in a 200k-context
 * Opus call alongside the system prompt, the existing draft spec, the
 * learner's clarification answers, and the model's reply. Per-file cap of
 * 12k characters ensures one runaway upload can't dominate the prompt
 * window even when a single file is well under the total budget.
 */
export const DEFAULT_TOTAL_CHAR_BUDGET = 30_000;
export const DEFAULT_PER_FILE_CHAR_CAP = 12_000;

export type StagedSourceForPrompt =
  | {
      kind: 'text';
      originalName: string;
      extractedFrom?: string;
      content: string;
    }
  | {
      kind: 'binary-unsupported';
      originalName: string;
    };

const TEXT_SOURCE_EXTS: ReadonlySet<string> = new Set([
  '.docx',
  '.txt',
  '.md',
  '.json',
]);

const BUDGET_EXHAUSTED_PLACEHOLDER =
  '(omitted: total character budget exhausted)';

function truncationMarker(remaining: number): string {
  return `\n\n[…truncated, ${remaining} more chars…]`;
}

/**
 * Load every staged source file under `<draftsRoot>/<draftId>/sources/` into
 * a prompt-ready array (US-125). Used by the wizard Clarify and Structure
 * routes to ground their LLM calls in the learner's uploads BEFORE the
 * outline is accepted (init_course only sees them after that).
 *
 * Behaviour:
 * - Files are read in lexicographic order (matches `listCourseSourceFilesSync`).
 * - For `.docx` the `.extracted/<name>.docx.md` sibling (US-124) is read
 *   instead of the binary; `extractedFrom` is set on the result.
 * - For `.txt`, `.md`, `.json` the file itself is read.
 * - For `.pdf` and `.pptx` (no extractor yet) the entry is returned with
 *   `kind: 'binary-unsupported'` — content omitted, originalName preserved.
 *   Keeping them in the array means the prompt can mention "user uploaded
 *   this but we can't read it" instead of silently dropping the upload.
 * - Per-file content is truncated at `perFileCharCap` (default 12k) with the
 *   marker `\n\n[…truncated, <N> more chars…]`.
 * - Once the running total of returned content would exceed
 *   `totalCharBudget` (default 30k), every subsequent text-extension file
 *   becomes `kind: 'text'` with `content` set to a single-line placeholder
 *   `'(omitted: total character budget exhausted)'`. The user must SEE in
 *   the prompt that we know about the file rather than have it silently
 *   disappear.
 * - Read errors on individual files (e.g. permission denied on the
 *   extracted sibling) downgrade that entry to `binary-unsupported` and log
 *   a warning to the server console — they do not fail the whole call.
 *
 * Always returns an array — never throws for ENOENT on the draft directory.
 * `assertSafeDraftId` is called first so a path-traversal id like `'../foo'`
 * is rejected loud and early.
 */
export function loadStagedSourcesForPrompt(
  draftId: string,
  opts?: { totalCharBudget?: number; perFileCharCap?: number },
): StagedSourceForPrompt[] {
  assertSafeDraftId(draftId);
  const totalBudget = opts?.totalCharBudget ?? DEFAULT_TOTAL_CHAR_BUDGET;
  const perFileCap = opts?.perFileCharCap ?? DEFAULT_PER_FILE_CHAR_CAP;
  const dir = draftSourcesDir(draftId);

  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const fileNames = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();

  const result: StagedSourceForPrompt[] = [];
  let used = 0;

  for (const name of fileNames) {
    const ext = path.extname(name).toLowerCase();
    const absPath = path.resolve(dir, name);
    const resolved = resolveSourcePathForPrompt(absPath);
    const originalName = resolved.originalName;

    if (!TEXT_SOURCE_EXTS.has(ext)) {
      // .pdf, .pptx, or any other non-text extension we can't extract yet.
      result.push({ kind: 'binary-unsupported', originalName });
      continue;
    }

    if (used >= totalBudget) {
      // Budget already exhausted — keep the file visible but omit content.
      result.push({
        kind: 'text',
        originalName,
        ...(resolved.extractedFrom
          ? { extractedFrom: resolved.extractedFrom }
          : {}),
        content: BUDGET_EXHAUSTED_PLACEHOLDER,
      });
      continue;
    }

    let raw: string;
    try {
      // Read the resolved path (extracted sibling for .docx, original for
      // .txt/.md/.json). UTF-8 by spec; node defaults are fine here.
      raw = readFileSync(resolved.readPath, 'utf8');
    } catch (err) {
      console.warn(
        `[loadStagedSourcesForPrompt] failed to read ${resolved.readPath}: ${(err as Error).message}`,
      );
      result.push({ kind: 'binary-unsupported', originalName });
      continue;
    }

    let content: string;
    if (raw.length > perFileCap) {
      const head = raw.slice(0, perFileCap);
      const remaining = raw.length - perFileCap;
      content = head + truncationMarker(remaining);
    } else {
      content = raw;
    }

    used += content.length;

    result.push({
      kind: 'text',
      originalName,
      ...(resolved.extractedFrom
        ? { extractedFrom: resolved.extractedFrom }
        : {}),
      content,
    });
  }

  return result;
}

/** List existing source filenames in a directory. Returns [] if the dir
 *  doesn't exist yet. Only regular files directly under `dir` are listed —
 *  the `.extracted/` sibling directory (US-124) is intentionally not
 *  recursed so the wizard UI never shows a docx's extracted .md as a
 *  separate source. */
export async function listSourceFilenames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Move every staged source file under the draft into the course's
 *  /sources/ dir. Idempotent: missing draft dir is a no-op. Files already
 *  present in the target directory get a numeric collision suffix.
 *
 *  Returns the list of moved (final) basenames. After a successful move
 *  the draft directory is removed (best-effort). */
export async function moveDraftSourcesToCourse(
  draftId: string,
  slug: string,
): Promise<string[]> {
  assertSafeDraftId(draftId);
  assertSafeSlug(slug);
  const srcDir = draftSourcesDir(draftId);
  let entries: string[];
  try {
    entries = await fs.readdir(srcDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const targetDir = courseSourcesDir(slug);
  await fs.mkdir(targetDir, { recursive: true });
  const moved: string[] = [];
  for (const name of entries) {
    // Defensive: the draft dir is meant to only contain files we sanitised,
    // but skip anything that doesn't sanitise (or any sub-directory).
    const sanitized = sanitizeFilename(name);
    if (!sanitized) continue;
    const srcPath = path.join(srcDir, name);
    const stat = await fs.stat(srcPath).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    const existing = new Set(await listSourceFilenames(targetDir));
    const finalName = withCollisionSuffix(sanitized, existing);
    const destPath = path.join(targetDir, finalName);
    try {
      await fs.rename(srcPath, destPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        // Cross-device rename — copy + unlink.
        await fs.copyFile(srcPath, destPath);
        await fs.unlink(srcPath);
      } else {
        throw err;
      }
    }
    moved.push(finalName);
    // US-124: if a pre-extracted text sibling was produced at upload time
    // (currently .docx → .extracted/<name>.md), move it alongside so the
    // generation prompt resolver still finds it after finalisation. Final
    // names of the docx and its sibling stay in sync even when the docx
    // gets a `(2)` suffix in the destination.
    const siblingSrc = path.join(srcDir, EXTRACTED_DIRNAME, `${name}.md`);
    const siblingStat = await fs.stat(siblingSrc).catch(() => null);
    if (siblingStat && siblingStat.isFile()) {
      const siblingDest = path.join(targetDir, EXTRACTED_DIRNAME, `${finalName}.md`);
      await fs.mkdir(path.dirname(siblingDest), { recursive: true });
      try {
        await fs.rename(siblingSrc, siblingDest);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
          await fs.copyFile(siblingSrc, siblingDest);
          await fs.unlink(siblingSrc);
        } else {
          throw err;
        }
      }
    }
  }
  // Best-effort cleanup of the now-empty draft directory tree.
  await fs.rm(draftDir(draftId), { recursive: true, force: true }).catch(() => {});
  return moved;
}

export { InvalidSlugError };
