import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import type { Lesson } from '@/lib/schemas/lesson';

import {
  collectLessonAssets,
  findLessonAssetIssues,
  findMissingLessonAssets,
  formatAssetIssuesError,
  formatMissingAssetsError,
  type AssetIssue,
} from '@/lib/server/lessonAssets';

const SLUG = 'demo-course';

let coursesRoot: string;

function lesson(sections: unknown[]): Lesson {
  return {
    schemaVersion: 1,
    slug: 'lesson-1',
    courseSlug: SLUG,
    moduleId: 'mod-1',
    title: 'Lesson',
    eyebrow: 'eb',
    description: 'desc',
    estimatedMinutes: 10,
    sections: sections as Lesson['sections'],
  };
}

beforeEach(async () => {
  coursesRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lesson-assets-test-'));
  process.env.COURSES_ROOT_OVERRIDE = coursesRoot;
  await fs.mkdir(path.join(coursesRoot, SLUG, 'assets', 'plots'), { recursive: true });
});

afterEach(async () => {
  delete process.env.COURSES_ROOT_OVERRIDE;
  await fs.rm(coursesRoot, { recursive: true, force: true });
});

describe('collectLessonAssets (local refs only)', () => {
  it('extracts plotImage, code inputs/outputMedia, demo imageSrc, mp4 video src, and inline theory images', () => {
    const refs = collectLessonAssets(
      lesson([
        {
          id: 'theory-1',
          type: 'theory',
          title: 'Intro',
          data: {
            markdown:
              `Look at ![local](/api/courses/${SLUG}/assets/images/inline-1.png) ` +
              `and ![youtube-link](https://example.com/foo.png).`,
          },
        },
        {
          id: 'plot-1',
          type: 'plotImage',
          title: 'Plot',
          data: {
            src: `/api/courses/${SLUG}/assets/plots/lesson-1-1.png`,
            alt: 'plot',
            sourceCode: 'pass',
          },
        },
        {
          id: 'code-1',
          type: 'code',
          title: 'Code',
          data: {
            taskMarkdown: 't',
            starterCode: 'pass',
            tests: [],
            solution: 'pass',
            inputs: [
              { kind: 'image', src: `/api/courses/${SLUG}/assets/inputs/in.png`, alt: 'i' },
            ],
            outputMedia: {
              kind: 'image',
              src: `/api/courses/${SLUG}/assets/outputs/out.png`,
              alt: 'o',
            },
          },
        },
        {
          id: 'demo-1',
          type: 'demo',
          title: 'Demo',
          data: {
            demoType: 'gauss',
            imageSrc: `/api/courses/${SLUG}/assets/images/demo.png`,
            params: { sigmaMin: 0, sigmaMax: 5, sigmaDefault: 1 },
          },
        },
        {
          id: 'video-mp4',
          type: 'video',
          title: 'Mp4',
          data: {
            kind: 'mp4',
            src: `/api/courses/${SLUG}/assets/videos/clip.mp4`,
            autoplay: false,
          },
        },
        {
          id: 'video-yt',
          type: 'video',
          title: 'YouTube',
          data: {
            kind: 'youtube',
            src: 'https://www.youtube.com/watch?v=abc',
            autoplay: false,
          },
        },
      ]),
      SLUG,
    );

    expect(refs.map((r) => r.relativePath).sort()).toEqual(
      [
        'assets/images/demo.png',
        'assets/images/inline-1.png',
        'assets/inputs/in.png',
        'assets/outputs/out.png',
        'assets/plots/lesson-1-1.png',
        'assets/videos/clip.mp4',
      ].sort(),
    );
  });

  it('ignores references that point at another course slug', () => {
    const refs = collectLessonAssets(
      lesson([
        {
          id: 'plot-other',
          type: 'plotImage',
          title: 'Other slug',
          data: {
            src: '/api/courses/some-other-course/assets/plots/x.png',
            alt: 'other course',
          },
        },
      ]),
      SLUG,
    );
    expect(refs).toEqual([]);
  });
});

