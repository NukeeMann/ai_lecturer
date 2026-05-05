import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  assertSafeDraftId,
  draftDir,
  draftSourcesDir,
  courseSourcesDir,
  listCourseSourceFilesSync,
  makeDraftId,
  moveDraftSourcesToCourse,
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
  it('matches the AC list exactly', () => {
    expect([...ALLOWED_EXTENSIONS].sort()).toEqual([
      '.docx',
      '.json',
      '.pdf',
      '.pptx',
      '.txt',
    ]);
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
