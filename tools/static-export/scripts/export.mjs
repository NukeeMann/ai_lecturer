#!/usr/bin/env node
// Standalone static-site exporter for a single AI Lecturer course.
//
//   cd tools/static-export && npm run export -- <course-slug>
//
// Reads <repo>/courses/<slug>/ (course.json + lessons/*.json + assets/),
// builds the React widget bundle ONCE with Vite, then emits a fully static,
// self-contained site under tools/static-export/dist/<slug>/ — one HTML page
// per lesson plus an index — that you can drop on any static host.
//
// It NEVER writes outside tools/static-export/ and never touches the main
// app's code or node_modules. The widget code is read straight from
// ../../src so exported courses match the running app exactly.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolDir = path.resolve(here, '..');
const repoRoot = path.resolve(toolDir, '..', '..');

function die(msg) {
  console.error(`\n[static-export] ERROR: ${msg}\n`);
  process.exit(1);
}

function escapeForScript(json) {
  // Prevent a literal </script> in data from closing the inline tag.
  return json
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function htmlPage({ title, payload, cssHrefs, jsHref }) {
  const links = cssHrefs
    .map((h) => `<link rel="stylesheet" href="${h}" />`)
    .join('\n    ');
  const data = escapeForScript(JSON.stringify(payload));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title.replace(/</g, '&lt;')}</title>
    ${links}
  </head>
  <body>
    <div id="root"></div>
    <script>window.__SX__ = ${data};</script>
    <script type="module" src="${jsHref}"></script>
  </body>
</html>
`;
}

async function main() {
  const slug = process.argv[2];
  if (!slug || slug.startsWith('-')) {
    die('usage: npm run export -- <course-slug>');
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    die(`unsafe course slug: "${slug}"`);
  }

  const courseDir = path.join(repoRoot, 'courses', slug);
  const courseJsonPath = path.join(courseDir, 'course.json');
  if (!(await exists(courseJsonPath))) {
    die(`course not found: ${courseJsonPath}`);
  }

  console.log(`[static-export] course: ${slug}`);
  const course = await readJson(courseJsonPath);

  // ---- collect lessons + nav ------------------------------------------
  const nav = [];
  const lessons = [];
  const modules = Array.isArray(course.modules) ? course.modules : [];
  for (const m of modules) {
    const navMod = {
      id: m.id,
      title: m.title,
      summary: m.summary,
      lessons: [],
    };
    for (const ref of m.lessons ?? []) {
      const lp = path.join(courseDir, 'lessons', `${ref.slug}.json`);
      if (!(await exists(lp))) {
        console.warn(
          `[static-export] WARN: lesson file missing, skipping: ${ref.slug}.json`,
        );
        continue;
      }
      const lesson = await readJson(lp);
      lessons.push(lesson);
      navMod.lessons.push({
        slug: lesson.slug,
        title: lesson.title ?? ref.title ?? lesson.slug,
        moduleId: m.id,
      });
    }
    if (navMod.lessons.length > 0) nav.push(navMod);
  }
  if (lessons.length === 0) {
    die('no lessons found for this course (nothing to export)');
  }
  console.log(
    `[static-export] ${nav.length} module(s), ${lessons.length} lesson(s)`,
  );

  // ---- build the widget bundle once -----------------------------------
  const bundleDir = path.join(toolDir, '.bundle');
  process.env.SX_OUTDIR = bundleDir;
  console.log('[static-export] building widget bundle with Vite…');
  const { build } = await import('vite');
  await build({
    configFile: path.join(toolDir, 'vite.config.ts'),
    root: toolDir,
    logLevel: 'warn',
  });

  const manifestPath = path.join(bundleDir, '.vite', 'manifest.json');
  if (!(await exists(manifestPath))) {
    die(`Vite manifest not found at ${manifestPath} (build failed?)`);
  }
  const manifest = await readJson(manifestPath);
  const entry =
    manifest['index.html'] ||
    Object.values(manifest).find((e) => e && e.isEntry);
  if (!entry || !entry.file) {
    die('could not locate the JS entry in the Vite manifest');
  }
  // Built files sit under <bundle>/assets/… ; we relocate them to
  // dist/<slug>/assets/app/… so "assets/foo.js" -> "assets/app/foo.js".
  const jsRef = entry.file.replace(/^assets\//, 'assets/app/');
  const cssRefs = (entry.css ?? []).map((c) =>
    c.replace(/^assets\//, 'assets/app/'),
  );

  // ---- assemble dist/<slug>/ ------------------------------------------
  const distDir = path.join(toolDir, 'dist', slug);
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(path.join(distDir, 'lessons'), { recursive: true });
  await fs.mkdir(path.join(distDir, 'assets'), { recursive: true });

  // bundle js/css/worker chunks
  await fs.cp(
    path.join(bundleDir, 'assets'),
    path.join(distDir, 'assets', 'app'),
    { recursive: true },
  );

  // course assets (audio, plots, images referenced by widgets)
  const courseAssets = path.join(courseDir, 'assets');
  if (await exists(courseAssets)) {
    await fs.cp(courseAssets, path.join(distDir, 'assets', 'course'), {
      recursive: true,
    });
    console.log('[static-export] copied course assets');
  }

  // index.html
  await fs.writeFile(
    path.join(distDir, 'index.html'),
    htmlPage({
      title: course.title ?? slug,
      jsHref: jsRef,
      cssHrefs: cssRefs,
      payload: {
        kind: 'index',
        courseSlug: slug,
        course,
        nav,
        lessonHrefBase: 'lessons/',
        indexHref: 'index.html',
        courseAssetBase: 'assets/course/',
      },
    }),
    'utf8',
  );

  // one page per lesson
  for (const lesson of lessons) {
    await fs.writeFile(
      path.join(distDir, 'lessons', `${lesson.slug}.html`),
      htmlPage({
        title: `${lesson.title ?? lesson.slug} · ${course.title ?? slug}`,
        jsHref: `../${jsRef}`,
        cssHrefs: cssRefs.map((c) => `../${c}`),
        payload: {
          kind: 'lesson',
          courseSlug: slug,
          course,
          lesson,
          nav,
          lessonHrefBase: '',
          indexHref: '../index.html',
          courseAssetBase: '../assets/course/',
        },
      }),
      'utf8',
    );
  }

  const rel = path.relative(process.cwd(), distDir);
  console.log(`\n[static-export] ✓ done → ${rel}/`);
  console.log(
    `[static-export] preview locally:  npx serve "${rel}"   (or any static server)`,
  );
  console.log(
    `[static-export] deploy: upload the contents of "${rel}/" to any static host.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
