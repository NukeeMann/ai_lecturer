// US-151: course ZIP import.
//
// POST /api/courses/import (multipart/form-data; field name `file`)
//   200 { slug, lessonCount } — folder moved into /courses/<slug>/.
//   400 { error: 'invalid-archive', reason } — reason is one of:
//        'not-zip' | 'bad-structure' | 'invalid-course-json' | 'invalid-lesson-json'.
//   409 { error: 'slug-exists', existingSlug } — /courses/<slug>/ already
//        exists locally (NO auto-rename in this story).
//
// Security: ZIP-slip protection (every entry stays within the temp
// extraction dir), symlink rejection, total uncompressed size cap of 500 MB
// (zip-bomb mitigation). Upload size is capped at 100 MB at the entry door.

import { promises as fs, createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import unzipper from 'unzipper';

import { CourseSchema } from '@/lib/schemas/course';
import { LessonSchema } from '@/lib/schemas/lesson';
import { courseDir } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const SLUG_PATTERN = /^[a-z0-9-]+$/;

type Reason =
  | 'not-zip'
  | 'bad-structure'
  | 'invalid-course-json'
  | 'invalid-lesson-json';

function bad(reason: Reason, detail?: string): NextResponse {
  return NextResponse.json(
    { error: 'invalid-archive', reason, detail },
    { status: 400 },
  );
}

// Walk the central directory entries, validate ZIP-slip / symlink / size /
// slug invariants. Returns the single top-level slug on success.
function inspectEntries(
  files: unzipper.File[],
): { slug: string } | { reason: Reason; detail: string } {
  if (files.length === 0) {
    return { reason: 'bad-structure', detail: 'ZIP is empty' };
  }
  let totalUncompressed = 0;
  const topLevels = new Set<string>();
  for (const entry of files) {
    // Reject symlinks via Unix mode bits in externalFileAttributes.
    const unixMode = (entry.externalFileAttributes ?? 0) >>> 16;
    if ((unixMode & 0o170000) === 0o120000) {
      return { reason: 'bad-structure', detail: `Symlink rejected: ${entry.path}` };
    }

    totalUncompressed += entry.uncompressedSize ?? 0;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      return {
        reason: 'bad-structure',
        detail: 'Total uncompressed size exceeds 500 MB',
      };
    }

    const rawPath = entry.path;
    if (
      typeof rawPath !== 'string' ||
      rawPath.length === 0 ||
      rawPath.startsWith('/') ||
      rawPath.includes('\\') ||
      rawPath.includes('\0')
    ) {
      return { reason: 'bad-structure', detail: `Invalid entry path: ${rawPath}` };
    }
    const parts = rawPath.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) {
      return { reason: 'bad-structure', detail: 'Empty entry path' };
    }
    if (parts.some((p) => p === '..' || p === '.')) {
      return {
        reason: 'bad-structure',
        detail: `Path traversal rejected: ${rawPath}`,
      };
    }
    topLevels.add(parts[0]);
  }
  if (topLevels.size !== 1) {
    return {
      reason: 'bad-structure',
      detail: `Expected a single top-level folder, found ${topLevels.size}`,
    };
  }
  const slug = [...topLevels][0];
  if (!SLUG_PATTERN.test(slug)) {
    return {
      reason: 'bad-structure',
      detail: `Top-level folder "${slug}" must match /^[a-z0-9-]+$/`,
    };
  }
  return { slug };
}

async function extractEntries(
  files: unzipper.File[],
  extractRoot: string,
): Promise<{ ok: true } | { ok: false; reason: Reason; detail: string }> {
  const extractRootResolved = path.resolve(extractRoot);
  for (const entry of files) {
    const targetPath = path.resolve(extractRoot, entry.path);
    const rel = path.relative(extractRootResolved, targetPath);
    // Belt-and-braces: even if the central-directory inspection already
    // rejected '..' segments, the resolved path must still land inside the
    // extraction root. Any non-empty rel starting with '..' or absolute is a
    // ZIP-slip attempt.
    if (
      rel === '..' ||
      rel.startsWith(`..${path.sep}`) ||
      path.isAbsolute(rel)
    ) {
      return {
        ok: false,
        reason: 'bad-structure',
        detail: `ZIP-slip rejected: ${entry.path}`,
      };
    }
    if (entry.type === 'Directory') {
      await fs.mkdir(targetPath, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(targetPath);
      const src = entry.stream();
      src.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      src.pipe(out);
    });
  }
  return { ok: true };
}

