import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Lesson, Section } from '@/lib/schemas/lesson';
import { CodeInputSchema, inputMountName } from '@/widgets/Code/schema';

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
    }
  | {
      /**
       * A literal `/inputs/<filename>` path read by a Code/Sandbox widget's
       * kernel code (`starterCode` / `solution` / `tests[].body`) that the
       * widget does NOT declare in its own `inputs[]`. Each widget mounts only
       * its own inputs, so an undeclared reference raises `FileNotFoundError`
       * at run time (see `buildInputsMountCode` / `rewriteInputsPath`).
       */
      kind: 'undeclared-input';
      filename: string;
      origin: string;
    };

const API_PREFIX_REGEX = /^\/api\/courses\/([^/]+)\/(.+)$/;
const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*\]\(([^)\s]+)/g;
const EXTERNAL_URL_REGEX = /^https?:\/\//i;

// A literal reference to the virtual `/inputs/<filename>` mount, captured at a
// path boundary (mirrors `INPUTS_PATH_RE` in `codeRun.ts`): preceded by a
// string/line start or a non-word, non-slash char so `foo/inputs/x` (an
// unrelated directory) doesn't match. The filename must start AND end with a
// word char or hyphen — never a dot — so a flat literal like
// `'/inputs/scene.png'` is caught while these are correctly skipped:
//   - a bare mount / dir listing: `'/inputs/'`, `os.listdir('/inputs/')`
//   - a prose sentence ending on the path: `# kafelek leży w /inputs/.`
//   - a trailing period after a real name: `# wczytaj /inputs/scene.png.`
//     (captures `scene.png`, not `scene.png.`)
//   - a dynamic path: `f'/inputs/{name}'` (we can't know the runtime filename)
const INPUTS_REF_REGEX = /(?:^|[^\w/])\/inputs\/([\w-](?:[\w.\-]*[\w-])?)/g;

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
  undeclaredInputs: AssetIssue[];
}

/**
 * For a Code / Sandbox widget, flag every literal `/inputs/<filename>` its
 * kernel code reads that the widget does not declare in its own `inputs[]`.
 * Each widget mounts only its own inputs, so an undeclared reference is a
 * guaranteed run-time `FileNotFoundError` — we catch it at generation time and
 * feed it back into the retry brief instead.
 */
function collectInputRefs(
  data: Record<string, unknown>,
  base: string,
  acc: CollectedRefs,
): void {
  // Mount filenames THIS widget declares (text inputs aren't mounted → null).
  const declared = new Set<string>();
  const inputs = data.inputs;
  if (Array.isArray(inputs)) {
    for (const entry of inputs) {
      const parsed = CodeInputSchema.safeParse(entry);
      if (!parsed.success) continue;
      const name = inputMountName(parsed.data);
      if (name) declared.add(name);
    }
  }

  // Code fragments that run on the kernel and may open a mounted path.
  const fragments: { code: unknown; field: string }[] = [
    { code: data.starterCode, field: 'starterCode' },
    { code: data.solution, field: 'solution' },
  ];
  const tests = data.tests;
  if (Array.isArray(tests)) {
    tests.forEach((t, i) => {
      if (t && typeof t === 'object') {
        fragments.push({ code: (t as { body?: unknown }).body, field: `tests[${i}].body` });
      }
    });
  }

  const seen = new Set<string>();
  for (const { code, field } of fragments) {
    if (typeof code !== 'string') continue;
    INPUTS_REF_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INPUTS_REF_REGEX.exec(code)) !== null) {
      const filename = match[1];
      if (declared.has(filename)) continue;
      const key = `${field}:${filename}`;
      if (seen.has(key)) continue;
      seen.add(key);
      acc.undeclaredInputs.push({
        kind: 'undeclared-input',
        filename,
        origin: `${base}.data.${field}`,
      });
    }
  }
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
      collectInputRefs(data, base, acc);
      break;
    }
    case 'sandbox': {
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
      collectInputRefs(data, base, acc);
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
  const acc: CollectedRefs = { local: [], external: [], undeclaredInputs: [] };
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
  const { local, external, undeclaredInputs } = collect(lesson, slug);
  const issues: AssetIssue[] = [...external, ...undeclaredInputs];
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
  const undeclared = issues.filter((i): i is Extract<AssetIssue, { kind: 'undeclared-input' }> => i.kind === 'undeclared-input');
  const lines: string[] = [];
  for (const m of missing) {
    lines.push(`- MISSING FILE: ${m.relativePath} (referenced by ${m.origin})`);
  }
  for (const e of external) {
    lines.push(`- EXTERNAL URL (must be cached locally): ${e.url} (referenced by ${e.origin})`);
  }
  for (const u of undeclared) {
    lines.push(`- UNDECLARED INPUT: /inputs/${u.filename} read by ${u.origin} but not declared in that widget's inputs[]`);
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
  if (undeclared.length > 0) {
    guidance.push(
      `For UNDECLARED INPUT entries: each Code/Sandbox widget mounts ONLY its own \`inputs[]\` into \`/inputs/\` — there is no shared filesystem across widgets, so a sibling declaring the same file does not help. ` +
        `For each \`/inputs/<filename>\` the widget's code reads, add a matching entry to THAT widget's \`inputs[]\` whose mount name is \`<filename>\` (the basename of \`src\`, or the explicit \`filename\` override). ` +
        `Alternatively, if the file is not actually needed, remove the \`/inputs/<filename>\` reference from the code. ` +
        `An undeclared reference raises \`FileNotFoundError\` the moment the learner clicks Run.`,
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
