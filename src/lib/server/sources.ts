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
import { promises as fs, readdirSync } from 'node:fs';
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

/** List existing source filenames in a directory. Returns [] if the dir
 *  doesn't exist yet. */
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
  }
  // Best-effort cleanup of the now-empty draft directory tree.
  await fs.rm(draftDir(draftId), { recursive: true, force: true }).catch(() => {});
  return moved;
}

export { InvalidSlugError };
