// Package AI Lecturer as a read-only macOS app.
//
//   npm run build                                   # "Neurologia Dziecięca", host arch
//   npm run build -- --collection "Matematyka"      # repeatable
//   npm run build -- --arch x64                     # Intel Mac (or: --arch arm64,x64)
//   npm run build -- --skin none                    # plain app look instead of the static-export skin
//   npm run build -- --name "AI Lecturer" --skip-next
//
// Output: build/out/<name>-darwin-<arch>/<name>.app and a .zip next to it.
// See README.md for what ends up in the bundle and why.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { packager } from '@electron/packager';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const buildDir = path.join(here, 'build');
const cacheDir = path.join(here, '.cache');
const NEXT_DIST = '.next-mac';
const NODE_VERSION = 'v22.21.1';

// Learner-irrelevant generation leftovers; everything else in a course dir is
// read by the app (lessons, assets, flashcards, sources, research for the tutor).
const COURSE_SKIP = new Set(['logs', '.generation.log', '.generation-events.ndjson', '.DS_Store']);

function parseArgs(argv) {
  const opts = { collections: [], arch: [process.arch], name: 'AI Lecturer', skin: 'zajawa', skipNext: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--collection') opts.collections.push(argv[++i]);
    else if (a === '--arch') opts.arch = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--name') opts.name = argv[++i];
    else if (a === '--skin') {
      const skin = argv[++i];
      opts.skin = skin === 'none' ? '' : skin;
    }
    else if (a === '--skip-next') opts.skipNext = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (opts.collections.length === 0) opts.collections.push('Neurologia Dziecięca');
  for (const a of opts.arch) {
    if (a !== 'arm64' && a !== 'x64') throw new Error(`--arch must be arm64 and/or x64, got ${a}`);
  }
  return opts;
}

function run(cmd, args, options = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (res.status !== 0) throw new Error(`${cmd} exited with ${res.status}`);
}

function step(msg) {
  console.log(`\n▶ ${msg}`);
}

function selectCollections(names) {
  const file = path.join(os.homedir(), '.ai-lecturer', 'collections.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8')).collections;
  const picked = names.map((name) => {
    const c = all.find((x) => x.name === name);
    if (!c) {
      throw new Error(`Collection "${name}" not found. Available: ${all.map((x) => x.name).join(', ')}`);
    }
    return c;
  });
  return { collections: picked };
}

function buildNext(skin) {
  step('Building Next.js (standalone, read-only)');
  // `next build` with a custom distDir appends `.next-mac/types` to the
  // include list in tsconfig.json; put the developer's file back afterwards.
  const tsconfig = path.join(repo, 'tsconfig.json');
  const tsconfigBefore = fs.readFileSync(tsconfig);
  try {
    run(process.execPath, [path.join(repo, 'node_modules/next/dist/bin/next'), 'build'], {
      cwd: repo,
      env: {
        ...process.env,
        AI_LECTURER_STANDALONE: '1',
        AI_LECTURER_READ_ONLY: '1',
        AI_LECTURER_SKIN: skin,
        AI_LECTURER_TUTOR_DEFAULT_OPEN: '1',
        NEXT_DIST_DIR: NEXT_DIST,
        NEXT_TELEMETRY_DISABLED: '1',
      },
    });
  } finally {
    fs.writeFileSync(tsconfig, tsconfigBefore);
  }
}

function assemblePayload(collectionsFile, opts) {
  const payload = path.join(buildDir, 'payload');
  step(`Assembling payload in ${payload}`);
  fs.rmSync(payload, { recursive: true, force: true });

  const standalone = path.join(repo, NEXT_DIST, 'standalone');
  if (!fs.existsSync(path.join(standalone, 'server.js'))) {
    throw new Error(`No standalone build at ${standalone} — run without --skip-next`);
  }
  const server = path.join(payload, 'server');
  fs.cpSync(standalone, server, { recursive: true, verbatimSymlinks: true });
  // Turbopack links serverExternalPackages as `.next-mac/node_modules/<pkg>-<hash>
  // -> ../../node_modules/<pkg>`. @electron/packager rewrites relative links
  // to absolute paths on THIS machine, so on any other Mac every course 500s.
  // Materialise them as real directories: the payload must hold no symlinks.
  materialiseSymlinks(server);
  fs.cpSync(path.join(repo, NEXT_DIST, 'static'), path.join(server, NEXT_DIST, 'static'), { recursive: true });
  fs.cpSync(path.join(repo, 'public'), path.join(server, 'public'), { recursive: true });
  // The tutor's image MCP server is resolved as <cwd>/scripts/tutor/… at runtime.
  fs.cpSync(path.join(repo, 'tools/scripts/tutor'), path.join(server, 'scripts/tutor'), { recursive: true });

  const courses = path.join(payload, 'courses');
  for (const col of collectionsFile.collections) {
    for (const slug of col.courseSlugs) {
      const src = path.join(repo, 'courses', slug);
      if (!fs.existsSync(path.join(src, 'course.json'))) throw new Error(`Missing course: ${src}`);
      console.log(`  course: ${slug}`);
      fs.cpSync(src, path.join(courses, slug), {
        recursive: true,
        filter: (p) => !COURSE_SKIP.has(path.basename(p)),
      });
    }
  }
  fs.writeFileSync(path.join(payload, 'collections.json'), JSON.stringify(collectionsFile, null, 2));
  // Read by app/main.cjs and passed to the server as AI_LECTURER_SKIN.
  fs.writeFileSync(path.join(payload, 'app-config.json'), JSON.stringify({ skin: opts.skin }, null, 2));
  return payload;
}

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    visit(p, entry);
    if (entry.isDirectory()) walk(p, visit);
  }
}

