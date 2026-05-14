import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Lesson, Section } from '@/lib/schemas/lesson';

import { courseDir } from './paths';

/**
 * An issue found while inspecting a lesson's asset references. The runner
 * uses this both to refuse marking the lesson done and to build a retry brief
 * the agent can act on without guessing what's wrong.
 */
export type AssetIssue =
  | {
      /** A local `/api/courses/<slug>/assets/...` path that doesn't exist on disk. */
      kind: 'missing-local';
      relativePath: string;
      origin: string;
    }
  | {
      /**
       * An external `http(s)://` URL in a position where the lesson must reference
       * a locally-cached asset (so courses stay offline-viewable and resilient to
       * link rot).
       */
      kind: 'external-image';
      url: string;
      origin: string;
    };

const API_PREFIX_REGEX = /^\/api\/courses\/([^/]+)\/(.+)$/;
const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*\]\(([^)\s]+)/g;
const EXTERNAL_URL_REGEX = /^https?:\/\//i;

function parseLocalAssetPath(value: unknown, slug: string): string | null {
  if (typeof value !== 'string') return null;
  const match = API_PREFIX_REGEX.exec(value);
  if (!match || match[1] !== slug) return null;
  return match[2];
}

function classifyImageRef(
  value: unknown,
  slug: string,
  origin: string,
): { ref: { relativePath: string; origin: string } } | { issue: AssetIssue } | null {
  if (typeof value !== 'string') return null;
  const local = parseLocalAssetPath(value, slug);
  if (local !== null) return { ref: { relativePath: local, origin } };
  if (EXTERNAL_URL_REGEX.test(value)) {
    return { issue: { kind: 'external-image', url: value, origin } };
  }
  // Relative paths (`/cameraman.png`, `/foo.png`) and `/api/courses/<other-slug>/...`
  // pass through silently — they are either served from /public, owned by another
  // course, or otherwise outside our enforcement scope.
  return null;
}

interface CollectedRefs {
  local: { relativePath: string; origin: string }[];
  external: AssetIssue[];
}

function pushImage(
  acc: CollectedRefs,
  value: unknown,
  slug: string,
  origin: string,
): void {
  const cls = classifyImageRef(value, slug, origin);
  if (!cls) return;
  if ('ref' in cls) acc.local.push(cls.ref);
  else acc.external.push(cls.issue);
}

function collectFromSection(
  section: Section,
  index: number,
  slug: string,
  acc: CollectedRefs,
): void {
  const base = `sections[${index}] (id=${section.id}, type=${section.type})`;
  const data = (section as { data?: Record<string, unknown> }).data ?? {};

  switch (section.type) {
    case 'plotImage':
      pushImage(acc, (data as { src?: unknown }).src, slug, `${base}.data.src`);
      break;
    case 'video': {
      // YouTube videos are referenced by URL by design; only the `mp4` kind
      // expects a locally-served file.
      const kind = (data as { kind?: unknown }).kind;
      if (kind === 'mp4') {
        pushImage(acc, (data as { src?: unknown }).src, slug, `${base}.data.src`);
      }
      break;
    }
    case 'demo':
      pushImage(
        acc,
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
            pushImage(
              acc,
              (entry as { src?: unknown }).src,
              slug,
              `${base}.data.inputs[${i}].src`,
            );
          }
        });
      }
      const outputMedia = (data as { outputMedia?: unknown }).outputMedia;
      if (outputMedia && typeof outputMedia === 'object') {
        pushImage(
          acc,
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
          pushImage(acc, match[1], slug, `${base}.data.markdown image`);
        }
      }
      break;
    }
    default:
      // Other section types either carry no asset paths or (AudioPlayer /
      // TranscriptCloze) are materialized by the dedicated TTS post-processor.
      break;
  }
}

function collect(lesson: Lesson, slug: string): CollectedRefs {
  const acc: CollectedRefs = { local: [], external: [] };
  lesson.sections.forEach((s, i) => collectFromSection(s, i, slug, acc));
  return acc;
}

/**
 * Local-only ref collector kept for callers that just want the list of expected
 * filesystem paths (e.g. tooling that materializes assets).
 */
