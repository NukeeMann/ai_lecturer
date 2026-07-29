import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  ALLOWED_EXTENSIONS,
  DEFAULT_PER_FILE_CHAR_CAP,
  DEFAULT_TOTAL_CHAR_BUDGET,
  EXTRACTED_DIRNAME,
  MAX_FILE_SIZE_BYTES,
  MAX_MEDIA_FILE_SIZE_BYTES,
  MEDIA_EXTENSIONS,
  assertSafeDraftId,
  maxUploadSizeForExtension,
  draftDir,
  draftSourcesDir,
  courseSourcesDir,
  extractedSiblingPath,
  listCourseSourceFilesSync,
  loadStagedSourcesForPrompt,
  makeDraftId,
  moveDraftSourcesToCourse,
  resolveSourcePathForPrompt,
  sanitizeFilename,
  validateUpload,
  withCollisionSuffix,
} from './sources';

let coursesRoot: string;

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-sources-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
});

afterEach(async () => {
  delete process.env.COURSES_ROOT_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
});

describe('sanitizeFilename', () => {
  it('preserves a normal allow-listed name', () => {
    expect(sanitizeFilename('lecture-01.pdf')).toBe('lecture-01.pdf');
    expect(sanitizeFilename('My Slides.pptx')).toBe('My Slides.pptx');
    expect(sanitizeFilename('notes_with_underscores.txt')).toBe('notes_with_underscores.txt');
  });

  it('strips path components', () => {
    expect(sanitizeFilename('/etc/passwd.txt')).toBe('passwd.txt');
    expect(sanitizeFilename('..\\winnt\\hosts.txt')).toBe('hosts.txt');
    expect(sanitizeFilename('subdir/file.pdf')).toBe('file.pdf');
  });

  it('rejects unsupported extensions', () => {
    expect(sanitizeFilename('script.exe')).toBeNull();
    expect(sanitizeFilename('image.png')).toBeNull();
    expect(sanitizeFilename('archive.zip')).toBeNull();
  });

  it('accepts .md (US-215 YouTube transcript) as a managed source name', () => {
    // Not uploadable (no MIME mapping), but a valid /sources/ basename so the
    // YouTube transcript file can be deleted / promoted at finalisation.
    expect(sanitizeFilename('youtube-abcdefghijk.md')).toBe('youtube-abcdefghijk.md');
  });

  it('rejects empty / dot-only / over-long names', () => {
    expect(sanitizeFilename('')).toBeNull();
    expect(sanitizeFilename('....')).toBeNull();
    expect(sanitizeFilename('a'.repeat(300) + '.pdf')).toBeNull();
  });

  it('strips control chars and forbidden Windows chars', () => {
    expect(sanitizeFilename('foo\x00bar.pdf')).toBe('foobar.pdf');
    expect(sanitizeFilename('a<b>c:d.txt')).toBe('abcd.txt');
  });

  it('strips leading dots so we never write a hidden file', () => {
    expect(sanitizeFilename('.hidden.pdf')).toBe('hidden.pdf');
    expect(sanitizeFilename('..../.hidden.pdf')).toBe('hidden.pdf');
  });
});

describe('withCollisionSuffix', () => {
  it('returns the input when no collision', () => {
    expect(withCollisionSuffix('a.pdf', new Set())).toBe('a.pdf');
  });

  it('appends "(2)" before the extension on first collision', () => {
    expect(withCollisionSuffix('a.pdf', new Set(['a.pdf']))).toBe('a (2).pdf');
  });

  it('keeps incrementing on subsequent collisions', () => {
    const set = new Set(['a.pdf', 'a (2).pdf', 'a (3).pdf']);
    expect(withCollisionSuffix('a.pdf', set)).toBe('a (4).pdf');
  });

  it('handles names without an extension', () => {
    expect(withCollisionSuffix('README', new Set(['README']))).toBe('README (2)');
  });
});

