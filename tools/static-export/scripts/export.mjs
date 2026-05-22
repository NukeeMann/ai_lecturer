#!/usr/bin/env node
// Standalone static-site exporter for AI Lecturer courses.
//
// Single course (legacy):
//   npm run export -- <course-slug>
//     → tools/static-export/dist/<slug>/
//
// One or more collections (new) — picks them up from
// ~/.ai-lecturer/collections.json, where the main app stores them:
//   npm run export -- --collection "Matematyka"
//   npm run export -- --collection "Matematyka" --collection "Algebra"
//   npm run export -- --collections "Matematyka,Algebra"
//   npm run export -- --all-collections
//     → tools/static-export/dist/library/  (one home page with all sections)
//
// The widget bundle is built ONCE with Vite and shared by every page in the
// output, so adding more courses/collections only adds tiny HTML files and
// per-course assets. It NEVER writes outside tools/static-export/ and never
// touches the main app's code or node_modules.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolDir = path.resolve(here, '..');
const repoRoot = path.resolve(toolDir, '..', '..');

function die(msg) {
  console.error(`\n[static-export] ERROR: ${msg}\n`);
  process.exit(1);
}

function usage() {
  console.error(`
Usage:
  npm run export -- <course-slug>
      Export a single course to dist/<slug>/ (legacy behaviour).

  npm run export -- --collection <name> [--collection <name> ...]
  npm run export -- --collections <name1,name2,...>
  npm run export -- --all-collections
      Export one or more collections to dist/library/ — a single home page
      with one section per collection, each holding tiles for its courses.

Collections are read from ~/.ai-lecturer/collections.json (the same file the
main app uses). Collection names are matched case-insensitively.
`);
}

function escapeForScript(json) {
  // Prevent a literal </script> in data from closing the inline tag, and
  // also escape U+2028 / U+2029 which are illegal in pre-ES2019 string
  // literals (still safer to escape).
  return json
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
    .replace(new RegExp('\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\u2029', 'g'), '\\u2029');
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

// ---- CLI parsing ----------------------------------------------------------

function parseArgs(argv) {
  const out = {
    positional: null,
    collections: [],
    allCollections: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      out.help = true;
    } else if (a === '--all-collections') {
      out.allCollections = true;
    } else if (a === '--collection') {
      const val = argv[++i];
      if (!val) die('--collection requires a value');
      out.collections.push(val);
    } else if (a.startsWith('--collection=')) {
      out.collections.push(a.slice('--collection='.length));
    } else if (a === '--collections') {
      const val = argv[++i];
      if (!val) die('--collections requires a value');
      for (const s of val.split(',')) {
        const t = s.trim();
        if (t) out.collections.push(t);
      }
    } else if (a.startsWith('--collections=')) {
      const val = a.slice('--collections='.length);
      for (const s of val.split(',')) {
        const t = s.trim();
        if (t) out.collections.push(t);
      }
    } else if (a.startsWith('-')) {
      die(`unknown option: ${a}`);
    } else {
      if (out.positional !== null) {
        die(`unexpected extra argument: ${a}`);
      }
      out.positional = a;
    }
  }
  return out;
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (ą→a, ł→l isn't NFD-decomposed; handled below)
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'collection';
}

// ---- Shared course loading ------------------------------------------------

async function loadCourseWithLessons(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    die(`unsafe course slug: "${slug}"`);
  }
  const courseDir = path.join(repoRoot, 'courses', slug);
  const courseJsonPath = path.join(courseDir, 'course.json');
  if (!(await exists(courseJsonPath))) {
    die(`course not found: ${courseJsonPath}`);
  }
  const course = await readJson(courseJsonPath);

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
          `[static-export] WARN: ${slug}/${ref.slug}.json missing, skipping`,
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
  return { course, nav, lessons, courseDir };
}

async function buildBundle() {
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
  return {
    bundleDir,
    entryFile: entry.file, // e.g. "assets/main-Xab12.js"
    cssFiles: entry.css ?? [],
  };
}

function relPrefix(depth) {
  // depth=0 → "", depth=1 → "../", depth=2 → "../../"
  return '../'.repeat(depth);
}

// ---- MODE 1: single-course (legacy) --------------------------------------

