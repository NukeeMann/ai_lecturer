import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { GET as getExport } from './route';
import {
  __resetForTesting as __resetGenerationForTesting,
  __setActiveRunForTesting,
} from '@/lib/server/generation';
import { PYODIDE_VERSION } from '@/lib/export/constants';

let coursesRoot: string;

const SLUG = 'us-152-static-fixture';

async function seedCourse() {
  const dir = path.join(coursesRoot, SLUG);
  await fs.mkdir(path.join(dir, 'lessons'), { recursive: true });

  const course = {
    schemaVersion: 1,
    slug: SLUG,
    title: 'US-152 Static Export',
    description: 'Course used to verify the static-HTML export route.',
    accentColor: 'default',
    icon: 'file-text',
    modules: [
      {
        id: 'm1',
        title: 'Module 1',
        summary: 'Three-lesson reference module.',
        lessons: [
          { slug: 'theory-lesson', title: 'Theory lesson', estimatedMinutes: 4 },
          { slug: 'code-lesson', title: 'Code lesson', estimatedMinutes: 6 },
          { slug: 'quiz-lesson', title: 'Quiz lesson', estimatedMinutes: 3 },
        ],
      },
    ],
    createdAt: '2026-05-09T00:00:00Z',
    updatedAt: '2026-05-09T00:00:00Z',
  };
  await fs.writeFile(
    path.join(dir, 'course.json'),
    JSON.stringify(course),
    'utf8',
  );

  const theoryLesson = {
    schemaVersion: 1,
    slug: 'theory-lesson',
    courseSlug: SLUG,
    moduleId: 'm1',
    title: 'Theory lesson',
    eyebrow: 'Module 1',
    description: 'A short theory lesson.',
    estimatedMinutes: 4,
    sections: [
      {
        id: 's1',
        title: 'Intro',
        type: 'theory',
        data: { markdown: '# Hello\n\nThis is **bold** static markdown.\n' },
      },
    ],
  };

  const codeLesson = {
    schemaVersion: 1,
    slug: 'code-lesson',
    courseSlug: SLUG,
    moduleId: 'm1',
    title: 'Code lesson',
    eyebrow: 'Module 1',
    description: 'Run Python in the browser.',
    estimatedMinutes: 6,
    sections: [
      {
        id: 's-code',
        title: 'Add two numbers',
        type: 'code',
        data: {
          taskMarkdown: 'Print 1 + 1.',
          starterCode: 'print(1 + 1)',
          tests: [],
        },
      },
    ],
  };

  const quizLesson = {
    schemaVersion: 1,
    slug: 'quiz-lesson',
    courseSlug: SLUG,
    moduleId: 'm1',
    title: 'Quiz lesson',
    eyebrow: 'Module 1',
    description: 'A single-choice quiz.',
    estimatedMinutes: 3,
    sections: [
      {
        id: 's-quiz',
        title: 'What is 2 + 2?',
        type: 'quiz',
        data: {
          question: 'What is 2 + 2?',
          options: ['3', '4', '5'],
          correct: [1],
          explanation: 'Two plus two equals four.',
          multiSelect: false,
        },
      },
    ],
  };

  await fs.writeFile(
    path.join(dir, 'lessons', 'theory-lesson.json'),
    JSON.stringify(theoryLesson),
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'lessons', 'code-lesson.json'),
    JSON.stringify(codeLesson),
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'lessons', 'quiz-lesson.json'),
    JSON.stringify(quizLesson),
    'utf8',
  );
}

function exportReq(slug: string): Request {
  return new Request(`http://x/api/courses/${slug}/export/html`, { method: 'GET' });
}

function exportCtx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

