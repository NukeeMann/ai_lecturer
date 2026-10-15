// Tests for restricted.mjs. Run: npm test (in tools/static-export), or
//   node --test tools/static-export/scripts/restricted.test.mjs
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  WARNING_FILE_NAME,
  countExcludedFiles,
  courseAssetPath,
  formatRestrictedWarning,
  hasRestrictedContent,
  listPrivateAssetFiles,
  makeRestrictedAssetFilter,
  scanJsonDocument,
  scanRestrictedContent,
  writeRestrictedWarningFile,
} from './restricted.mjs';

const SLUG = 'eeg-kids';
const SPRINGER = '© Springer 2021 — all rights reserved';
const MAYO = '© Mayo Foundation. All rights reserved';

let tmp;
let courseDir;
let course;
let lessons;

async function write(rel, content) {
  const file = path.join(courseDir, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'static-export-restricted-'));
  courseDir = path.join(tmp, 'courses', SLUG);

  course = { slug: SLUG, title: 'EEG u dzieci', modules: [{ id: 'm1', lessons: [{ slug: 'l1' }, { slug: 'l2' }] }] };
  lessons = [
    {
      slug: 'l1',
      title: 'Phase reversal',
      sections: [
        { id: 'intro', type: 'theory', data: { markdown: 'Plain text, no images.' } },
        {
          id: 'atlas',
          type: 'eegFigureMark',
          data: {
            figure: {
              src: `/api/courses/${SLUG}/assets/private/kurlemann/fig-3-2.png`,
              alt: 'Spike-wave',
              attribution: { text: 'Kurlemann G. et al., Fig. 3.2', license: SPRINGER, restricted: true },
            },
          },
        },
        {
          id: 'theory2',
          type: 'theory',
          data: {
            markdown: `See ![Mayo](/api/courses/${SLUG}/assets/private/mayo/fig-7.png) and ![ok](/api/courses/${SLUG}/assets/plots/open.png).`,
          },
        },
      ],
    },
    {
      slug: 'l2',
      title: 'Montages',
      sections: [
        {
          id: 'seq',
          type: 'figureSequence',
          data: {
            frames: [
              {
                id: 'f1',
                figure: {
                  // Restricted figure stored OUTSIDE assets/private/.
                  src: `/api/courses/${SLUG}/assets/plots/aes-fig-12.png`,
                  attribution: { text: 'AES figure 12', license: MAYO, restricted: true },
                },
              },
              {
                id: 'f2',
                figure: {
                  src: `/api/courses/${SLUG}/assets/plots/open.png`,
                  attribution: { text: 'Open figure', license: 'CC BY-NC-SA 4.0' },
                },
              },
            ],
          },
        },
      ],
    },
  ];

  await write('course.json', course);
  for (const l of lessons) await write(`lessons/${l.slug}.json`, l);
  await write('assets/private/kurlemann/fig-3-2.png', 'png');
  await write('assets/private/mayo/fig-7.png', 'png');
  await write('assets/private/.DS_Store', 'junk');
  await write('assets/plots/aes-fig-12.png', 'png');
  await write('assets/plots/open.png', 'png');
  await write('assets/eeg/rec.json', '{}');
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('listPrivateAssetFiles', () => {
  it('lists files under assets/private recursively, relative and sorted, without dotfiles', async () => {
    assert.deepEqual(await listPrivateAssetFiles(courseDir), [
      'private/kurlemann/fig-3-2.png',
      'private/mayo/fig-7.png',
    ]);
  });

  it('returns [] when there is no private folder', async () => {
    assert.deepEqual(await listPrivateAssetFiles(path.join(tmp, 'nope')), []);
  });
});

describe('scanJsonDocument', () => {
  it('reports restricted attributions with licence, text, section and the figure src', () => {
    const { restrictedItems } = scanJsonDocument(lessons[0], { lessonSlug: 'l1' });
    assert.deepEqual(restrictedItems, [
      {
        lessonSlug: 'l1',
        sectionId: 'atlas',
        jsonPath: 'sections[1].data.figure.attribution',
        license: SPRINGER,
        text: 'Kurlemann G. et al., Fig. 3.2',
        src: `/api/courses/${SLUG}/assets/private/kurlemann/fig-3-2.png`,
      },
    ]);
  });

  it('finds assets/private references inside markdown and src strings', () => {
    const { privateRefs } = scanJsonDocument(lessons[0], { lessonSlug: 'l1' });
    assert.deepEqual(
      privateRefs.map((r) => [r.sectionId, r.ref]),
      [
        ['atlas', 'assets/private/kurlemann/fig-3-2.png'],
        ['theory2', 'assets/private/mayo/fig-7.png'],
      ],
    );
  });

  it('ignores "restricted": false and unrelated strings', () => {
    const res = scanJsonDocument({
      sections: [{ id: 'x', data: { attribution: { restricted: false }, note: 'assets/privateer.png' } }],
    });
    assert.deepEqual(res, { restrictedItems: [], privateRefs: [] });
  });
});