async function rmrfSafe(target: string): Promise<void> {
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

export async function POST(req: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: 'multipart-parse-failed', detail: String(err) },
      { status: 400 },
    );
  }

  const fileEntry = formData.get('file');
  if (!(fileEntry instanceof File)) {
    return bad('not-zip', 'Missing file field');
  }
  const fname = (fileEntry.name ?? '').toString();
  if (!fname.toLowerCase().endsWith('.zip')) {
    return bad('not-zip', `Filename "${fname}" is not a .zip`);
  }
  if (fileEntry.size > MAX_UPLOAD_BYTES) {
    return bad('bad-structure', 'Upload exceeds 100 MB');
  }

  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ai-lecturer-import-'),
  );
  const zipPath = path.join(tmpRoot, 'upload.zip');
  const extractRoot = path.join(tmpRoot, 'extract');

  try {
    await fs.writeFile(zipPath, Buffer.from(await fileEntry.arrayBuffer()));

    let directory: unzipper.CentralDirectory;
    try {
      directory = await unzipper.Open.file(zipPath);
    } catch (err) {
      await rmrfSafe(tmpRoot);
      return bad('not-zip', `Not a valid ZIP archive: ${String(err)}`);
    }

    const inspection = inspectEntries(directory.files);
    if ('reason' in inspection) {
      await rmrfSafe(tmpRoot);
      return bad(inspection.reason, inspection.detail);
    }
    const { slug } = inspection;

    await fs.mkdir(extractRoot, { recursive: true });
    const extracted = await extractEntries(directory.files, extractRoot);
    if (!extracted.ok) {
      await rmrfSafe(tmpRoot);
      return bad(extracted.reason, extracted.detail);
    }

    // Validate course.json
    const coursePath = path.join(extractRoot, slug, 'course.json');
    let courseRaw: string;
    try {
      courseRaw = await fs.readFile(coursePath, 'utf8');
    } catch {
      await rmrfSafe(tmpRoot);
      return bad('bad-structure', `Missing course.json under ${slug}/`);
    }
    let courseJson: unknown;
    try {
      courseJson = JSON.parse(courseRaw);
    } catch (err) {
      await rmrfSafe(tmpRoot);
      return bad('invalid-course-json', `course.json is not valid JSON: ${String(err)}`);
    }
    const courseParsed = CourseSchema.safeParse(courseJson);
    if (!courseParsed.success) {
      await rmrfSafe(tmpRoot);
      return bad('invalid-course-json', courseParsed.error.message);
    }
    // Sanity: course.json's slug should match the folder slug.
    if (courseParsed.data.slug !== slug) {
      await rmrfSafe(tmpRoot);
      return bad(
        'invalid-course-json',
        `course.json slug "${courseParsed.data.slug}" does not match folder "${slug}"`,
      );
    }

    // Validate any lesson JSONs.
    const lessonsDir = path.join(extractRoot, slug, 'lessons');
    let lessonCount = 0;
    let lessonEntries: import('node:fs').Dirent[] = [];
    try {
      lessonEntries = await fs.readdir(lessonsDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    for (const lessonEntry of lessonEntries) {
      if (!lessonEntry.isFile()) continue;
      if (!lessonEntry.name.endsWith('.json')) continue;
      const lessonPath = path.join(lessonsDir, lessonEntry.name);
      let lessonRaw: string;
      try {
        lessonRaw = await fs.readFile(lessonPath, 'utf8');
      } catch (err) {
        await rmrfSafe(tmpRoot);
        return bad(
          'invalid-lesson-json',
          `Failed to read ${lessonEntry.name}: ${String(err)}`,
        );
      }
      let lessonJson: unknown;
      try {
        lessonJson = JSON.parse(lessonRaw);
      } catch (err) {
        await rmrfSafe(tmpRoot);
        return bad(
          'invalid-lesson-json',
          `${lessonEntry.name}: ${String(err)}`,
        );
      }
      const lessonParsed = LessonSchema.safeParse(lessonJson);
      if (!lessonParsed.success) {
        await rmrfSafe(tmpRoot);
        return bad(
          'invalid-lesson-json',
          `${lessonEntry.name}: ${lessonParsed.error.message}`,
        );
      }
      lessonCount += 1;
    }

    // Conflict check: target directory must not exist.
    const destDir = courseDir(slug);
    try {
      await fs.access(destDir);
      await rmrfSafe(tmpRoot);
      return NextResponse.json(
        { error: 'slug-exists', existingSlug: slug },
        { status: 409 },
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        await rmrfSafe(tmpRoot);
        return NextResponse.json(
          { error: 'fs-error', detail: String(err) },
          { status: 500 },
        );
      }
    }

    // Move into place — fs.rename, with cross-device fallback (EXDEV).
    const sourceDir = path.join(extractRoot, slug);
    await fs.mkdir(path.dirname(destDir), { recursive: true });
    try {
      await fs.rename(sourceDir, destDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        await fs.cp(sourceDir, destDir, { recursive: true });
        await fs.rm(sourceDir, { recursive: true, force: true });
      } else {
        await rmrfSafe(tmpRoot);
        return NextResponse.json(
          { error: 'fs-error', detail: String(err) },
          { status: 500 },
        );
      }
    }
    await rmrfSafe(tmpRoot);

    return NextResponse.json(
      { slug, lessonCount, title: courseParsed.data.title },
      { status: 200 },
    );
  } catch (err) {
    await rmrfSafe(tmpRoot);
    return NextResponse.json(
      { error: 'unexpected', detail: String(err) },
      { status: 500 },
    );
  }
}