describe('validateUpload', () => {
  it('accepts a normal pdf', () => {
    const r = validateUpload('lecture.pdf', 'application/pdf', 1024);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sanitized).toBe('lecture.pdf');
  });

  it('accepts a json question bank', () => {
    const r = validateUpload('bank.json', 'application/json', 100);
    expect(r.ok).toBe(true);
  });

  it('accepts pptx with the long mimetype', () => {
    const r = validateUpload(
      'deck.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      2048,
    );
    expect(r.ok).toBe(true);
  });

  it('accepts the empty / octet-stream MIME fallback when extension is allowed', () => {
    expect(validateUpload('a.docx', '', 100).ok).toBe(true);
    expect(validateUpload('a.docx', 'application/octet-stream', 100).ok).toBe(true);
  });

  it('rejects mismatched MIME', () => {
    const r = validateUpload('a.pdf', 'text/html', 100);
    expect(r.ok).toBe(false);
  });

  it('rejects oversized files', () => {
    const r = validateUpload('a.pdf', 'application/pdf', MAX_FILE_SIZE_BYTES + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too large/i);
  });

  it('rejects unknown extensions', () => {
    const r = validateUpload('hack.exe', 'application/octet-stream', 100);
    expect(r.ok).toBe(false);
  });

  it('rejects path-traversal filenames', () => {
    const r = validateUpload('../../etc/passwd.txt', 'text/plain', 100);
    // Path stripped → "passwd.txt" — accepted. The danger isn't here, it's
    // in how callers join: validateUpload returns the basename only.
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sanitized).toBe('passwd.txt');
  });
});

describe('ALLOWED_EXTENSIONS', () => {
  it('matches the AC list exactly (docs + US-214 media)', () => {
    expect([...ALLOWED_EXTENSIONS].sort()).toEqual([
      '.docx',
      '.json',
      '.m4a',
      '.mp3',
      '.mp4',
      '.pdf',
      '.pptx',
      '.txt',
      '.wav',
    ]);
  });
});

describe('validateUpload — media (US-214)', () => {
  it('accepts the four media extensions with their MIME types', () => {
    expect(validateUpload('a.mp3', 'audio/mpeg', 100).ok).toBe(true);
    expect(validateUpload('a.wav', 'audio/wav', 100).ok).toBe(true);
    expect(validateUpload('a.m4a', 'audio/x-m4a', 100).ok).toBe(true);
    expect(validateUpload('lecture.mp4', 'video/mp4', 100).ok).toBe(true);
  });

  it('accepts the octet-stream fallback for media', () => {
    expect(validateUpload('a.mp4', 'application/octet-stream', 100).ok).toBe(true);
    expect(validateUpload('a.mp3', '', 100).ok).toBe(true);
  });

  it('applies the larger media size cap', () => {
    // 200 MB .mp4 must be accepted (AC: at least 200 MB), but a 200 MB .pdf
    // is rejected (document cap is 50 MiB).
    const twoHundredMB = 200 * 1024 * 1024;
    expect(validateUpload('lecture.mp4', 'video/mp4', twoHundredMB).ok).toBe(true);
    const docResult = validateUpload('big.pdf', 'application/pdf', twoHundredMB);
    expect(docResult.ok).toBe(false);
  });

  it('still rejects media above the media cap', () => {
    const r = validateUpload('huge.mp4', 'video/mp4', MAX_MEDIA_FILE_SIZE_BYTES + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too large/i);
  });
});

describe('maxUploadSizeForExtension (US-214)', () => {
  it('returns the media cap for media extensions, doc cap otherwise', () => {
    expect(MEDIA_EXTENSIONS.has('.mp4')).toBe(true);
    expect(maxUploadSizeForExtension('.mp4')).toBe(MAX_MEDIA_FILE_SIZE_BYTES);
    expect(maxUploadSizeForExtension('.MP3')).toBe(MAX_MEDIA_FILE_SIZE_BYTES);
    expect(maxUploadSizeForExtension('.pdf')).toBe(MAX_FILE_SIZE_BYTES);
    expect(MAX_MEDIA_FILE_SIZE_BYTES).toBeGreaterThanOrEqual(200 * 1024 * 1024);
  });
});

