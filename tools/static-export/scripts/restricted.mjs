// Restricted (private-use) content detection for the static exporter.
//
// Convention: copyrighted material that is only licensed for the user's
// private study (e.g. scanned atlas figures, "© … All rights reserved"
// figures) is
//   1. stored under courses/<slug>/assets/private/…, and/or
//   2. referenced from lesson JSON with an attribution that carries
//      "restricted": true (e.g. figure.attribution.restricted).
// The exporter copies courses/<slug>/assets/** wholesale. A static export is
// meant to be shared, so this material must never ship without a loud
// warning. This module finds it, formats that warning, and builds the copy
// filter for the opt-in --exclude-restricted mode.
//
// Pure Node (no deps). Tested by restricted.test.mjs (node --test).

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Folder under courses/<slug>/assets/ that holds private-use files. */
export const PRIVATE_ASSET_DIR = 'private';

/** Written into the export root whenever restricted content is detected. */
export const WARNING_FILE_NAME = 'RESTRICTED-CONTENT-WARNING.txt';

/** Example lines listed per course in the warning (the rest is counted). */
const MAX_EXAMPLES = 8;

// "assets/private/<rest>" anywhere in a string: markdown images, src fields,
// HTML. The tail stops at whitespace, quotes, brackets and markdown syntax.
const PRIVATE_REF_RE = /assets\/private\/[^\s"'()<>[\]{}|`]*/g;
const COURSE_ASSET_RE = /^\/api\/courses\/([^/]+)\/assets\/(.+)$/;

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * Files under courses/<slug>/assets/private/, relative to the assets folder
 * with forward slashes (e.g. "private/atlas/fig-3.png"), sorted. Dotfiles
 * (.DS_Store…) are skipped. Returns [] when the folder does not exist.
 */
export async function listPrivateAssetFiles(courseDir) {
  const assetsDir = path.join(courseDir, 'assets');
  const root = path.join(assetsDir, PRIVATE_ASSET_DIR);
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(toPosix(path.relative(assetsDir, full)));
    }
  }
  await walk(root);
  return out.sort();
}

/**
 * Depth-first walk over parsed JSON. `visit(node, jsonPath, parent)` is
 * called for every value. Paths look like `sections[3].data.figure.src`.
 */
function walkJson(node, jsonPath, parent, visit) {
  visit(node, jsonPath, parent);
  if (Array.isArray(node)) {
    node.forEach((child, i) => walkJson(child, `${jsonPath}[${i}]`, node, visit));
  } else if (node !== null && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      walkJson(child, jsonPath ? `${jsonPath}.${key}` : key, node, visit);
    }
  }
}

function sectionIdForPath(doc, jsonPath) {
  const m = /^sections\[(\d+)\]/.exec(jsonPath);
  if (!m || !Array.isArray(doc?.sections)) return undefined;
  const id = doc.sections[Number(m[1])]?.id;
  return typeof id === 'string' ? id : undefined;
}

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Scans one parsed JSON document (a lesson, or course.json) for restricted
 * markers. It returns
 *   restrictedItems: objects with "restricted": true, with their licence and
 *     text, plus the `src` of the object that owns them (a figure whose
 *     `attribution.restricted` is true);
 *   privateRefs: every "assets/private/…" occurrence inside a string.
 */
export function scanJsonDocument(doc, { lessonSlug } = {}) {
  const restrictedItems = [];
  const privateRefs = [];
  walkJson(doc, '', undefined, (node, jsonPath, parent) => {
    if (typeof node === 'string') {
      for (const m of node.matchAll(PRIVATE_REF_RE)) {
        privateRefs.push({
          lessonSlug,
          sectionId: sectionIdForPath(doc, jsonPath),
          jsonPath,
          ref: m[0],
        });
      }
      return;
    }
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    if (node.restricted !== true) return;
    // An attribution object is owned by its figure: report the figure's src.
    const owner =
      parent && !Array.isArray(parent) && parent.attribution === node ? parent : node;
    restrictedItems.push({
      lessonSlug,
      sectionId: sectionIdForPath(doc, jsonPath),
      jsonPath,
      license: nonEmptyString(node.license),
      text: nonEmptyString(node.text),
      src: nonEmptyString(owner.src),
    });
  });
  return { restrictedItems, privateRefs };
}

