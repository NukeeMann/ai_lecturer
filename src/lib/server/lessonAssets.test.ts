import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import type { Lesson } from '@/lib/schemas/lesson';

import {
  collectLessonAssets,
  findMissingLessonAssets,
  formatMissingAssetsError,
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

describe('collectLessonAssets', () => {
  it('extracts plotImage, code inputs/outputMedia, demo imageSrc, video src, and inline theory images', () => {
    const refs = collectLessonAssets(
      lesson([
        {
          id: 'theory-1',
          type: 'theory',
          title: 'Intro',
          data: {
            markdown:
              `Look at ![local](/api/courses/${SLUG}/assets/images/inline-1.png) ` +
              `and ![external](https://example.com/foo.png).`,
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
          id: 'video-1',
          type: 'video',
          title: 'Video',
          data: {
            kind: 'mp4',
            src: `/api/courses/${SLUG}/assets/videos/clip.mp4`,
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

  it('ignores external URLs and references to other course slugs', () => {
    const refs = collectLessonAssets(
      lesson([
        {
          id: 'plot-1',
          type: 'plotImage',
          title: 'External',
          data: { src: 'https://upload.wikimedia.org/foo.png', alt: 'external' },
        },
        {
          id: 'plot-2',
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

describe('findMissingLessonAssets', () => {
  it('returns only refs whose files do not exist on disk', async () => {
    await fs.writeFile(
      path.join(coursesRoot, SLUG, 'assets', 'plots', 'present.png'),
      Buffer.from([0]),
    );
    const missing = await findMissingLessonAssets(
      lesson([
        {
          id: 'plot-present',
          type: 'plotImage',
          title: 'Present',
          data: { src: `/api/courses/${SLUG}/assets/plots/present.png`, alt: 'present' },
        },
        {
          id: 'plot-missing',
          type: 'plotImage',
          title: 'Missing',
          data: { src: `/api/courses/${SLUG}/assets/plots/missing.png`, alt: 'missing' },
        },
      ]),
      SLUG,
    );
    expect(missing.map((m) => m.relativePath)).toEqual(['assets/plots/missing.png']);
    expect(missing[0]?.origin).toContain('plotImage');
  });

  it('returns [] when the lesson references no local assets', async () => {
    const missing = await findMissingLessonAssets(
      lesson([
        {
          id: 't',
          type: 'theory',
          title: 'Theory',
          data: { markdown: 'No images here, just `inline code`.' },
        },
      ]),
      SLUG,
    );
    expect(missing).toEqual([]);
  });
});

describe('formatMissingAssetsError', () => {
  it('mentions each missing path and tells the agent how to fix it', () => {
    const msg = formatMissingAssetsError([
      {
        relativePath: 'assets/plots/foo-1.png',
        origin: 'sections[1] (id=plot, type=plotImage).data.src',
      },
    ]);
    expect(msg).toContain('assets/plots/foo-1.png');
    expect(msg).toContain('plotImage');
    expect(msg).toContain('python3');
  });
});
