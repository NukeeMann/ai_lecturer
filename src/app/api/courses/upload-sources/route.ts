import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_EXTENSIONS,
  InvalidDraftIdError,
  MAX_FILE_SIZE_BYTES,
  StoredSourceFile,
  assertSafeDraftId,
  courseSourcesDir,
  draftSourcesDir,
  formatBytes,
  listSourceFilenames,
  makeDraftId,
  sanitizeFilename,
  validateUpload,
  withCollisionSuffix,
} from '@/lib/server/sources';
import { InvalidSlugError, assertSafeSlug, courseDir } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

// Next 16 doesn't enforce a default body size limit on App Router routes,
// but we still gate per-file size in `validateUpload`.

interface UploadResponse {
  draftId?: string;
  slug?: string;
  files: StoredSourceFile[];
  rejected: { name: string; reason: string }[];
  limits: { maxFileSizeBytes: number; maxFileSizeLabel: string; allowedExtensions: string[] };
}

function resolveTarget(form: FormData): {
  ok: true;
  draftId?: string;
  slug?: string;
  targetDir: string;
} | { ok: false; status: number; error: string } {
  const slugField = form.get('slug');
  const draftIdField = form.get('draftId');
  if (typeof slugField === 'string' && slugField.length > 0) {
    try {
      assertSafeSlug(slugField);
    } catch (err) {
      if (err instanceof InvalidSlugError) {
        return { ok: false, status: 400, error: err.message };
      }
      throw err;
    }
    return { ok: true, slug: slugField, targetDir: courseSourcesDir(slugField) };
  }
  let draftId: string;
  if (typeof draftIdField === 'string' && draftIdField.length > 0) {
    try {
      assertSafeDraftId(draftIdField);
    } catch (err) {
      if (err instanceof InvalidDraftIdError) {
        return { ok: false, status: 400, error: err.message };
      }
      throw err;
    }
    draftId = draftIdField;
  } else {
    draftId = makeDraftId();
  }
  return { ok: true, draftId, targetDir: draftSourcesDir(draftId) };
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data body' },
      { status: 400 },
    );
  }

  const target = resolveTarget(form);
  if (!target.ok) {
    return NextResponse.json({ error: target.error }, { status: target.status });
  }

  // Collect every form field that looks like a file. Browsers post each
  // <input type="file" multiple> file under the same field name (e.g.
  // "files"); we accept both "files" and "file" for flexibility.
  const fileFields: File[] = [];
  for (const key of ['files', 'file']) {
    for (const value of form.getAll(key)) {
      if (value instanceof File) fileFields.push(value);
    }
  }
  if (fileFields.length === 0) {
    return NextResponse.json(
      { error: 'No files in form data — expected "files" field' },
      { status: 400 },
    );
  }

  await fs.mkdir(target.targetDir, { recursive: true });
  const stored: StoredSourceFile[] = [];
  const rejected: { name: string; reason: string }[] = [];
  // Read once per request rather than per-file: the directory is
  // single-writer (this route, no concurrent uploads to the same target
  // expected) and we update the working set in-memory as we write.
  const existing = new Set(await listSourceFilenames(target.targetDir));

  for (const file of fileFields) {
    const v = validateUpload(file.name, file.type ?? '', file.size);
    if (!v.ok) {
      rejected.push({ name: file.name, reason: v.reason });
      continue;
    }
    const finalName = withCollisionSuffix(v.sanitized, existing);
    const destPath = path.join(target.targetDir, finalName);
    const buf = Buffer.from(await file.arrayBuffer());
    // Defensive: re-check size after reading the buffer in case the
    // multipart layer fed us a truncated file.length but a fuller body.
    if (buf.byteLength > MAX_FILE_SIZE_BYTES) {
      rejected.push({
        name: file.name,
        reason: `File too large (${formatBytes(buf.byteLength)} > ${formatBytes(MAX_FILE_SIZE_BYTES)})`,
      });
      continue;
    }
    await fs.writeFile(destPath, buf);
    existing.add(finalName);
    stored.push({
      originalName: file.name,
      sanitizedName: finalName,
      size: buf.byteLength,
      type: file.type ?? '',
    });
  }

  const body: UploadResponse = {
    files: stored,
    rejected,
    limits: {
      maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
      maxFileSizeLabel: formatBytes(MAX_FILE_SIZE_BYTES),
      allowedExtensions: [...ALLOWED_EXTENSIONS].sort(),
    },
  };
  if (target.draftId) body.draftId = target.draftId;
  if (target.slug) body.slug = target.slug;

  // Status 201 if at least one file landed, 400 if every file was
  // rejected (callers want a hard error if their entire upload failed).
  const status = stored.length > 0 ? 201 : 400;
  return NextResponse.json(body, { status });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const draftId = url.searchParams.get('draftId');
  const filename = url.searchParams.get('filename');
  if (!filename) {
    return NextResponse.json({ error: 'Missing filename query param' }, { status: 400 });
  }
  // Re-sanitise: only allow names whose basename + extension would have
  // been accepted by an earlier POST. This blocks `../etc/passwd`,
  // hidden-file names, and anything outside the allow-list.
  const sanitized = sanitizeFilename(filename);
  if (!sanitized || sanitized !== filename) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }
  let targetDir: string;
  if (slug) {
    try {
      assertSafeSlug(slug);
      // Ensure the course actually exists — surfacing 404 here means the
      // UI can distinguish "you mistyped a slug" from "the file isn't
      // there" without leaking presence information.
      await fs.access(courseDir(slug));
    } catch (err) {
      if (err instanceof InvalidSlugError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }
      throw err;
    }
    targetDir = courseSourcesDir(slug);
  } else if (draftId) {
    try {
      assertSafeDraftId(draftId);
    } catch (err) {
      if (err instanceof InvalidDraftIdError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    targetDir = draftSourcesDir(draftId);
  } else {
    return NextResponse.json(
      { error: 'Missing slug or draftId query param' },
      { status: 400 },
    );
  }

  const filePath = path.join(targetDir, filename);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const draftId = url.searchParams.get('draftId');
  let targetDir: string;
  if (slug) {
    try {
      assertSafeSlug(slug);
    } catch (err) {
      if (err instanceof InvalidSlugError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    targetDir = courseSourcesDir(slug);
  } else if (draftId) {
    try {
      assertSafeDraftId(draftId);
    } catch (err) {
      if (err instanceof InvalidDraftIdError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    targetDir = draftSourcesDir(draftId);
  } else {
    return NextResponse.json(
      { error: 'Missing slug or draftId query param' },
      { status: 400 },
    );
  }
  const names = await listSourceFilenames(targetDir);
  const files: { sanitizedName: string; size: number }[] = [];
  for (const name of names) {
    try {
      const stat = await fs.stat(path.join(targetDir, name));
      if (stat.isFile()) files.push({ sanitizedName: name, size: stat.size });
    } catch {
      /* skip */
    }
  }
  return NextResponse.json({ files });
}