/** Maps a lesson asset reference to its path relative to the course's
 *  assets folder, or undefined when it is not one of this course's assets. */
export function courseAssetPath(ref, courseSlug) {
  if (typeof ref !== 'string') return undefined;
  const m = COURSE_ASSET_RE.exec(ref.split(/[?#]/)[0]);
  if (!m || m[1] !== courseSlug) return undefined;
  try {
    return decodeURIComponent(m[2]);
  } catch {
    return m[2];
  }
}

/**
 * Full report for one course. `lessons` / `course` are the parsed JSON the
 * exporter already loaded, and the private files are listed from disk.
 *
 * excludedPaths: asset-relative paths that --exclude-restricted drops in
 * addition to the whole private/ folder, i.e. the files of figures flagged
 * restricted that live elsewhere under assets/.
 */
export async function scanRestrictedContent({ courseSlug, courseDir, course, lessons }) {
  const privateFiles = await listPrivateAssetFiles(courseDir);
  const restrictedItems = [];
  const privateRefs = [];
  if (course) {
    const found = scanJsonDocument(course, { lessonSlug: undefined });
    restrictedItems.push(...found.restrictedItems);
    privateRefs.push(...found.privateRefs);
  }
  for (const lesson of lessons ?? []) {
    const found = scanJsonDocument(lesson, { lessonSlug: lesson?.slug });
    restrictedItems.push(...found.restrictedItems);
    privateRefs.push(...found.privateRefs);
  }

  const excluded = new Set();
  for (const item of restrictedItems) {
    const rel = courseAssetPath(item.src, courseSlug);
    if (rel && !isUnderPrivateDir(rel)) excluded.add(rel);
  }

  const licenses = [
    ...new Set(restrictedItems.map((i) => i.license).filter(Boolean)),
  ].sort();

  return {
    courseSlug,
    courseTitle: nonEmptyString(course?.title),
    privateFiles,
    restrictedItems,
    privateRefs,
    licenses,
    excludedPaths: [...excluded].sort(),
  };
}

export function hasRestrictedContent(report) {
  return (
    report.privateFiles.length > 0 ||
    report.restrictedItems.length > 0 ||
    report.privateRefs.length > 0
  );
}

function isUnderPrivateDir(rel) {
  return rel === PRIVATE_ASSET_DIR || rel.startsWith(`${PRIVATE_ASSET_DIR}/`);
}

/**
 * fs.cp `filter` for copying courses/<slug>/assets with --exclude-restricted.
 * It skips the private/ folder and the files of restricted figures. `report`
 * may be null (nothing extra to skip).
 */
export function makeRestrictedAssetFilter(assetsDir, report) {
  const extra = new Set(report?.excludedPaths ?? []);
  return (src) => {
    const rel = toPosix(path.relative(assetsDir, src));
    if (rel === '') return true;
    if (isUnderPrivateDir(rel)) return false;
    return !extra.has(rel);
  };
}

/** Number of asset files --exclude-restricted leaves out for this report. */
export function countExcludedFiles(report) {
  return report.privateFiles.length + report.excludedPaths.length;
}

function uniqueLessons(items) {
  return [...new Set(items.map((i) => i.lessonSlug ?? 'course.json'))];
}

function where(item) {
  const parts = [item.lessonSlug ?? 'course.json'];
  if (item.sectionId) parts.push(`section ${item.sectionId}`);
  parts.push(item.jsonPath || '(root)');
  return parts.join(' > ');
}

function clip(text, max = 90) {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

const BANNER_WIDTH = 72;

function bannerLine(text = '') {
  const inner = BANNER_WIDTH - 6;
  return `##  ${text.padEnd(inner)}##`;
}

/**
 * The multi-line warning printed to the console and written to
 * RESTRICTED-CONTENT-WARNING.txt. `reports` holds only the courses that have
 * restricted content. `excluded` is true when --exclude-restricted was used.
 */
export function formatRestrictedWarning(reports, { excluded = false } = {}) {
  const rule = '#'.repeat(BANNER_WIDTH);
  const lines = [
    rule,
    bannerLine(),
    bannerLine('WARNING: RESTRICTED (PRIVATE-USE) CONTENT IN THIS EXPORT'),
    bannerLine(),
    excluded
      ? bannerLine('Restricted FILES were excluded, but lessons still refer to')
      : bannerLine('PRIVATE USE ONLY. Do NOT publish, upload or share this'),
    excluded
      ? bannerLine('them. Review the lessons before publishing this export.')
      : bannerLine('export: not on a web host, not by e-mail, not on a stick.'),
    bannerLine(),
    rule,
    '',
  ];

  for (const r of reports) {
    const title = r.courseTitle ? ` (${r.courseTitle})` : '';
    lines.push(`Course "${r.courseSlug}"${title}:`);
    if (r.privateFiles.length > 0) {
      lines.push(
        `  - ${r.privateFiles.length} file(s) under assets/${PRIVATE_ASSET_DIR}/ ` +
          (excluded ? '(NOT copied: --exclude-restricted)' : '(copied into this export)'),
      );
    }
    if (r.restrictedItems.length > 0) {
      lines.push(
        `  - ${r.restrictedItems.length} item(s) marked "restricted": true ` +
          `(in: ${uniqueLessons(r.restrictedItems).join(', ')})`,
      );
    }
    if (r.privateRefs.length > 0) {
      lines.push(
        `  - ${r.privateRefs.length} reference(s) to assets/${PRIVATE_ASSET_DIR}/ ` +
          `(in: ${uniqueLessons(r.privateRefs).join(', ')})`,
      );
    }
    if (excluded && r.excludedPaths.length > 0) {
      lines.push(
        `  - ${r.excludedPaths.length} restricted figure file(s) outside assets/${PRIVATE_ASSET_DIR}/ not copied`,
      );
    }
    lines.push(
      `  - Licences: ${r.licenses.length > 0 ? r.licenses.join('; ') : '(none stated; treat as all rights reserved)'}`,
    );

    const examples = [
      ...r.privateFiles.map((f) => `assets/${f}`),
      ...r.excludedPaths.map((f) => `assets/${f}`),
      ...r.restrictedItems.map((i) => {
        const label = [i.text && `"${clip(i.text, 60)}"`, i.license && `[${i.license}]`]
          .filter(Boolean)
          .join(' ');
        return `${where(i)}${label ? `: ${label}` : ''}`;
      }),
      ...r.privateRefs.map((ref) => `${where(ref)}: ${clip(ref.ref)}`),
    ];
    if (examples.length > 0) {
      lines.push('  Found:');
      for (const ex of examples.slice(0, MAX_EXAMPLES)) lines.push(`    ${ex}`);
      if (examples.length > MAX_EXAMPLES) {
        lines.push(`    … and ${examples.length - MAX_EXAMPLES} more`);
      }
    }
    lines.push('');
  }

  if (excluded) {
    lines.push(
      'The restricted files were left out of this export, so lessons that use',
      'them show missing figures. Captions and attribution lines in the lesson',
      'text are still included; check that they do not reproduce restricted',
      'material before you share the export.',
    );
  } else {
    lines.push(
      'This material is copyrighted and licensed for private study only. Keeping',
      'the export on your own device is fine; publishing or sharing it is not.',
      'To build a shareable copy, re-run the export with --exclude-restricted',
      '(restricted files are left out; lessons that use them will show missing',
      'figures) and replace those figures with openly licensed ones.',
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Writes the warning into the export root and returns the file path. */
export async function writeRestrictedWarningFile(distDir, text, { generatedAt } = {}) {
  const file = path.join(distDir, WARNING_FILE_NAME);
  // Brand-free on purpose, like the rest of a single-course export.
  const header = `Generated by the static exporter${generatedAt ? ` on ${generatedAt}` : ''}.\n\n`;
  await fs.writeFile(file, header + text, 'utf8');
  return file;
}