describe('scanRestrictedContent (fixture course on disk)', () => {
  it('aggregates files, flagged items, references, licences and extra excluded files', async () => {
    const report = await scanRestrictedContent({ courseSlug: SLUG, courseDir, course, lessons });
    assert.equal(hasRestrictedContent(report), true);
    assert.equal(report.courseTitle, 'EEG u dzieci');
    assert.deepEqual(report.privateFiles, ['private/kurlemann/fig-3-2.png', 'private/mayo/fig-7.png']);
    assert.equal(report.restrictedItems.length, 2);
    assert.equal(report.privateRefs.length, 2);
    assert.deepEqual(report.licenses, [SPRINGER, MAYO].sort());
    assert.deepEqual(report.excludedPaths, ['plots/aes-fig-12.png']);
    assert.equal(countExcludedFiles(report), 3);
  });

  it('reports nothing for a clean course', async () => {
    const report = await scanRestrictedContent({
      courseSlug: 'clean',
      courseDir: path.join(tmp, 'courses', 'clean'),
      course: { title: 'Clean' },
      lessons: [{ slug: 'a', sections: [{ id: 's', data: { markdown: '![x](/api/courses/clean/assets/plots/a.png)' } }] }],
    });
    assert.equal(hasRestrictedContent(report), false);
  });
});

describe('courseAssetPath', () => {
  it('maps this course’s asset URLs to asset-relative paths only', () => {
    assert.equal(courseAssetPath(`/api/courses/${SLUG}/assets/plots/a%20b.png?v=2`, SLUG), 'plots/a b.png');
    assert.equal(courseAssetPath('/api/courses/other/assets/plots/a.png', SLUG), undefined);
    assert.equal(courseAssetPath('https://example.org/a.png', SLUG), undefined);
    assert.equal(courseAssetPath(undefined, SLUG), undefined);
  });
});

describe('makeRestrictedAssetFilter + fs.cp (--exclude-restricted)', () => {
  it('copies everything except assets/private/** and restricted figure files', async () => {
    const report = await scanRestrictedContent({ courseSlug: SLUG, courseDir, course, lessons });
    const assetsDir = path.join(courseDir, 'assets');
    const dest = path.join(tmp, 'dist', 'assets', 'course');
    await fs.cp(assetsDir, dest, { recursive: true, filter: makeRestrictedAssetFilter(assetsDir, report) });
    const copied = [];
    async function walk(dir) {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else copied.push(path.relative(dest, full).split(path.sep).join('/'));
      }
    }
    await walk(dest);
    assert.deepEqual(copied.sort(), ['eeg/rec.json', 'plots/open.png']);
  });

  it('without a report it still skips the private folder', () => {
    const filter = makeRestrictedAssetFilter('/a/assets', null);
    assert.equal(filter('/a/assets'), true);
    assert.equal(filter('/a/assets/private'), false);
    assert.equal(filter('/a/assets/private/x.png'), false);
    assert.equal(filter('/a/assets/private-notes/x.png'), true);
    assert.equal(filter('/a/assets/plots/x.png'), true);
  });
});

describe('formatRestrictedWarning / writeRestrictedWarningFile', () => {
  it('prints a prominent multi-line warning naming the course, counts and licences', async () => {
    const report = await scanRestrictedContent({ courseSlug: SLUG, courseDir, course, lessons });
    const text = formatRestrictedWarning([report]);
    assert.match(text, /WARNING: RESTRICTED \(PRIVATE-USE\) CONTENT IN THIS EXPORT/);
    assert.match(text, /PRIVATE USE ONLY\. Do NOT publish/);
    assert.match(text, /Course "eeg-kids" \(EEG u dzieci\):/);
    assert.match(text, /2 file\(s\) under assets\/private\/ \(copied into this export\)/);
    assert.match(text, /2 item\(s\) marked "restricted": true \(in: l1, l2\)/);
    assert.match(text, /2 reference\(s\) to assets\/private\/ \(in: l1\)/);
    assert.ok(text.includes(SPRINGER) && text.includes(MAYO));
    assert.match(text, /--exclude-restricted/);
    for (const line of text.split('\n').filter((l) => l.startsWith('##'))) {
      assert.equal(line.length, 72, `banner line width: "${line}"`);
    }
  });

  it('says what was left out in --exclude-restricted mode', async () => {
    const report = await scanRestrictedContent({ courseSlug: SLUG, courseDir, course, lessons });
    const text = formatRestrictedWarning([report], { excluded: true });
    assert.match(text, /NOT copied: --exclude-restricted/);
    assert.match(text, /1 restricted figure file\(s\) outside assets\/private\/ not copied/);
    assert.match(text, /Review the lessons before publishing/);
  });

  it('lists at most 8 examples per course and counts the rest', () => {
    const many = {
      courseSlug: 'x',
      privateFiles: Array.from({ length: 12 }, (_, i) => `private/f${i}.png`),
      restrictedItems: [],
      privateRefs: [],
      licenses: [],
      excludedPaths: [],
    };
    const text = formatRestrictedWarning([many]);
    assert.match(text, /… and 4 more/);
    assert.match(text, /none stated; treat as all rights reserved/);
  });

  it('writes RESTRICTED-CONTENT-WARNING.txt into the export folder', async () => {
    const distDir = path.join(tmp, 'dist-out');
    await fs.mkdir(distDir, { recursive: true });
    const file = await writeRestrictedWarningFile(distDir, 'BODY\n', { generatedAt: '2026-10-15T10:00:00Z' });
    assert.equal(path.basename(file), WARNING_FILE_NAME);
    const content = await fs.readFile(file, 'utf8');
    assert.ok(content.startsWith('Generated by the static exporter on 2026-10-15T10:00:00Z.'));
    assert.ok(content.endsWith('BODY\n'));
  });
});
