#!/usr/bin/env node
// EXPORT step: generate ready-to-paste Gemini prompt files for a course.
//
//   npm run export -- <course-slug> [--lesson <slug>] [--max-fields N] [--out <dir>]
//
// Each out/<slug>/NNN.prompt.md is a self-contained prompt (instructions + a
// JSON array of that batch's polishable fields). Paste the WHOLE file into
// Gemini on the web, then save Gemini's JSON reply to out/<slug>/NNN.result.json
// and run the apply step (npm run apply).

import path from 'node:path';
import { toolDir } from '../src/paths.mjs';
import { exportPrompts } from '../src/exportPrompts.mjs';

function die(m) {
  console.error(`\n[gemini-polish:export] ERROR: ${m}\n`);
  process.exit(1);
}

function parse(argv) {
  const o = { slug: null, lesson: null, maxChars: 10000, maxFields: 150, out: null, fresh: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--fresh') o.fresh = true;
    else if (a === '--lesson') o.lesson = argv[++i];
    else if (a.startsWith('--lesson=')) o.lesson = a.slice(9);
    else if (a === '--max-chars') o.maxChars = Number(argv[++i]);
    else if (a.startsWith('--max-chars=')) o.maxChars = Number(a.slice(12));
    else if (a === '--max-fields') o.maxFields = Number(argv[++i]);
    else if (a.startsWith('--max-fields=')) o.maxFields = Number(a.slice(13));
    else if (a === '--out') o.out = argv[++i];
    else if (a.startsWith('--out=')) o.out = a.slice(6);
    else if (a.startsWith('-')) die(`unknown option: ${a}`);
    else if (o.slug === null) o.slug = a;
    else die(`unexpected argument: ${a}`);
  }
  return o;
}

const o = parse(process.argv.slice(2));
if (o.help || !o.slug) {
  console.error(`Usage: npm run export -- <course-slug> [--lesson <slug>] [--max-chars N] [--max-fields N] [--out <dir>] [--fresh]
Generates paste-ready Gemini prompt files under out/<slug>/.
  --max-chars  character budget per file (proxy for Gemini's output length; default 10000).
               Lower it if Gemini truncates replies; raise it for fewer, bigger pastes
               (e.g. --max-chars 25000 in AI Studio with Max output tokens = 8192).
  --fresh      wipe out/<slug>/ even if it contains NNN.result.json files
               (without it, export refuses to destroy finished work).`);
  process.exit(o.slug ? 0 : 1);
}
if (!Number.isFinite(o.maxChars) || o.maxChars < 500) o.maxChars = 10000;
if (!Number.isFinite(o.maxFields) || o.maxFields < 1) o.maxFields = 150;

const outDir = o.out ? path.resolve(o.out) : path.join(toolDir, 'out', o.slug);

const res = await exportPrompts(o.slug, { lesson: o.lesson, maxChars: o.maxChars, maxFields: o.maxFields, outDir, fresh: o.fresh }).catch((e) => die(e.message));

console.error(`[gemini-polish:export] ${res.lessons} lesson(s), ${res.fields} field(s) → ${res.files} file(s)`);
console.error(`  out: ${res.outDir}`);
console.error('');
console.error('Next steps:');
console.error(`  1. Open ${path.join(res.outDir, 'MANIFEST.md')} to see the batches.`);
console.error(`  2. For each NNN.prompt.md: paste the WHOLE file into Gemini (web), then`);
console.error(`     paste Gemini's JSON reply into NNN.result.json (pre-created empty as []).`);
console.error(`  3. Run: npm run apply -- ${o.slug}        (or per file: --file NNN)`);
console.error(`     (add --dry to preview without writing. Files still holding [] are pending.)`);