describe('findLessonAssetIssues', () => {
  it('flags missing local files and external image URLs that should be cached locally', async () => {
    await fs.writeFile(
      path.join(coursesRoot, SLUG, 'assets', 'plots', 'present.png'),
      Buffer.from([0]),
    );
    const issues = await findLessonAssetIssues(
      lesson([
        {
          id: 'theory-with-external',
          type: 'theory',
          title: 'External in theory',
          data: {
            markdown:
              'Diagram from Wikipedia: ' +
              '![pinhole](https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Pinhole-camera.svg/640px-Pinhole-camera.svg.png).',
          },
        },
        {
          id: 'plot-present',
          type: 'plotImage',
          title: 'Present plot',
          data: {
            src: `/api/courses/${SLUG}/assets/plots/present.png`,
            alt: 'present',
          },
        },
        {
          id: 'plot-missing',
          type: 'plotImage',
          title: 'Missing plot',
          data: {
            src: `/api/courses/${SLUG}/assets/plots/missing.png`,
            alt: 'missing',
          },
        },
      ]),
      SLUG,
    );

    const kinds = issues.map((i) => i.kind).sort();
    expect(kinds).toEqual(['external-image', 'missing-local']);
    const external = issues.find(
      (i): i is Extract<AssetIssue, { kind: 'external-image' }> => i.kind === 'external-image',
    );
    expect(external?.url).toContain('upload.wikimedia.org');
    const missing = issues.find(
      (i): i is Extract<AssetIssue, { kind: 'missing-local' }> => i.kind === 'missing-local',
    );
    expect(missing?.relativePath).toBe('assets/plots/missing.png');
  });

  it('treats YouTube URLs on video sections as valid (only mp4 must be local)', async () => {
    const issues = await findLessonAssetIssues(
      lesson([
        {
          id: 'v',
          type: 'video',
          title: 'YouTube',
          data: {
            kind: 'youtube',
            src: 'https://www.youtube.com/watch?v=abc',
            autoplay: false,
          },
        },
      ]),
      SLUG,
    );
    expect(issues).toEqual([]);
  });

  it('flags a /inputs/<file> read that the widget does not declare in inputs[]', async () => {
    const issues = await findLessonAssetIssues(
      lesson([
        {
          id: 'sar-detect',
          type: 'code',
          title: 'Detect ships',
          data: {
            taskMarkdown: 'Threshold the SAR tile.',
            starterCode:
              "import cv2\nimg = cv2.imread('/inputs/sar-echo-tile.png')\n",
            tests: [
              { name: 'reads_tile', body: "assert cv2.imread('/inputs/sar-echo-tile.png') is not None" },
            ],
            // No inputs[] declared — the mount never happens.
          },
        },
      ]),
      SLUG,
    );

    // Reported once per code field that reads it (starterCode + the test body).
    const undeclared = issues.filter(
      (i): i is Extract<AssetIssue, { kind: 'undeclared-input' }> => i.kind === 'undeclared-input',
    );
    expect(undeclared).toHaveLength(2);
    expect(undeclared.every((u) => u.filename === 'sar-echo-tile.png')).toBe(true);
    expect(undeclared.map((u) => u.origin).join('\n')).toContain('starterCode');
    expect(undeclared.map((u) => u.origin).join('\n')).toContain('tests[0].body');
  });

  it('does not flag a /inputs/<file> read that IS declared (incl. filename override)', async () => {
    const issues = await findLessonAssetIssues(
      lesson([
        {
          id: 'sar-ok',
          type: 'code',
          title: 'Detect ships',
          data: {
            taskMarkdown: 'Threshold the SAR tile.',
            starterCode: "import cv2\nimg = cv2.imread('/inputs/sar-echo-tile.png')\n",
            tests: [],
            inputs: [
              {
                kind: 'image',
                // Opaque src; the mount name comes from the filename override.
                src: `/api/courses/${SLUG}/assets/images/tile-001.png`,
                filename: 'sar-echo-tile.png',
                alt: 'SAR tile',
              },
            ],
          },
        },
        {
          id: 'sandbox-ok',
          type: 'sandbox',
          title: 'Play',
          data: {
            starterCode: "open('/inputs/scene.npy', 'rb')\n",
            encouragement: '',
            inputs: [
              { kind: 'file', src: `/api/courses/${SLUG}/assets/inputs/scene.npy`, filename: 'scene.npy' },
            ],
          },
        },
      ]),
      SLUG,
    );

    expect(issues.filter((i) => i.kind === 'undeclared-input')).toEqual([]);
  });

  it('does not flag a bare /inputs/ mention in prose, a dir listing, or a trailing period', async () => {
    const issues = await findLessonAssetIssues(
      lesson([
        {
          id: 'prose-refs',
          type: 'code',
          title: 'ENL',
          data: {
            taskMarkdown: 't',
            starterCode:
              '# Kafelek (Cieśnina Gibraltarska) jest zamontowany w /inputs/.\n' +
              "import os\nprint(os.listdir('/inputs/'))\n" +
              "# Wczytaj plik /inputs/sar-echo-tile.png.\n" +
              "img = cv2.imread('/inputs/sar-echo-tile.png')\n",
            tests: [],
            inputs: [
              { kind: 'image', src: `/api/courses/${SLUG}/assets/images/sar-echo-tile.png`, alt: 'tile' },
            ],
          },
        },
      ]),
      SLUG,
    );
    // The only real read (sar-echo-tile.png) is declared, and `/inputs/.`,
    // `/inputs/'` (listing) and the trailing-period form must not be flagged.
    expect(issues.filter((i) => i.kind === 'undeclared-input')).toEqual([]);
  });

  it('ignores a dynamically-built /inputs path (cannot know the runtime filename)', async () => {
    const issues = await findLessonAssetIssues(
      lesson([
        {
          id: 'dynamic',
          type: 'sandbox',
          title: 'Loop over tiles',
          data: {
            starterCode: "for name in tiles:\n    cv2.imread(f'/inputs/{name}')\n",
            encouragement: '',
          },
        },
      ]),
      SLUG,
    );
    expect(issues).toEqual([]);
  });

  it('returns [] when the lesson has no image references at all', async () => {
    const issues = await findLessonAssetIssues(
      lesson([
        {
          id: 't',
          type: 'theory',
          title: 'No images',
          data: { markdown: 'No images here, just `inline code`.' },
        },
      ]),
      SLUG,
    );
    expect(issues).toEqual([]);
  });
});

