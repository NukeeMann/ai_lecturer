import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Lesson, Section } from '@/lib/schemas/lesson';

import { courseDir } from './paths';

export interface AssetReference {
  /** Path relative to `courseDir(slug)`, e.g. `assets/plots/foo-1.png`. */
  relativePath: string;
  /** Breadcrumb to surface in retry briefs, e.g. `sections[1].data.src (plotImage)`. */
  origin: string;
}

const API_PREFIX_REGEX = /^\/api\/courses\/([^/]+)\/(.+)$/;
const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*\]\(([^)\s]+)/g;

function parseLocalAssetPath(value: unknown, slug: string): string | null {
  if (typeof value !== 'string') return null;
  const match = API_PREFIX_REGEX.exec(value);
  if (!match || match[1] !== slug) return null;
  return match[2];
}

function pushIfLocal(
  refs: AssetReference[],
  value: unknown,
  slug: string,
  origin: string,
): void {
  const relative = parseLocalAssetPath(value, slug);
  if (relative !== null) refs.push({ relativePath: relative, origin });
}

function collectFromSection(
  section: Section,
  index: number,
  slug: string,
): AssetReference[] {
  const refs: AssetReference[] = [];
  const base = `sections[${index}] (id=${section.id}, type=${section.type})`;
  const data = (section as { data?: Record<string, unknown> }).data ?? {};

  switch (section.type) {
    case 'plotImage':
    case 'video':
      pushIfLocal(refs, (data as { src?: unknown }).src, slug, `${base}.data.src`);
      break;
    case 'demo':
      pushIfLocal(
        refs,
        (data as { imageSrc?: unknown }).imageSrc,
        slug,
        `${base}.data.imageSrc`,
      );
      break;
    case 'code': {
      const inputs = (data as { inputs?: unknown }).inputs;
      if (Array.isArray(inputs)) {
        inputs.forEach((entry, i) => {
          if (entry && typeof entry === 'object') {
            pushIfLocal(
              refs,
              (entry as { src?: unknown }).src,
              slug,
              `${base}.data.inputs[${i}].src`,
            );
          }
        });
      }
      const outputMedia = (data as { outputMedia?: unknown }).outputMedia;
      if (outputMedia && typeof outputMedia === 'object') {
        pushIfLocal(
          refs,
          (outputMedia as { src?: unknown }).src,
          slug,
          `${base}.data.outputMedia.src`,
        );
      }
      break;
    }
    case 'theory': {
      const markdown = (data as { markdown?: unknown }).markdown;
      if (typeof markdown === 'string') {
        MARKDOWN_IMAGE_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = MARKDOWN_IMAGE_REGEX.exec(markdown)) !== null) {
          pushIfLocal(refs, match[1], slug, `${base}.data.markdown image`);
        }
      }
      break;
    }
    default:
      // Other section types either carry no asset paths or (AudioPlayer /
      // TranscriptCloze) are materialized by the dedicated TTS post-processor
      // and don't need a presence check at this layer.
      break;
  }

  return refs;
}

export function collectLessonAssets(lesson: Lesson, slug: string): AssetReference[] {
  const refs: AssetReference[] = [];
  lesson.sections.forEach((section, i) => {
    refs.push(...collectFromSection(section, i, slug));
  });
  return refs;
}

export async function findMissingLessonAssets(
  lesson: Lesson,
  slug: string,
): Promise<AssetReference[]> {
  const refs = collectLessonAssets(lesson, slug);
  if (refs.length === 0) return [];
  const root = courseDir(slug);
  const missing: AssetReference[] = [];
  for (const ref of refs) {
    const abs = path.join(root, ref.relativePath);
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) missing.push(ref);
    } catch {
      missing.push(ref);
    }
  }
  return missing;
}

export function formatMissingAssetsError(missing: AssetReference[]): string {
  const lines = missing.map((m) => `- ${m.relativePath} (referenced by ${m.origin})`);
  return (
    `Lesson references ${missing.length} local asset path(s) that don't exist on disk:\n` +
    lines.join('\n') +
    `\n\nYou MUST create every asset path you reference before declaring the lesson done. ` +
    `For plotImage sections, run the matplotlib sourceCode via Bash (\`python3 -c "..."\`) ` +
    `and save the PNG into the expected file. For inline ![alt](/api/courses/<slug>/assets/...) ` +
    `images in theory markdown, download the source into the assets directory at that path. ` +
    `For Code widget inputs / outputMedia, demo.imageSrc, and video.src, generate or download ` +
    `the file into the matching courses/<slug>/assets/<subdir>/<filename> path. ` +
    `Re-list the lesson directory under courses/<slug>/assets/ after writing the files to confirm everything exists.`
  );
}
