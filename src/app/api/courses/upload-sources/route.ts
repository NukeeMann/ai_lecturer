import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_EXTENSIONS,
  EXTRACTED_DIRNAME,
  InvalidDraftIdError,
  MAX_FILE_SIZE_BYTES,
  MEDIA_EXTENSIONS,
  StoredSourceFile,
  assertSafeDraftId,
  courseSourcesDir,
  draftSourcesDir,
  extractedSiblingPath,
  formatBytes,
  listSourceFilenames,
  makeDraftId,
  maxUploadSizeForExtension,
  sanitizeFilename,
  validateUpload,
  withCollisionSuffix,
} from '@/lib/server/sources';
import { extractDocxToMarkdown } from '@/lib/server/docx';
import { extractPdfToMarkdown } from '@/lib/server/pdf';
import { extractPptxToMarkdown } from '@/lib/server/pptx';
import {
  readTranscriptStatus,
  startMediaTranscription,
} from '@/lib/server/media';
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
    const ext = path.extname(finalName).toLowerCase();
    const destPath = path.join(target.targetDir, finalName);
    const buf = Buffer.from(await file.arrayBuffer());
    // Defensive: re-check size after reading the buffer in case the
    // multipart layer fed us a truncated file.length but a fuller body. The
    // cap is per-extension — media files (US-214) allow a larger body.
    const sizeCap = maxUploadSizeForExtension(ext);
    if (buf.byteLength > sizeCap) {
      rejected.push({
        name: file.name,
        reason: `File too large (${formatBytes(buf.byteLength)} > ${formatBytes(sizeCap)})`,
      });
      continue;
    }
    await fs.writeFile(destPath, buf);
    existing.add(finalName);
    const storedEntry: StoredSourceFile = {
      originalName: file.name,
      sanitizedName: finalName,
      size: buf.byteLength,
      type: file.type ?? '',
    };
    // US-214: kick off local whisper.cpp transcription for audio/video. The
    // marker is written synchronously (so an immediate GET sees
    // `transcribing`) but the transcription itself runs in the background and
    // does NOT block this response — a long .mp4 would otherwise hang the
    // upload. Missing whisper/ffmpeg is folded into a `failed` status, never
    // an upload error.
    if (MEDIA_EXTENSIONS.has(ext)) {
      await startMediaTranscription(destPath);
      storedEntry.transcriptionStatus = 'transcribing';
    }
    stored.push(storedEntry);
    // US-124: pre-extract .docx to a markdown sibling under .extracted/ so
    // the curriculum/lesson generation prompts can point Claude Code's Read
    // tool at a file format it can actually parse. Failures here NEVER
    // block the original upload — the docx file itself is already on disk
    // and we still return 201 for it; the extractor's reason is only logged
    // server-side.
    if (path.extname(finalName).toLowerCase() === '.docx') {
      const sibling = extractedSiblingPath(destPath);
      const result = await extractDocxToMarkdown(destPath, sibling);
      if (!result.ok) {
        console.warn(
          `[upload-sources] docx extraction failed for ${finalName}: ${result.reason}`,
        );
      }
    }
    // US-127: same pattern for PDFs — pdf-parse does the text extraction
    // (no poppler dependency required at runtime). Failures never block
    // the original upload; the .pdf is already on disk and will fall
    // through to `binary-unsupported` in the prompt loaders.
    if (path.extname(finalName).toLowerCase() === '.pdf') {
      const sibling = extractedSiblingPath(destPath);
      const result = await extractPdfToMarkdown(destPath, sibling);
      if (!result.ok) {
        console.warn(
          `[upload-sources] pdf extraction failed for ${finalName}: ${result.reason}`,
        );
      }
    }
    // US-213: same pattern for PPTX — pure-Node unzipper + slide-XML scan
    // (no new heavy dependency). Failures never block the original upload;
    // the .pptx is already on disk and will fall through to
    // `binary-unsupported` in the prompt loaders.
    if (path.extname(finalName).toLowerCase() === '.pptx') {
      const sibling = extractedSiblingPath(destPath);
      const result = await extractPptxToMarkdown(destPath, sibling);
      if (!result.ok) {
        console.warn(
          `[upload-sources] pptx extraction failed for ${finalName}: ${result.reason}`,
        );
      }
    }
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
  // US-124/US-127/US-213/US-214: a deleted .docx, .pdf, .pptx or media file
  // leaves orphaned `.extracted/<name>.md` (transcript) and — for media —
  // `<name>.status.json` (transcription status) siblings behind. Best-effort
  // unlink — a missing sibling is a no-op (idempotent), not an error, since
  // older uploads predate the respective extractors.
  const ext = path.extname(filename).toLowerCase();
  const siblingSuffixes: string[] = [];
  if (ext === '.docx' || ext === '.pdf' || ext === '.pptx') {
    siblingSuffixes.push('.md');
  } else if (MEDIA_EXTENSIONS.has(ext)) {
    siblingSuffixes.push('.md', '.status.json');
  }
  for (const suffix of siblingSuffixes) {
    const sibling = path.join(targetDir, EXTRACTED_DIRNAME, `${filename}${suffix}`);
    try {
      await fs.unlink(sibling);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
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
  const files: {
    sanitizedName: string;
    size: number;
    transcriptionStatus?: 'transcribing' | 'done' | 'failed';
    transcriptionReason?: string;
  }[] = [];
  for (const name of names) {
    const absPath = path.join(targetDir, name);
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) continue;
      const entry: (typeof files)[number] = { sanitizedName: name, size: stat.size };
      // US-214: surface the per-file transcription status for audio/video so
      // the wizard can poll `transcribing → done/failed`.
      if (MEDIA_EXTENSIONS.has(path.extname(name).toLowerCase())) {
        const status = await readTranscriptStatus(absPath);
        if (status) {
          entry.transcriptionStatus = status.status;
          if (status.reason) entry.transcriptionReason = status.reason;
        }
      }
      files.push(entry);
    } catch {
      /* skip */
    }
  }
  return NextResponse.json({ files });
}