describe('formatAssetIssuesError', () => {
  it('lists each issue and gives separate guidance for missing-file vs external-URL fixes', () => {
    const msg = formatAssetIssuesError([
      {
        kind: 'missing-local',
        relativePath: 'assets/plots/foo-1.png',
        origin: 'sections[1] (id=plot, type=plotImage).data.src',
      },
      {
        kind: 'external-image',
        url: 'https://upload.wikimedia.org/x.png',
        origin: 'sections[0] (id=theory, type=theory).data.markdown image',
      },
    ]);
    expect(msg).toContain('MISSING FILE: assets/plots/foo-1.png');
    expect(msg).toContain('EXTERNAL URL (must be cached locally): https://upload.wikimedia.org/x.png');
    expect(msg).toContain('python3');
    expect(msg).toContain('curl');
    expect(msg).toContain('assets/images/');
  });

  it('lists undeclared-input issues with their own actionable guidance', () => {
    const msg = formatAssetIssuesError([
      {
        kind: 'undeclared-input',
        filename: 'sar-echo-tile.png',
        origin: 'sections[3] (id=sar, type=code).data.starterCode',
      },
    ]);
    expect(msg).toContain('UNDECLARED INPUT: /inputs/sar-echo-tile.png');
    expect(msg).toContain("that widget's inputs[]");
    expect(msg).toContain('FileNotFoundError');
  });
});

describe('legacy helpers', () => {
  it('findMissingLessonAssets still returns only the missing-local subset', async () => {
    const missing = await findMissingLessonAssets(
      lesson([
        {
          id: 'theory-1',
          type: 'theory',
          title: 'External',
          data: { markdown: '![w](https://upload.wikimedia.org/x.png)' },
        },
        {
          id: 'plot-1',
          type: 'plotImage',
          title: 'Missing',
          data: { src: `/api/courses/${SLUG}/assets/plots/nope.png`, alt: 'm' },
        },
      ]),
      SLUG,
    );
    expect(missing.map((m) => m.relativePath)).toEqual(['assets/plots/nope.png']);
  });

  it('formatMissingAssetsError still works for legacy callers', () => {
    const msg = formatMissingAssetsError([
      {
        relativePath: 'assets/plots/foo-1.png',
        origin: 'sections[1] (id=plot, type=plotImage).data.src',
      },
    ]);
    expect(msg).toContain('foo-1.png');
    expect(msg).toContain('python3');
  });
});