function materialiseSymlinks(root) {
  const links = [];
  walk(root, (p, entry) => {
    if (entry.isSymbolicLink()) links.push(p);
  });
  for (const link of links) {
    const target = fs.realpathSync(link);
    fs.rmSync(link);
    fs.cpSync(target, link, { recursive: true, dereference: true });
    console.log(`  materialised ${path.relative(root, link)}`);
  }
}

// Fails the build if anything in the bundle could depend on this machine:
// a symlink (packager may have made it absolute) or the repo path baked into
// server code that resolves modules/files at runtime.
function assertSelfContained(bundle) {
  const problems = [];
  walk(path.join(bundle, 'Contents/Resources/payload'), (p, entry) => {
    if (entry.isSymbolicLink()) problems.push(`symlink ${p} -> ${fs.readlinkSync(p)}`);
  });
  if (problems.length > 0) {
    throw new Error(`Bundle is not self-contained:\n  ${problems.join('\n  ')}`);
  }
}

function fetchNode(arch) {
  const name = `node-${NODE_VERSION}-darwin-${arch}`;
  const bin = path.join(cacheDir, name, 'bin', 'node');
  if (fs.existsSync(bin)) return bin;
  step(`Downloading Node ${NODE_VERSION} (${arch})`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const tgz = path.join(cacheDir, `${name}.tar.gz`);
  run('curl', ['-fL', '--progress-bar', '-o', tgz, `https://nodejs.org/dist/${NODE_VERSION}/${name}.tar.gz`]);
  run('tar', ['-xzf', tgz, '-C', cacheDir]);
  fs.rmSync(tgz);
  return bin;
}

function makeIcon() {
  const icns = path.join(buildDir, 'icon.icns');
  if (fs.existsSync(icns)) return icns;
  step('Generating app icon');
  const set = path.join(buildDir, 'icon.iconset');
  fs.mkdirSync(set, { recursive: true });
  const src = path.join(repo, 'src/app/icon.png');
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = size * scale;
      const out = path.join(set, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
      run('sips', ['-z', String(px), String(px), src, '--out', out], { stdio: 'ignore' });
    }
  }
  run('iconutil', ['-c', 'icns', set, '-o', icns]);
  fs.rmSync(set, { recursive: true });
  return icns;
}

async function packageApp(opts, payload, icon, arch) {
  step(`Packaging Electron app (${arch})`);
  fs.copyFileSync(fetchNode(arch), path.join(payload, 'node'));
  fs.chmodSync(path.join(payload, 'node'), 0o755);

  const electronVersion = JSON.parse(
    fs.readFileSync(path.join(here, 'node_modules/electron/package.json'), 'utf8'),
  ).version;
  const outDir = path.join(buildDir, 'out');
  const [appPath] = await packager({
    dir: path.join(here, 'app'),
    out: outDir,
    name: opts.name,
    platform: 'darwin',
    arch,
    electronVersion,
    icon,
    overwrite: true,
    prune: false,
    asar: true,
    appBundleId: 'local.ai-lecturer.reader',
    appCategoryType: 'public.app-category.education',
    extraResource: [payload],
  });

  const bundle = path.join(appPath, `${opts.name}.app`);
  assertSelfContained(bundle);
  // Ad-hoc signature: required for arm64 and keeps Gatekeeper's message to
  // the "unidentified developer" kind (right-click → Open), not "damaged".
  run('codesign', ['--force', '--deep', '--sign', '-', bundle]);

  const zip = path.join(outDir, `${opts.name.replace(/\s+/g, '-')}-${arch}.zip`);
  fs.rmSync(zip, { force: true });
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, zip]);
  return { bundle, zip };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const collectionsFile = selectCollections(opts.collections);
  fs.mkdirSync(buildDir, { recursive: true });

  if (!opts.skipNext) buildNext(opts.skin);
  const payload = assemblePayload(collectionsFile, opts);
  const icon = makeIcon();

  const results = [];
  for (const arch of opts.arch) results.push(await packageApp(opts, payload, icon, arch));

  console.log('\n✔ Done');
  for (const r of results) console.log(`  app: ${r.bundle}\n  zip: ${r.zip}`);
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}`);
  process.exit(1);
});