// Inline ZIP reader that supports STORE (method 0) and DEFLATE (method 8).
// archiver defaults to deflate; we read by walking the central directory then
// pulling each local file header + payload.
function readZipEntries(buf: Buffer): ZipEntry[] {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const LFH_SIG = 0x04034b50;

  let eocdOffset = -1;
  const maxScanBack = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= maxScanBack; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('ZIP EOCD not found');

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const out: ZipEntry[] = [];
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(pos) !== CD_SIG) {
      throw new Error('Bad central-directory entry');
    }
    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const fileNameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const lfhOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + fileNameLen).toString('utf8');

    // Walk to the local file header and decode.
    if (buf.readUInt32LE(lfhOffset) !== LFH_SIG) {
      throw new Error('Bad local file header');
    }
    const lfhFileNameLen = buf.readUInt16LE(lfhOffset + 26);
    const lfhExtraLen = buf.readUInt16LE(lfhOffset + 28);
    const dataStart = lfhOffset + 30 + lfhFileNameLen + lfhExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (compressionMethod === 0) {
      data = Buffer.from(compressed);
    } else if (compressionMethod === 8) {
      // Lazy zlib import — node:zlib has inflateRawSync.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { inflateRawSync } = require('node:zlib') as typeof import('node:zlib');
      data = inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported compression method ${compressionMethod}`);
    }
    if (data.length !== uncompressedSize) {
      throw new Error(
        `Decompressed size mismatch for ${name}: got ${data.length}, expected ${uncompressedSize}`,
      );
    }
    out.push({ name, data });
    pos += 46 + fileNameLen + extraLen + commentLen;
  }
  return out;
}

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-export-html-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
  process.env.GENERATION_QUEUE_FILE_OVERRIDE = path.join(
    coursesRoot,
    'generation-queue.json',
  );
  __resetGenerationForTesting();
});

afterEach(async () => {
  __resetGenerationForTesting();
  delete process.env.COURSES_ROOT_OVERRIDE;
  delete process.env.GENERATION_QUEUE_FILE_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
});

describe('GET /api/courses/[slug]/export/html (US-152)', () => {
  it('streams a ZIP whose layout matches the AC', async () => {
    await seedCourse();

    const res = await getExport(exportReq(SLUG), exportCtx(SLUG));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');

    const disposition = res.headers.get('content-disposition');
    expect(disposition).toMatch(
      new RegExp(`^attachment; filename="${SLUG}-static-\\d{4}-\\d{2}-\\d{2}\\.zip"$`),
    );

    const buf = Buffer.from(await res.arrayBuffer());
    const entries = readZipEntries(buf);
    const names = entries.map((e) => e.name).sort();

    const required = [
      `${SLUG}/index.html`,
      `${SLUG}/assets/styles.css`,
      `${SLUG}/assets/pyodide-loader.js`,
      `${SLUG}/assets/static-client.js`,
      `${SLUG}/lessons/theory-lesson.html`,
      `${SLUG}/lessons/theory-lesson.data.js`,
      `${SLUG}/lessons/code-lesson.html`,
      `${SLUG}/lessons/code-lesson.data.js`,
      `${SLUG}/lessons/quiz-lesson.html`,
      `${SLUG}/lessons/quiz-lesson.data.js`,
    ];
    for (const r of required) {
      expect(names).toContain(r);
    }

    // No course-spec, no /sources/, no .ts/.tsx, no node_modules — these are
    // not produced by the route, so checking for a couple of common forbidden
    // names is enough as a regression smoke check.
    const forbiddenSubstrings = [
      'course-spec.json',
      '/sources/',
      '.tsx',
      'node_modules',
    ];
    for (const e of names) {
      for (const f of forbiddenSubstrings) {
        expect(e.includes(f)).toBe(false);
      }
    }
  });

  it('renders theory lesson HTML containing the markdown body', async () => {
    await seedCourse();
    const res = await getExport(exportReq(SLUG), exportCtx(SLUG));
    const buf = Buffer.from(await res.arrayBuffer());
    const entries = readZipEntries(buf);
    const theoryHtml = entries
      .find((e) => e.name === `${SLUG}/lessons/theory-lesson.html`)!
      .data.toString('utf8');

    expect(theoryHtml.startsWith('<!doctype html>')).toBe(true);
    expect(theoryHtml).toContain('<title>Theory lesson — US-152 Static Export</title>');
    expect(theoryHtml).toContain('Hello');
    expect(theoryHtml).toContain('<strong>bold</strong>');
    expect(theoryHtml).toContain(
      '<link rel="stylesheet" href="../assets/styles.css"',
    );
    expect(theoryHtml).toContain(
      '<script src="../assets/pyodide-loader.js" defer>',
    );
    expect(theoryHtml).toContain(
      '<script src="./theory-lesson.data.js" defer>',
    );
  });

  it('renders code lesson HTML with a textarea and a Run button', async () => {
    await seedCourse();
    const res = await getExport(exportReq(SLUG), exportCtx(SLUG));
    const buf = Buffer.from(await res.arrayBuffer());
    const entries = readZipEntries(buf);
    const codeHtml = entries
      .find((e) => e.name === `${SLUG}/lessons/code-lesson.html`)!
      .data.toString('utf8');

    expect(codeHtml).toContain('data-static-code-input');
    expect(codeHtml).toContain('data-static-code-run');
    expect(codeHtml).toContain('print(1 + 1)');
  });

  it('renders quiz lesson HTML with all options and embeds correct answer in data.js', async () => {
    await seedCourse();
    const res = await getExport(exportReq(SLUG), exportCtx(SLUG));
    const buf = Buffer.from(await res.arrayBuffer());
    const entries = readZipEntries(buf);
    const quizHtml = entries
      .find((e) => e.name === `${SLUG}/lessons/quiz-lesson.html`)!
      .data.toString('utf8');
    const quizDataJs = entries
      .find((e) => e.name === `${SLUG}/lessons/quiz-lesson.data.js`)!
      .data.toString('utf8');

    expect(quizHtml).toContain('What is 2 + 2?');
    expect(quizHtml).toContain('data-option-index="0"');
    expect(quizHtml).toContain('data-option-index="1"');
    expect(quizHtml).toContain('data-option-index="2"');
    expect(quizHtml).toContain('data-static-quiz-submit');

    expect(quizDataJs).toContain('window.__AI_LECTURER_LESSON__');
    expect(quizDataJs).toContain('"correct":[1]');
  });

  it('pyodide-loader.js pins the documented version and exposes runPython', async () => {
    await seedCourse();
    const res = await getExport(exportReq(SLUG), exportCtx(SLUG));
    const buf = Buffer.from(await res.arrayBuffer());
    const entries = readZipEntries(buf);
    const loader = entries
      .find((e) => e.name === `${SLUG}/assets/pyodide-loader.js`)!
      .data.toString('utf8');

    expect(loader).toContain(
      `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`,
    );
    expect(loader).toContain('window.runPython');
  });

  it('index.html lists every module + lesson with link targets relative to /lessons/', async () => {
    await seedCourse();
    const res = await getExport(exportReq(SLUG), exportCtx(SLUG));
    const buf = Buffer.from(await res.arrayBuffer());
    const entries = readZipEntries(buf);
    const indexHtml = entries
      .find((e) => e.name === `${SLUG}/index.html`)!
      .data.toString('utf8');

    expect(indexHtml).toContain('US-152 Static Export');
    expect(indexHtml).toContain('href="./lessons/theory-lesson.html"');
    expect(indexHtml).toContain('href="./lessons/code-lesson.html"');
    expect(indexHtml).toContain('href="./lessons/quiz-lesson.html"');
  });

  it('returns 409 when generation is active for the slug', async () => {
    await seedCourse();
    __setActiveRunForTesting(SLUG);
    const res = await getExport(exportReq(SLUG), exportCtx(SLUG));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('generation-active');
  });

  it('returns 404 when the course directory is missing', async () => {
    const res = await getExport(
      exportReq('does-not-exist'),
      exportCtx('does-not-exist'),
    );
    expect(res.status).toBe(404);
  });

  it('rejects unsafe slugs with 400', async () => {
    const slug = '../escape';
    const res = await getExport(exportReq(slug), exportCtx(slug));
    expect(res.status).toBe(400);
  });

  it('returns 400 when course.json is invalid JSON', async () => {
    const dir = path.join(coursesRoot, SLUG);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'course.json'), '{ not json }', 'utf8');
    const res = await getExport(exportReq(SLUG), exportCtx(SLUG));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid-course');
  });

  it('returns 400 when a referenced lesson JSON is missing', async () => {
    await seedCourse();
    await fs.unlink(path.join(coursesRoot, SLUG, 'lessons', 'code-lesson.json'));
    const res = await getExport(exportReq(SLUG), exportCtx(SLUG));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid-lesson');
  });
});

// US-212: widgets whose `requiresPackages` are NOT loadable in Pyodide
// (cv2/torch/tensorflow) must degrade to a read-only export instead of an
// interactive Pyodide widget whose Run would crash on import. Widgets whose
// packages ARE Pyodide-loadable (numpy/matplotlib/…) keep running interactively.
const PKG_SLUG = 'us-212-package-fixture';

async function seedPackageCourse() {
  const dir = path.join(coursesRoot, PKG_SLUG);
  await fs.mkdir(path.join(dir, 'lessons'), { recursive: true });

  const course = {
    schemaVersion: 1,
    slug: PKG_SLUG,
    title: 'US-212 Package Export',
    description: 'Kernel-only vs Pyodide-loadable widgets.',
    accentColor: 'default',
    icon: 'file-text',
    modules: [
      {
        id: 'm1',
        title: 'Module 1',
        summary: 'Package gating module.',
        lessons: [{ slug: 'pkg-lesson', title: 'Package lesson', estimatedMinutes: 5 }],
      },
    ],
    createdAt: '2026-06-13T00:00:00Z',
    updatedAt: '2026-06-13T00:00:00Z',
  };
  await fs.writeFile(path.join(dir, 'course.json'), JSON.stringify(course), 'utf8');

  const lesson = {
    schemaVersion: 1,
    slug: 'pkg-lesson',
    courseSlug: PKG_SLUG,
    moduleId: 'm1',
    title: 'Package lesson',
    eyebrow: 'Module 1',
    description: 'Mixed runtime requirements.',
    estimatedMinutes: 5,
    sections: [
      {
        id: 's-kernel-code',
        title: 'OpenCV edges',
        type: 'code',
        data: {
          taskMarkdown: 'Detect edges with OpenCV.',
          starterCode: 'import cv2\nprint(cv2.__version__)',
          tests: [],
          requiresPackages: ['cv2'],
        },
      },
      {
        id: 's-kernel-sandbox',
        title: 'Torch playground',
        type: 'sandbox',
        data: {
          starterCode: 'import torch\nprint(torch.tensor([1, 2, 3]))',
          encouragement: 'Experiment freely.',
          requiresPackages: ['torch'],
        },
      },
      {
        id: 's-numpy-code',
        title: 'NumPy mean',
        type: 'code',
        data: {
          taskMarkdown: 'Compute a mean with NumPy.',
          starterCode: 'import numpy as np\nprint(np.mean([1, 2, 3]))',
          tests: [],
          requiresPackages: ['numpy'],
        },
      },
    ],
  };
  await fs.writeFile(
    path.join(dir, 'lessons', 'pkg-lesson.json'),
    JSON.stringify(lesson),
    'utf8',
  );
}

async function pkgLessonHtml(): Promise<string> {
  const res = await getExport(exportReq(PKG_SLUG), exportCtx(PKG_SLUG));
  expect(res.status).toBe(200);
  const buf = Buffer.from(await res.arrayBuffer());
  const entries = readZipEntries(buf);
  return entries
    .find((e) => e.name === `${PKG_SLUG}/lessons/pkg-lesson.html`)!
    .data.toString('utf8');
}

// Helper: extract the markup of one section starting at its `data-section-id`
// up to the next static-section, so per-section assertions don't accidentally
// see another widget's Run button.
function sectionMarkup(html: string, sectionId: string): string {
  const idx = html.indexOf(`data-section-id="${sectionId}"`);
  expect(idx).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf('<', idx);
  const nextSection = html.indexOf('class="static-section"', idx + 1);
  const end = nextSection >= 0 ? nextSection : html.length;
  return html.slice(start, end);
}

describe('GET /api/courses/[slug]/export/html — kernel-package gating (US-212)', () => {
  it('degrades a cv2 (kernel-only) code widget to read-only with a badge and no Run button', async () => {
    await seedPackageCourse();
    const html = await pkgLessonHtml();
    const markup = sectionMarkup(html, 's-kernel-code');

    expect(markup).toContain('Requires local kernel runtime');
    expect(markup).not.toContain('data-static-code-run');
    expect(markup).not.toContain('data-static-code-input');
    // Starter code is still shown (read-only, highlighted).
    expect(markup).toContain('cv2');
  });

  it('degrades a torch (kernel-only) sandbox widget to read-only with a badge and no Run button', async () => {
    await seedPackageCourse();
    const html = await pkgLessonHtml();
    const markup = sectionMarkup(html, 's-kernel-sandbox');

    expect(markup).toContain('Requires local kernel runtime');
    expect(markup).not.toContain('data-static-code-run');
    expect(markup).toContain('torch');
  });

  it('keeps a numpy (Pyodide-loadable) code widget interactive with a Run button', async () => {
    await seedPackageCourse();
    const html = await pkgLessonHtml();
    const markup = sectionMarkup(html, 's-numpy-code');

    expect(markup).toContain('data-static-code-run');
    expect(markup).toContain('data-static-code-input');
    expect(markup).not.toContain('Requires local kernel runtime');
  });
});