describe('assertSafeDraftId', () => {
  it('accepts a uuid', () => {
    expect(() => assertSafeDraftId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).not.toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => assertSafeDraftId('../foo')).toThrow();
    expect(() => assertSafeDraftId('foo/bar')).toThrow();
    expect(() => assertSafeDraftId('foo\\bar')).toThrow();
  });

  it('rejects empty / too-short / too-long', () => {
    expect(() => assertSafeDraftId('')).toThrow();
    expect(() => assertSafeDraftId('abc')).toThrow();
    expect(() => assertSafeDraftId('a'.repeat(100))).toThrow();
  });

  it('makeDraftId() produces an id that survives assertSafeDraftId', () => {
    const id = makeDraftId();
    expect(() => assertSafeDraftId(id)).not.toThrow();
  });
});

describe('moveDraftSourcesToCourse', () => {
  it('is a no-op when the draft directory does not exist', async () => {
    const id = makeDraftId();
    await expect(moveDraftSourcesToCourse(id, 'algebra')).resolves.toEqual([]);
  });

  it('moves files into <slug>/sources and cleans up the draft', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'a.pdf'), 'hello-pdf');
    await fs.writeFile(path.join(src, 'notes.txt'), 'hello-txt');

    const moved = await moveDraftSourcesToCourse(id, 'algebra');
    expect(new Set(moved)).toEqual(new Set(['a.pdf', 'notes.txt']));

    const courseDir = courseSourcesDir('algebra');
    const after = await fs.readdir(courseDir);
    expect(new Set(after)).toEqual(new Set(['a.pdf', 'notes.txt']));
    expect(await fs.readFile(path.join(courseDir, 'a.pdf'), 'utf8')).toBe('hello-pdf');

    // Draft dir should be gone.
    await expect(fs.access(draftDir(id))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('appends collision suffixes when target dir already has the same name', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    const dst = courseSourcesDir('algebra');
    await fs.mkdir(src, { recursive: true });
    await fs.mkdir(dst, { recursive: true });
    await fs.writeFile(path.join(dst, 'a.pdf'), 'pre-existing');
    await fs.writeFile(path.join(src, 'a.pdf'), 'from-draft');

    const moved = await moveDraftSourcesToCourse(id, 'algebra');
    expect(moved).toEqual(['a (2).pdf']);
    expect(await fs.readFile(path.join(dst, 'a.pdf'), 'utf8')).toBe('pre-existing');
    expect(await fs.readFile(path.join(dst, 'a (2).pdf'), 'utf8')).toBe('from-draft');
  });

  it('skips subdirectories and files with bad extensions', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(src, { recursive: true });
    await fs.mkdir(path.join(src, 'nested'), { recursive: true });
    await fs.writeFile(path.join(src, 'good.pdf'), 'x');
    await fs.writeFile(path.join(src, 'evil.exe'), 'x');

    const moved = await moveDraftSourcesToCourse(id, 'algebra');
    expect(moved).toEqual(['good.pdf']);
  });
});

describe('listCourseSourceFilesSync (US-104)', () => {
  it('returns [] when /courses/<slug>/sources/ is absent', () => {
    expect(listCourseSourceFilesSync('does-not-exist')).toEqual([]);
  });

  it('returns [] when the sources directory exists but is empty', async () => {
    await fs.mkdir(courseSourcesDir('demo'), { recursive: true });
    expect(listCourseSourceFilesSync('demo')).toEqual([]);
  });

  it('returns absolute, sorted paths for every regular file', async () => {
    const dir = courseSourcesDir('demo');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'zeta.pdf'), 'x');
    await fs.writeFile(path.join(dir, 'alpha.txt'), 'x');
    await fs.writeFile(path.join(dir, 'mid.docx'), 'x');

    const out = listCourseSourceFilesSync('demo');
    expect(out).toEqual([
      path.join(dir, 'alpha.txt'),
      path.join(dir, 'mid.docx'),
      path.join(dir, 'zeta.pdf'),
    ]);
    for (const p of out) {
      expect(path.isAbsolute(p)).toBe(true);
    }
  });

  it('skips subdirectories — only regular files are listed', async () => {
    const dir = courseSourcesDir('demo');
    await fs.mkdir(path.join(dir, 'nested'), { recursive: true });
    await fs.writeFile(path.join(dir, 'real.pdf'), 'x');

    const out = listCourseSourceFilesSync('demo');
    expect(out).toEqual([path.join(dir, 'real.pdf')]);
  });

  it('rejects unsafe slugs', () => {
    expect(() => listCourseSourceFilesSync('../etc')).toThrow(/Invalid slug/i);
    expect(() => listCourseSourceFilesSync('a/b')).toThrow(/Invalid slug/i);
  });
});