async function exportSingleCourse(slug) {
  console.log(`[static-export] course: ${slug}`);
  const { course, nav, lessons } = await loadCourseWithLessons(slug);
  if (lessons.length === 0) {
    die('no lessons found for this course (nothing to export)');
  }
  console.log(
    `[static-export] ${nav.length} module(s), ${lessons.length} lesson(s)`,
  );

  const { bundleDir, entryFile, cssFiles } = await buildBundle();
  const jsRefBase = entryFile.replace(/^assets\//, 'assets/app/');
  const cssRefsBase = cssFiles.map((c) =>
    c.replace(/^assets\//, 'assets/app/'),
  );

  const distDir = path.join(toolDir, 'dist', slug);
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(path.join(distDir, 'lessons'), { recursive: true });
  await fs.mkdir(path.join(distDir, 'assets'), { recursive: true });

  await fs.cp(
    path.join(bundleDir, 'assets'),
    path.join(distDir, 'assets', 'app'),
    { recursive: true },
  );

  const courseAssets = path.join(repoRoot, 'courses', slug, 'assets');
  if (await exists(courseAssets)) {
    await fs.cp(courseAssets, path.join(distDir, 'assets', 'course'), {
      recursive: true,
    });
    console.log('[static-export] copied course assets');
  }

  // index.html — at depth 0
  await fs.writeFile(
    path.join(distDir, 'index.html'),
    htmlPage({
      title: course.title ?? slug,
      jsHref: jsRefBase,
      cssHrefs: cssRefsBase,
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

  // lessons/*.html — at depth 1
  const lessonPrefix = relPrefix(1);
  for (const lesson of lessons) {
    await fs.writeFile(
      path.join(distDir, 'lessons', `${lesson.slug}.html`),
      htmlPage({
        title: `${lesson.title ?? lesson.slug} · ${course.title ?? slug}`,
        jsHref: lessonPrefix + jsRefBase,
        cssHrefs: cssRefsBase.map((c) => lessonPrefix + c),
        payload: {
          kind: 'lesson',
          courseSlug: slug,
          course,
          lesson,
          nav,
          lessonHrefBase: '',
          indexHref: lessonPrefix + 'index.html',
          courseAssetBase: lessonPrefix + 'assets/course/',
        },
      }),
      'utf8',
    );
  }

  return distDir;
}

// ---- MODE 2: library (collections) ---------------------------------------

async function readCollectionsFile() {
  const file = path.join(os.homedir(), '.ai-lecturer', 'collections.json');
  if (!(await exists(file))) {
    die(`collections file not found: ${file}\n(create one in the main app first)`);
  }
  const data = await readJson(file);
  if (!data || !Array.isArray(data.collections)) {
    die(`collections file is malformed: ${file}`);
  }
  return data.collections;
}

async function exportLibrary({ collectionNames, allCollections }) {
  const all = await readCollectionsFile();

  let picked;
  if (allCollections) {
    picked = all;
  } else {
    const wantedLower = collectionNames.map((n) => n.toLowerCase());
    picked = all.filter((c) => wantedLower.includes(c.name.toLowerCase()));
    const missing = collectionNames.filter(
      (n) =>
        !all.some((c) => c.name.toLowerCase() === n.toLowerCase()),
    );
    if (missing.length > 0) {
      die(
        `collection(s) not found: ${missing.map((n) => `"${n}"`).join(', ')}\nKnown: ${all.map((c) => `"${c.name}"`).join(', ')}`,
      );
    }
  }
  if (picked.length === 0) {
    die('no collections to export');
  }

  // Collect unique course slugs (a course may appear in multiple collections).
  const courseSlugsSet = new Set();
  for (const c of picked) for (const s of c.courseSlugs) courseSlugsSet.add(s);
  const courseSlugs = [...courseSlugsSet];

  console.log(
    `[static-export] library: ${picked.length} collection(s), ${courseSlugs.length} unique course(s)`,
  );

  // Load every course (course.json + lessons/*.json), but skip silently when
  // a course referenced by a collection no longer exists on disk — better to
  // ship the rest than fail the whole bundle.
  const courseData = new Map();
  for (const slug of courseSlugs) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
      console.warn(`[static-export] WARN: skipping unsafe slug "${slug}"`);
      continue;
    }
    const courseDir = path.join(repoRoot, 'courses', slug);
    const courseJsonPath = path.join(courseDir, 'course.json');
    if (!(await exists(courseJsonPath))) {
      console.warn(
        `[static-export] WARN: collection refers to missing course "${slug}" — skipping`,
      );
      continue;
    }
    const loaded = await loadCourseWithLessons(slug);
    courseData.set(slug, loaded);
    console.log(
      `[static-export]   ${slug}: ${loaded.nav.length} module(s), ${loaded.lessons.length} lesson(s)`,
    );
  }

  if (courseData.size === 0) {
    die('no exportable courses across the chosen collections');
  }

  const { bundleDir, entryFile, cssFiles } = await buildBundle();
  const jsRefBase = entryFile.replace(/^assets\//, 'assets/app/');
  const cssRefsBase = cssFiles.map((c) =>
    c.replace(/^assets\//, 'assets/app/'),
  );

  const distDir = path.join(toolDir, 'dist', 'library');
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(path.join(distDir, 'assets', 'course'), { recursive: true });
  await fs.cp(
    path.join(bundleDir, 'assets'),
    path.join(distDir, 'assets', 'app'),
    { recursive: true },
  );

  // Per-course assets at dist/library/assets/course/<slug>/...
  for (const slug of courseData.keys()) {
    const src = path.join(repoRoot, 'courses', slug, 'assets');
    if (await exists(src)) {
      await fs.cp(src, path.join(distDir, 'assets', 'course', slug), {
        recursive: true,
      });
    }
  }
  console.log('[static-export] copied per-course assets');

  // Each course gets its own subtree: dist/library/<slug>/{index.html,lessons/}
  for (const [slug, { course, nav, lessons }] of courseData.entries()) {
    const courseRoot = path.join(distDir, slug);
    await fs.mkdir(path.join(courseRoot, 'lessons'), { recursive: true });

    // Course index — depth 1 from library root
    const coursePrefix = relPrefix(1);
    await fs.writeFile(
      path.join(courseRoot, 'index.html'),
      htmlPage({
        title: course.title ?? slug,
        jsHref: coursePrefix + jsRefBase,
        cssHrefs: cssRefsBase.map((c) => coursePrefix + c),
        payload: {
          kind: 'index',
          courseSlug: slug,
          course,
          nav,
          lessonHrefBase: 'lessons/',
          indexHref: 'index.html',
          courseAssetBase: coursePrefix + `assets/course/${slug}/`,
          homeHref: coursePrefix + 'index.html',
        },
      }),
      'utf8',
    );

    // Lessons — depth 2 from library root
    const lessonPrefix = relPrefix(2);
    for (const lesson of lessons) {
      await fs.writeFile(
        path.join(courseRoot, 'lessons', `${lesson.slug}.html`),
        htmlPage({
          title: `${lesson.title ?? lesson.slug} · ${course.title ?? slug}`,
          jsHref: lessonPrefix + jsRefBase,
          cssHrefs: cssRefsBase.map((c) => lessonPrefix + c),
          payload: {
            kind: 'lesson',
            courseSlug: slug,
            course,
            lesson,
            nav,
            lessonHrefBase: '',
            indexHref: relPrefix(1) + 'index.html', // course index
            courseAssetBase: lessonPrefix + `assets/course/${slug}/`,
            homeHref: lessonPrefix + 'index.html', // library home
          },
        }),
        'utf8',
      );
    }
  }

  // Library home — depth 0
  const libraryCollections = picked.map((c) => ({
    id: c.id,
    name: c.name,
    courses: c.courseSlugs
      .filter((slug) => courseData.has(slug))
      .map((slug) => {
        const { course, lessons } = courseData.get(slug);
        return {
          slug,
          title: course.title ?? slug,
          description: course.description,
          accentColor: course.accentColor,
          icon: course.icon,
          modulesCount: Array.isArray(course.modules) ? course.modules.length : 0,
          lessonsCount: lessons.length,
          href: `${slug}/index.html`,
        };
      }),
  }));

  const libraryTitle =
    picked.length === 1 ? picked[0].name : 'AI Lecturer library';

  await fs.writeFile(
    path.join(distDir, 'index.html'),
    htmlPage({
      title: libraryTitle,
      jsHref: jsRefBase,
      cssHrefs: cssRefsBase,
      payload: {
        kind: 'home',
        courseSlug: '',
        nav: [],
        lessonHrefBase: '',
        indexHref: 'index.html',
        courseAssetBase: '',
        library: {
          title: libraryTitle,
          collections: libraryCollections,
        },
      },
    }),
    'utf8',
  );

  return distDir;
}

// ---- Entrypoint -----------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const wantsLibrary =
    args.allCollections || args.collections.length > 0;

  if (wantsLibrary && args.positional !== null) {
    die('cannot mix a positional <course-slug> with --collection(s).');
  }

  let distDir;
  if (wantsLibrary) {
    distDir = await exportLibrary({
      collectionNames: args.collections,
      allCollections: args.allCollections,
    });
  } else {
    if (!args.positional) {
      usage();
      die('missing <course-slug> or --collection(s) / --all-collections');
    }
    distDir = await exportSingleCourse(args.positional);
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
