import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { GET as getExport, isExcluded } from './route';
import {
  __resetForTesting as __resetGenerationForTesting,
  __setActiveRunForTesting,
} from '@/lib/server/generation';

let coursesRoot: string;

const SLUG = 'export-fixture';

// Seed a course with everything an exporter would normally see EXCEPT
// `.generating.json`. The presence of `.generating.json` triggers the 409
// "generation active" branch by design (getActiveRunSummary scans for it),
// so we cover that file's exclusion via a separate 409 test plus a pure
// `isExcluded` unit assertion.
async function seedCourse() {
  const dir = path.join(coursesRoot, SLUG);
  await fs.mkdir(path.join(dir, 'lessons'), { recursive: true });
  await fs.mkdir(path.join(dir, 'sources'), { recursive: true });
  await fs.mkdir(path.join(dir, 'logs'), { recursive: true });

  // Files that MUST be included.
  await fs.writeFile(
    path.join(dir, 'course.json'),
    JSON.stringify({ slug: SLUG, title: 'Export fixture' }),
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'course-spec.json'),
    JSON.stringify({ topic: 'fixture' }),
    'utf8',
  );
  await fs.writeFile(path.join(dir, 'research.md'), '# research\n', 'utf8');
  await fs.writeFile(path.join(dir, 'sources.md'), '# sources\n', 'utf8');
  await fs.writeFile(
    path.join(dir, 'coherence-report.md'),
    '# coherence\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'lessons', 'intro.json'),
    JSON.stringify({ slug: 'intro' }),
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'lessons', 'second.json'),
    JSON.stringify({ slug: 'second' }),
    'utf8',
  );
  await fs.writeFile(path.join(dir, 'sources', 'paper.pdf'), 'PDF DATA', 'utf8');
  await fs.writeFile(path.join(dir, 'logs', 'init_course.log'), 'log line\n', 'utf8');

  // Files that MUST be excluded.
  await fs.writeFile(
    path.join(dir, '.generation-state.json'),
    JSON.stringify({ phase: 'done' }),
    'utf8',
  );
  await fs.writeFile(path.join(dir, '.generation-events.ndjson'), 'evt\n', 'utf8');
  await fs.writeFile(
    path.join(dir, '.generation-events.1.ndjson'),
    'rotated evt\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'lessons', 'intro.lesson-prev.json'),
    JSON.stringify({ slug: 'intro-prev' }),
    'utf8',
  );
}

function exportReq(slug: string): Request {
  return new Request(`http://x/api/courses/${slug}/export/zip`, { method: 'GET' });
}

function exportCtx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

// Minimal ZIP central-directory reader. Returns the names of every entry in
// the archive so tests can assert inclusion/exclusion. Pulled inline to avoid
// adding a runtime ZIP-reader dependency just for a test.
function readZipEntryNames(buf: Buffer): string[] {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;

  // EOCD record is at the end of the file; scan back up to 65557 bytes for
  // the signature (the maximum size of EOCD + comment).
  let eocdOffset = -1;
  const maxScanBack = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= maxScanBack; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('ZIP EOCD record not found');

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const names: string[] = [];
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(pos) !== CD_SIG) {
      throw new Error(`Bad central-directory entry at offset ${pos}`);
    }
    const fileNameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const name = buf.subarray(pos + 46, pos + 46 + fileNameLen).toString('utf8');
    names.push(name);
    pos += 46 + fileNameLen + extraLen + commentLen;
  }
  return names;
}

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-export-zip-'));
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

describe('GET /api/courses/[slug]/export/zip (US-150)', () => {
  it('streams a ZIP that includes course content but excludes generation-state files', async () => {
    await seedCourse();

    const res = await getExport(exportReq(SLUG), exportCtx(SLUG));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');

    const disposition = res.headers.get('content-disposition');
    expect(disposition).toBeTruthy();
    expect(disposition).toMatch(
      new RegExp(`^attachment; filename="${SLUG}-\\d{4}-\\d{2}-\\d{2}\\.zip"$`),
    );

    const buf = Buffer.from(await res.arrayBuffer());
    const entries = readZipEntryNames(buf);

    // Every entry is rooted under `<slug>/`.
    for (const e of entries) {
      expect(e.startsWith(`${SLUG}/`)).toBe(true);
    }

    // Exact set of expected included entries.
    const expectedIncluded = [
      `${SLUG}/course.json`,
      `${SLUG}/course-spec.json`,
      `${SLUG}/research.md`,
      `${SLUG}/sources.md`,
      `${SLUG}/coherence-report.md`,
      `${SLUG}/lessons/intro.json`,
      `${SLUG}/lessons/second.json`,
      `${SLUG}/sources/paper.pdf`,
      `${SLUG}/logs/init_course.log`,
    ];
    for (const name of expectedIncluded) {
      expect(entries).toContain(name);
    }

    // Exact set of expected excluded entries.
    const expectedExcluded = [
      `${SLUG}/.generation-state.json`,
      `${SLUG}/.generation-events.ndjson`,
      `${SLUG}/.generation-events.1.ndjson`,
      `${SLUG}/lessons/intro.lesson-prev.json`,
    ];
    for (const name of expectedExcluded) {
      expect(entries).not.toContain(name);
    }
  });

  it('returns 409 when a generation marker (.generating.json) is present for the slug', async () => {
    await seedCourse();
    // Simulate a genuinely-supervised in-memory run. A bare `.generating.json`
    // marker is no longer treated as active (it's reconciled as an orphan).
    __setActiveRunForTesting(SLUG);
    const res = await getExport(exportReq(SLUG), exportCtx(SLUG));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('generation-active');
  });

  it('returns 404 when the course directory is missing', async () => {
    const res = await getExport(exportReq('does-not-exist'), exportCtx('does-not-exist'));
    expect(res.status).toBe(404);
  });

  it('rejects unsafe slugs with 400', async () => {
    const slug = '../escape';
    const res = await getExport(exportReq(slug), exportCtx(slug));
    expect(res.status).toBe(400);
  });

  it('isExcluded matches every documented excluded basename', () => {
    expect(isExcluded('.generation-state.json')).toBe(true);
    expect(isExcluded('.generating.json')).toBe(true);
    expect(isExcluded('.generation-events.ndjson')).toBe(true);
    expect(isExcluded('.generation-events.1.ndjson')).toBe(true);
    expect(isExcluded('.generation-events.20260508T1200.ndjson')).toBe(true);
    expect(isExcluded('intro.lesson-prev.json')).toBe(true);
    expect(isExcluded('any.lesson-prev.json')).toBe(true);
    // Files that should NOT be excluded.
    expect(isExcluded('course.json')).toBe(false);
    expect(isExcluded('course-spec.json')).toBe(false);
    expect(isExcluded('research.md')).toBe(false);
    expect(isExcluded('sources.md')).toBe(false);
    expect(isExcluded('coherence-report.md')).toBe(false);
    expect(isExcluded('intro.json')).toBe(false);
  });
});