describe('extractedSiblingPath (US-124)', () => {
  it('rewrites <dir>/<name>.docx to <dir>/.extracted/<name>.docx.md', () => {
    expect(extractedSiblingPath('/tmp/a/b/notes.docx')).toBe(
      path.join('/tmp/a/b', EXTRACTED_DIRNAME, 'notes.docx.md'),
    );
  });

  it('preserves the full original basename including the extension', () => {
    // Two source uploads with the same stem but different extensions must
    // produce different sibling paths.
    expect(extractedSiblingPath('/tmp/dir/file.docx')).not.toBe(
      extractedSiblingPath('/tmp/dir/file.pdf.docx'),
    );
  });
});

describe('resolveSourcePathForPrompt (US-124)', () => {
  it('returns the original path unchanged for .pdf with no sibling', () => {
    const r = resolveSourcePathForPrompt('/tmp/something/a.pdf');
    expect(r).toEqual({ readPath: '/tmp/something/a.pdf', originalName: 'a.pdf' });
    expect(r.extractedFrom).toBeUndefined();
  });

  it('returns the original path unchanged for .txt and .json', () => {
    expect(resolveSourcePathForPrompt('/tmp/notes.txt').readPath).toBe('/tmp/notes.txt');
    expect(resolveSourcePathForPrompt('/tmp/data.json').readPath).toBe('/tmp/data.json');
  });

  it('returns the original .docx path when no sibling exists yet', () => {
    const docxPath = path.join(coursesRoot, 'demo', 'sources', 'a.docx');
    // Sibling intentionally NOT written.
    const r = resolveSourcePathForPrompt(docxPath);
    expect(r.readPath).toBe(docxPath);
    expect(r.extractedFrom).toBeUndefined();
  });

  it('returns the sibling .md path for .docx when the sibling is on disk', async () => {
    const dir = path.join(coursesRoot, 'demo', 'sources');
    await fs.mkdir(path.join(dir, EXTRACTED_DIRNAME), { recursive: true });
    const docxPath = path.join(dir, 'a.docx');
    const siblingPath = path.join(dir, EXTRACTED_DIRNAME, 'a.docx.md');
    await fs.writeFile(docxPath, 'fake-docx-bytes');
    await fs.writeFile(siblingPath, '# Hello\n');

    const r = resolveSourcePathForPrompt(docxPath);
    expect(r.readPath).toBe(siblingPath);
    expect(r.originalName).toBe('a.docx');
    expect(r.extractedFrom).toBe('a.docx');
  });

  // US-127: same branch shape for .pdf as .docx.
  it('returns the sibling .md path for .pdf when the sibling is on disk', async () => {
    const dir = path.join(coursesRoot, 'demo', 'sources');
    await fs.mkdir(path.join(dir, EXTRACTED_DIRNAME), { recursive: true });
    const pdfPath = path.join(dir, 'a.pdf');
    const siblingPath = path.join(dir, EXTRACTED_DIRNAME, 'a.pdf.md');
    await fs.writeFile(pdfPath, 'fake-pdf-bytes');
    await fs.writeFile(siblingPath, '--- page 1 ---\n\nExtracted body.\n');

    const r = resolveSourcePathForPrompt(pdfPath);
    expect(r.readPath).toBe(siblingPath);
    expect(r.originalName).toBe('a.pdf');
    expect(r.extractedFrom).toBe('a.pdf');
  });

  // US-213: same branch shape for .pptx as .docx / .pdf.
  it('returns the sibling .md path for .pptx when the sibling is on disk', async () => {
    const dir = path.join(coursesRoot, 'demo', 'sources');
    await fs.mkdir(path.join(dir, EXTRACTED_DIRNAME), { recursive: true });
    const pptxPath = path.join(dir, 'a.pptx');
    const siblingPath = path.join(dir, EXTRACTED_DIRNAME, 'a.pptx.md');
    await fs.writeFile(pptxPath, 'fake-pptx-bytes');
    await fs.writeFile(siblingPath, '## Slajd 1\n\nExtracted slide body.\n');

    const r = resolveSourcePathForPrompt(pptxPath);
    expect(r.readPath).toBe(siblingPath);
    expect(r.originalName).toBe('a.pptx');
    expect(r.extractedFrom).toBe('a.pptx');
  });

  it('returns the original .pptx path when no sibling exists yet', () => {
    const pptxPath = path.join(coursesRoot, 'demo', 'sources', 'b.pptx');
    const r = resolveSourcePathForPrompt(pptxPath);
    expect(r.readPath).toBe(pptxPath);
    expect(r.extractedFrom).toBeUndefined();
  });

  // US-214: media transcripts land on the same `.extracted/<name>.md` sibling,
  // so a finished .mp4 transcript resolves like a docx/pdf/pptx extract.
  it('returns the transcript sibling for a media file when it is on disk', async () => {
    const dir = path.join(coursesRoot, 'demo', 'sources');
    await fs.mkdir(path.join(dir, EXTRACTED_DIRNAME), { recursive: true });
    const mediaPath = path.join(dir, 'lecture.mp4');
    const siblingPath = path.join(dir, EXTRACTED_DIRNAME, 'lecture.mp4.md');
    await fs.writeFile(mediaPath, 'fake-video-bytes');
    await fs.writeFile(siblingPath, '# Transkrypcja\n\nSpoken content.\n');

    const r = resolveSourcePathForPrompt(mediaPath);
    expect(r.readPath).toBe(siblingPath);
    expect(r.originalName).toBe('lecture.mp4');
    expect(r.extractedFrom).toBe('lecture.mp4');
  });

  it('returns the original media path when transcription has not produced a sibling', () => {
    const mediaPath = path.join(coursesRoot, 'demo', 'sources', 'pending.mp3');
    const r = resolveSourcePathForPrompt(mediaPath);
    expect(r.readPath).toBe(mediaPath);
    expect(r.extractedFrom).toBeUndefined();
  });
});

