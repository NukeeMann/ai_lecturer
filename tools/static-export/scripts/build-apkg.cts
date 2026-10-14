// Builds one course's Anki deck with the main app's OWN builder, so the static
// export ships exactly the .apkg the app serves (same GUIDs → re-importing a
// newer export updates cards instead of duplicating them).
//
// Spawned by export.mjs through the main project's tsx, with cwd = repo root
// (the app resolves courses/ against cwd). Reads ../../courses and
// ../../src read-only; writes only the given output file.
//
// Why .cts: this folder's package.json is "type": "module", but tsx compiles
// the app's src/*.ts (no "type" → CommonJS) to CJS. An ESM entry importing
// them by name fails on Node ≥ 22 ("does not provide an export named …");
// a CommonJS entry just require()s them, which works on Node 20–26.
//
//   node <repo>/node_modules/tsx/dist/cli.mjs --tsconfig <repo>/tsconfig.json \
//     tools/static-export/scripts/build-apkg.cts <slug> <out.apkg>
//
// Last stdout line: {"written":bool,"totalCards":n,"subdecks":n,"downloadName":"…"}

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readCourse } from '../../../src/lib/server/courses';
import {
  apkgDownloadNames,
  buildCourseApkg,
  getFlashcardsSummary,
} from '../../../src/lib/server/flashcards';

async function main() {
  const [slug, outFile] = process.argv.slice(2);
  if (!slug || !outFile) {
    console.error('usage: build-apkg.cts <course-slug> <out.apkg>');
    process.exit(2);
  }
  const course = await readCourse(slug);
  const data = course ? await buildCourseApkg(slug) : null;
  if (!course || !data) {
    console.log(JSON.stringify({ written: false }));
    return;
  }
  const summary = await getFlashcardsSummary(slug);
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, data);
  console.log(
    JSON.stringify({
      written: true,
      totalCards: summary?.totalCards ?? 0,
      subdecks: summary?.modules.filter((m) => m.cards > 0).length ?? 0,
      downloadName: apkgDownloadNames(course.title).utf8,
    }),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