export function collectLessonAssets(
  lesson: Lesson,
  slug: string,
): { relativePath: string; origin: string }[] {
  return collect(lesson, slug).local;
}

export async function findLessonAssetIssues(
  lesson: Lesson,
  slug: string,
): Promise<AssetIssue[]> {
  const { local, external } = collect(lesson, slug);
  const issues: AssetIssue[] = [...external];
  if (local.length > 0) {
    const root = courseDir(slug);
    for (const ref of local) {
      const abs = path.join(root, ref.relativePath);
      try {
        const stat = await fs.stat(abs);
        if (!stat.isFile()) {
          issues.push({
            kind: 'missing-local',
            relativePath: ref.relativePath,
            origin: ref.origin,
          });
        }
      } catch {
        issues.push({
          kind: 'missing-local',
          relativePath: ref.relativePath,
          origin: ref.origin,
        });
      }
    }
  }
  return issues;
}

export function formatAssetIssuesError(issues: AssetIssue[]): string {
  const missing = issues.filter((i): i is Extract<AssetIssue, { kind: 'missing-local' }> => i.kind === 'missing-local');
  const external = issues.filter((i): i is Extract<AssetIssue, { kind: 'external-image' }> => i.kind === 'external-image');
  const lines: string[] = [];
  for (const m of missing) {
    lines.push(`- MISSING FILE: ${m.relativePath} (referenced by ${m.origin})`);
  }
  for (const e of external) {
    lines.push(`- EXTERNAL URL (must be cached locally): ${e.url} (referenced by ${e.origin})`);
  }
  const guidance: string[] = [
    `\nFix each issue before declaring the lesson done.`,
  ];
  if (missing.length > 0) {
    guidance.push(
      `For MISSING FILE entries: ` +
        `for plotImage, run the matplotlib sourceCode via Bash (\`python3 -c "..."\`) and save the PNG into the expected file. ` +
        `For Code widget inputs / outputMedia, demo.imageSrc, and video.src, generate or download the file into the matching courses/<slug>/assets/<subdir>/<filename> path. ` +
        `Re-list the lesson directory under courses/<slug>/assets/ after writing the files to confirm everything exists.`,
    );
  }
  if (external.length > 0) {
    guidance.push(
      `For EXTERNAL URL entries: every image in a lesson MUST be cached locally so the course stays offline-viewable and resilient to link rot. ` +
        `For each URL: download with \`curl -L -o courses/<slug>/assets/images/<descriptive-filename.ext> "<URL>"\` ` +
        `(create the directory first with \`mkdir -p\`), then rewrite the field / markdown reference to point at \`/api/courses/<slug>/assets/images/<descriptive-filename.ext>\` instead of the http(s) URL. ` +
        `Pick a stable, descriptive filename based on what the image shows (e.g. \`pinhole-camera-diagram.png\`), not the original CDN path. ` +
        `External http(s) URLs are NEVER acceptable in theory inline images, plotImage.src, demo.imageSrc, code inputs/outputMedia, or mp4 video.src.`,
    );
  }
  return (
    `Lesson has ${issues.length} asset issue(s) that block marking it done:\n` +
    lines.join('\n') +
    guidance.join(' ')
  );
}

// ---------- legacy helpers retained for callers built before the broader API ----------

export interface AssetReference {
  relativePath: string;
  origin: string;
}

/**
 * @deprecated Use {@link findLessonAssetIssues} instead — this only surfaces
 * missing local files and ignores external URLs that should also be cached.
 */
export async function findMissingLessonAssets(
  lesson: Lesson,
  slug: string,
): Promise<AssetReference[]> {
  const issues = await findLessonAssetIssues(lesson, slug);
  return issues
    .filter((i): i is Extract<AssetIssue, { kind: 'missing-local' }> => i.kind === 'missing-local')
    .map((i) => ({ relativePath: i.relativePath, origin: i.origin }));
}

/**
 * @deprecated Use {@link formatAssetIssuesError} instead — this only formats
 * missing-file errors.
 */
export function formatMissingAssetsError(missing: AssetReference[]): string {
  return formatAssetIssuesError(
    missing.map((m) => ({
      kind: 'missing-local' as const,
      relativePath: m.relativePath,
      origin: m.origin,
    })),
  );
}
