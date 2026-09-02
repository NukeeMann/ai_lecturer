#!/usr/bin/env node
// APPLY step: ingest Gemini's JSON replies and write the polished lessons.
//
//   npm run apply -- <course-slug> [--file NNN] [--dry] [--force] [--out <dir>] [--report <dir>]
//
// Reads out/<slug>/NNN.result.json (the JSON array you pasted back from Gemini)
// next to each NNN.map.json, verifies every protected token byte-for-byte,
// re-validates each lesson against LessonSchema, and writes lessons (with .bak)
// unless --dry. Files without a .result.json yet are reported as pending.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { toolDir } from '../src/paths.mjs';
import { applyResults } from '../src/applyResults.mjs';
import { renderDiffReport, renderConcernsReport } from '../src/report.mjs';

function die(m) {
  console.error(`\n[gemini-polish:apply] ERROR: ${m}\n`);
  process.exit(1);
}

function parse(argv) {
  const o = { slug: null, file: null, dry: false, force: false, out: null, report: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--dry') o.dry = true;
    else if (a === '--force') o.force = true;
    else if (a === '--file') o.file = argv[++i];
    else if (a.startsWith('--file=')) o.file = a.slice(7);
    else if (a === '--out') o.out = argv[++i];
    else if (a.startsWith('--out=')) o.out = a.slice(6);
    else if (a === '--report') o.report = argv[++i];
    else if (a.startsWith('--report=')) o.report = a.slice(9);
    else if (a.startsWith('-')) die(`unknown option: ${a}`);
    else if (o.slug === null) o.slug = a;
    else die(`unexpected argument: ${a}`);
  }
  return o;
}

const o = parse(process.argv.slice(2));
if (o.help || !o.slug) {
  console.error(`Usage: npm run apply -- <course-slug> [--file NNN] [--dry] [--force]
Applies Gemini replies (out/<slug>/NNN.result.json) with byte-for-byte token verification.`);
  process.exit(o.slug ? 0 : 1);
}

const outDir = o.out ? path.resolve(o.out) : path.join(toolDir, 'out', o.slug);
const mode = o.dry ? 'DRY-RUN' : 'APPLY';
const stamp = new Date().toISOString();

const { lessonReports, filesApplied, filesPending } = await applyResults(o.slug, {
  outDir,
  file: o.file,
  dryRun: o.dry,
  force: o.force,
}).catch((e) => die(e.message));

// Reports.
const reportDir = o.report ? path.resolve(o.report) : path.join(toolDir, 'reports', o.slug);
await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(path.join(reportDir, `${o.slug}.diff.md`), renderDiffReport({ slug: o.slug, model: 'gemini (web)', mode, stamp, lessonReports }));
await fs.writeFile(path.join(reportDir, `${o.slug}.concerns.md`), renderConcernsReport({ slug: o.slug, model: 'gemini (web)', stamp, lessonReports }));

const tot = lessonReports.reduce(
  (a, lr) => ({
    applied: a.applied + lr.counts.applied,
    rejected: a.rejected + lr.counts.rejected,
    missing: a.missing + (lr.counts.missing || 0),
    stale: a.stale + (lr.counts.stale || 0),
    concerns: a.concerns + lr.concerns.length,
    failed: a.failed + (lr.validation.ok ? 0 : 1),
    wrote: a.wrote + (lr.wrote ? 1 : 0),
  }),
  { applied: 0, rejected: 0, missing: 0, stale: 0, concerns: 0, failed: 0, wrote: 0 },
);

console.error(`[gemini-polish:apply] ${mode} · course=${o.slug}`);
console.error(`  result files applied: ${filesApplied}` + (filesPending.length ? ` · pending (still empty [] / no reply yet): ${filesPending.join(', ')}` : ''));
console.error(`  fields applied:   ${tot.applied}`);
console.error(`  fields rejected:  ${tot.rejected} (protected-token mismatch — kept original)`);
console.error(`  fields missing:   ${tot.missing} (model dropped/truncated an id)`);
if (tot.stale) console.error(`  fields stale:     ${tot.stale} (lesson text changed since export — skipped, never overwritten)`);
console.error(`  suspected errors: ${tot.concerns} (see concerns report)`);
console.error(`  lessons written:  ${tot.wrote}${tot.failed ? ` · validation-failed: ${tot.failed}` : ''}`);
console.error(`  reports: ${path.join(reportDir, `${o.slug}.diff.md`)}`);
console.error(`           ${path.join(reportDir, `${o.slug}.concerns.md`)}`);
if (o.dry) console.error('  (dry-run — no course files modified)');