describe('moveDraftSourcesToCourse — extracted-sibling propagation (US-124)', () => {
  it('moves a .docx and its .extracted/<name>.md sibling together', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(path.join(src, EXTRACTED_DIRNAME), { recursive: true });
    await fs.writeFile(path.join(src, 'notes.docx'), 'fake-docx-bytes');
    await fs.writeFile(
      path.join(src, EXTRACTED_DIRNAME, 'notes.docx.md'),
      '# Notes\n\nExtracted content.\n',
    );

    const moved = await moveDraftSourcesToCourse(id, 'algebra');
    expect(moved).toEqual(['notes.docx']);

    const dst = courseSourcesDir('algebra');
    expect(await fs.readFile(path.join(dst, 'notes.docx'), 'utf8')).toBe(
      'fake-docx-bytes',
    );
    expect(
      await fs.readFile(path.join(dst, EXTRACTED_DIRNAME, 'notes.docx.md'), 'utf8'),
    ).toBe('# Notes\n\nExtracted content.\n');

    // Source-side sibling cleared up by the draft-dir rm.
    await expect(fs.access(draftDir(id))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the docx and sibling final names in sync under collision suffix', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    const dst = courseSourcesDir('algebra');
    await fs.mkdir(path.join(src, EXTRACTED_DIRNAME), { recursive: true });
    // Pre-existing docx on the destination side forces the collision suffix.
    await fs.mkdir(dst, { recursive: true });
    await fs.writeFile(path.join(dst, 'notes.docx'), 'pre-existing-docx');
    // Draft contains a same-named docx + its sibling.
    await fs.writeFile(path.join(src, 'notes.docx'), 'from-draft-docx');
    await fs.writeFile(
      path.join(src, EXTRACTED_DIRNAME, 'notes.docx.md'),
      'from-draft-md',
    );

    const moved = await moveDraftSourcesToCourse(id, 'algebra');
    expect(moved).toEqual(['notes (2).docx']);

    // Original target file is untouched.
    expect(await fs.readFile(path.join(dst, 'notes.docx'), 'utf8')).toBe(
      'pre-existing-docx',
    );
    // The promoted draft docx + its sibling share the same `(2)` suffix.
    expect(await fs.readFile(path.join(dst, 'notes (2).docx'), 'utf8')).toBe(
      'from-draft-docx',
    );
    expect(
      await fs.readFile(path.join(dst, EXTRACTED_DIRNAME, 'notes (2).docx.md'), 'utf8'),
    ).toBe('from-draft-md');
    // No `notes.docx.md` at the original (un-suffixed) name on the destination.
    await expect(
      fs.access(path.join(dst, EXTRACTED_DIRNAME, 'notes.docx.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('still moves docx files that have no sibling (older uploads)', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'orphan.docx'), 'docx-only');

    const moved = await moveDraftSourcesToCourse(id, 'algebra');
    expect(moved).toEqual(['orphan.docx']);

    const dst = courseSourcesDir('algebra');
    expect(await fs.readFile(path.join(dst, 'orphan.docx'), 'utf8')).toBe('docx-only');
    // No sibling materialised on the destination side.
    await expect(
      fs.access(path.join(dst, EXTRACTED_DIRNAME, 'orphan.docx.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // US-214: a media file carries BOTH a `<name>.md` transcript and a
  // `<name>.status.json` status sidecar — both must ride along on finalise.
  it('moves a media file with its transcript and status siblings', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(path.join(src, EXTRACTED_DIRNAME), { recursive: true });
    await fs.writeFile(path.join(src, 'lecture.mp4'), 'fake-video');
    await fs.writeFile(
      path.join(src, EXTRACTED_DIRNAME, 'lecture.mp4.md'),
      '# Transkrypcja\n\nbody\n',
    );
    await fs.writeFile(
      path.join(src, EXTRACTED_DIRNAME, 'lecture.mp4.status.json'),
      JSON.stringify({ status: 'done', updatedAt: 'now' }),
    );

    const moved = await moveDraftSourcesToCourse(id, 'algebra');
    expect(moved).toEqual(['lecture.mp4']);

    const dst = courseSourcesDir('algebra');
    expect(await fs.readFile(path.join(dst, 'lecture.mp4'), 'utf8')).toBe(
      'fake-video',
    );
    expect(
      await fs.readFile(path.join(dst, EXTRACTED_DIRNAME, 'lecture.mp4.md'), 'utf8'),
    ).toContain('Transkrypcja');
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(dst, EXTRACTED_DIRNAME, 'lecture.mp4.status.json'),
          'utf8',
        ),
      ).status,
    ).toBe('done');
  });

  // US-127: the move logic is generic over `<name>.md` siblings, so a .pdf
  // with its sibling rides through with the same collision-suffix
  // synchronisation we already prove for .docx above.
  it('keeps the pdf and sibling final names in sync under collision suffix', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    const dst = courseSourcesDir('algebra');
    await fs.mkdir(path.join(src, EXTRACTED_DIRNAME), { recursive: true });
    await fs.mkdir(dst, { recursive: true });
    // Pre-existing pdf on the destination side forces the collision suffix.
    await fs.writeFile(path.join(dst, 'notes.pdf'), 'pre-existing-pdf');
    await fs.writeFile(path.join(src, 'notes.pdf'), 'from-draft-pdf');
    await fs.writeFile(
      path.join(src, EXTRACTED_DIRNAME, 'notes.pdf.md'),
      'from-draft-pdf-md',
    );

    const moved = await moveDraftSourcesToCourse(id, 'algebra');
    expect(moved).toEqual(['notes (2).pdf']);

    expect(await fs.readFile(path.join(dst, 'notes.pdf'), 'utf8')).toBe(
      'pre-existing-pdf',
    );
    expect(await fs.readFile(path.join(dst, 'notes (2).pdf'), 'utf8')).toBe(
      'from-draft-pdf',
    );
    expect(
      await fs.readFile(path.join(dst, EXTRACTED_DIRNAME, 'notes (2).pdf.md'), 'utf8'),
    ).toBe('from-draft-pdf-md');
    await expect(
      fs.access(path.join(dst, EXTRACTED_DIRNAME, 'notes.pdf.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('loadStagedSourcesForPrompt default budgets (US-128)', () => {
  it('exposes 150k total / 60k per-file as the documented defaults', () => {
    expect(DEFAULT_TOTAL_CHAR_BUDGET).toBe(150_000);
    expect(DEFAULT_PER_FILE_CHAR_CAP).toBe(60_000);
  });
});

describe('loadStagedSourcesForPrompt (US-125)', () => {
  it('returns [] when the draft directory does not exist', () => {
    const id = makeDraftId();
    expect(loadStagedSourcesForPrompt(id)).toEqual([]);
  });

  it('rejects path-traversal draft ids before touching the filesystem', () => {
    expect(() => loadStagedSourcesForPrompt('../foo')).toThrow(/Invalid draftId/);
    expect(() => loadStagedSourcesForPrompt('a/b')).toThrow(/Invalid draftId/);
  });

  it('reads .txt + .docx (via .extracted sibling) + .pdf in lexicographic order', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(path.join(src, EXTRACTED_DIRNAME), { recursive: true });
    await fs.writeFile(path.join(src, 'a.txt'), 'plain text body');
    await fs.writeFile(path.join(src, 'm.docx'), 'binary-docx');
    await fs.writeFile(
      path.join(src, EXTRACTED_DIRNAME, 'm.docx.md'),
      '# Heading\n\nExtracted body.',
    );
    await fs.writeFile(path.join(src, 'z.pdf'), 'binary-pdf');

    const out = loadStagedSourcesForPrompt(id);
    expect(out).toHaveLength(3);

    // Lexicographic: a.txt → m.docx → z.pdf
    expect(out[0]).toEqual({
      kind: 'text',
      originalName: 'a.txt',
      content: 'plain text body',
    });
    expect(out[1]).toEqual({
      kind: 'text',
      originalName: 'm.docx',
      extractedFrom: 'm.docx',
      content: '# Heading\n\nExtracted body.',
    });
    expect(out[2]).toEqual({
      kind: 'binary-unsupported',
      originalName: 'z.pdf',
    });
  });

  // US-127: a .pdf with its `.extracted/<name>.pdf.md` sibling on disk reads
  // as text and carries `extractedFrom`; a .pdf without one stays
  // `binary-unsupported` so the prompt still mentions the upload.
  it('returns kind:text for a .pdf with sibling, binary-unsupported without', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(path.join(src, EXTRACTED_DIRNAME), { recursive: true });
    await fs.writeFile(path.join(src, 'with-sibling.pdf'), 'binary-pdf-bytes');
    await fs.writeFile(
      path.join(src, EXTRACTED_DIRNAME, 'with-sibling.pdf.md'),
      '--- page 1 ---\n\nExtracted pdf body.',
    );
    await fs.writeFile(path.join(src, 'without-sibling.pdf'), 'binary-pdf-bytes');

    const out = loadStagedSourcesForPrompt(id);
    // Lexicographic: with-sibling.pdf → without-sibling.pdf
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      kind: 'text',
      originalName: 'with-sibling.pdf',
      extractedFrom: 'with-sibling.pdf',
      content: '--- page 1 ---\n\nExtracted pdf body.',
    });
    expect(out[1]).toEqual({
      kind: 'binary-unsupported',
      originalName: 'without-sibling.pdf',
    });
  });

  // US-213: a .pptx with its `.extracted/<name>.pptx.md` sibling on disk reads
  // as text and carries `extractedFrom`; a .pptx without one stays
  // `binary-unsupported` so the prompt still mentions the upload (extractor
  // failure or pre-fix upload).
  it('returns kind:text for a .pptx with sibling, binary-unsupported without', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(path.join(src, EXTRACTED_DIRNAME), { recursive: true });
    await fs.writeFile(path.join(src, 'with-sibling.pptx'), 'binary-pptx-bytes');
    await fs.writeFile(
      path.join(src, EXTRACTED_DIRNAME, 'with-sibling.pptx.md'),
      '## Slajd 1\n\nExtracted slide body.',
    );
    await fs.writeFile(path.join(src, 'without-sibling.pptx'), 'binary-pptx-bytes');

    const out = loadStagedSourcesForPrompt(id);
    // Lexicographic: with-sibling.pptx → without-sibling.pptx
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      kind: 'text',
      originalName: 'with-sibling.pptx',
      extractedFrom: 'with-sibling.pptx',
      content: '## Slajd 1\n\nExtracted slide body.',
    });
    expect(out[1]).toEqual({
      kind: 'binary-unsupported',
      originalName: 'without-sibling.pptx',
    });
  });

  // US-214: a media file with its `.extracted/<name>.md` transcript reads as
  // text and carries `extractedFrom`, exactly like docx/pdf/pptx; without the
  // transcript (still transcribing / failed) it stays `binary-unsupported`.
  it('returns kind:text for a media file with transcript, binary-unsupported without', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(path.join(src, EXTRACTED_DIRNAME), { recursive: true });
    await fs.writeFile(path.join(src, 'done.mp4'), 'fake-video');
    await fs.writeFile(
      path.join(src, EXTRACTED_DIRNAME, 'done.mp4.md'),
      '# Transkrypcja\n\nSpoken lecture content.',
    );
    await fs.writeFile(path.join(src, 'pending.mp3'), 'fake-audio');

    const out = loadStagedSourcesForPrompt(id);
    // Lexicographic: done.mp4 → pending.mp3
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      kind: 'text',
      originalName: 'done.mp4',
      extractedFrom: 'done.mp4',
      content: '# Transkrypcja\n\nSpoken lecture content.',
    });
    expect(out[1]).toEqual({
      kind: 'binary-unsupported',
      originalName: 'pending.mp3',
    });
  });

  it('reads .json and .md as text', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'data.json'), '{"ok":true}');
    // .md not on the upload allow-list but readable if it lands here.
    await fs.writeFile(path.join(src, 'aside.md'), '# md body');

    const out = loadStagedSourcesForPrompt(id);
    expect(out.find((e) => e.originalName === 'data.json')).toEqual({
      kind: 'text',
      originalName: 'data.json',
      content: '{"ok":true}',
    });
    expect(out.find((e) => e.originalName === 'aside.md')).toEqual({
      kind: 'text',
      originalName: 'aside.md',
      content: '# md body',
    });
  });

  it('truncates a single file that exceeds perFileCharCap with the literal marker', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(src, { recursive: true });
    // 100 chars; cap at 40.
    const body = 'a'.repeat(100);
    await fs.writeFile(path.join(src, 'big.txt'), body);

    const out = loadStagedSourcesForPrompt(id, {
      totalCharBudget: 1_000,
      perFileCharCap: 40,
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('text');
    if (out[0].kind === 'text') {
      // Head 40 chars + truncation marker mentioning remaining 60.
      expect(out[0].content.startsWith('a'.repeat(40))).toBe(true);
      expect(out[0].content).toContain('[…truncated, 60 more chars…]');
      expect(out[0].content.endsWith('[…truncated, 60 more chars…]')).toBe(true);
    }
  });

  it('replaces files past totalCharBudget with the budget-exhausted placeholder', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(src, { recursive: true });
    // Two large files. Lexicographic order: a.txt → b.txt.
    await fs.writeFile(path.join(src, 'a.txt'), 'A'.repeat(200));
    await fs.writeFile(path.join(src, 'b.txt'), 'B'.repeat(200));

    const out = loadStagedSourcesForPrompt(id, {
      totalCharBudget: 150,
      perFileCharCap: 1_000,
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      kind: 'text',
      originalName: 'a.txt',
      content: 'A'.repeat(200),
    });
    expect(out[1]).toEqual({
      kind: 'text',
      originalName: 'b.txt',
      content: '(omitted: total character budget exhausted)',
    });
  });

  it('downgrades a docx whose extracted sibling is unreadable to binary-unsupported', async () => {
    const id = makeDraftId();
    const src = draftSourcesDir(id);
    await fs.mkdir(path.join(src, EXTRACTED_DIRNAME), { recursive: true });
    await fs.writeFile(path.join(src, 'broken.docx'), 'docx-bytes');
    // Sibling is a directory, not a file — readFileSync will throw EISDIR.
    await fs.mkdir(
      path.join(src, EXTRACTED_DIRNAME, 'broken.docx.md'),
      { recursive: true },
    );

    const out = loadStagedSourcesForPrompt(id);
    expect(out).toEqual([
      { kind: 'binary-unsupported', originalName: 'broken.docx' },
    ]);
  });
});
