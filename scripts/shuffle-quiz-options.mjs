#!/usr/bin/env node
// Shuffle quiz option positions for a course's lessons so the same index
// (almost always "A" / index 0) isn't perpetually the correct answer.
//
// LLM-generated lessons exhibit a strong recency bias: 40-50% of single-
// select quizzes end up with correct=[0]. Learners notice and start
// pattern-matching instead of thinking. This script rebalances by tasując
// (shuffling) each quiz's options list and updating `correct[]` to follow.
//
// The shuffle is DETERMINISTIC per quiz (seeded by the quiz's `id` +
// lesson slug + course slug). That means:
//   - re-running on the same course is idempotent — same input → same output.
//   - if a lesson is regenerated upstream, the script can be re-run and the
//     output won't be a different random shuffle of identical input.
//
// Usage:
//   node scripts/shuffle-quiz-options.mjs <course-slug>
//
// Options:
//   --dry-run        Print what would change, don't write.
//   --no-backup      Skip writing .pre-shuffle.json sidecars.
//   --quiet          Only print summary, no per-quiz log.
//
// Safe by default: writes .pre-shuffle.json next to each lesson before
// changing it. Re-running creates a new backup only if the file changed.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function die(msg) {
  console.error(`\n[shuffle-quizzes] ERROR: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { slug: null, dryRun: false, backup: true, quiet: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-backup') out.backup = false;
    else if (a === '--quiet') out.quiet = true;
    else if (a.startsWith('-')) die(`unknown flag: ${a}`);
    else if (!out.slug) out.slug = a;
    else die(`unexpected extra arg: ${a}`);
  }
  if (!out.slug) {
    die(
      'usage: node scripts/shuffle-quiz-options.mjs <course-slug> [--dry-run] [--no-backup] [--quiet]',
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(out.slug)) die(`unsafe slug: "${out.slug}"`);
  return out;
}

// Tiny seeded PRNG (mulberry32). Same seed → same sequence; good enough for
// shuffling 4-6 options. Crypto-grade is overkill here.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit hash of a string (FNV-1a variant). */
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Fisher-Yates shuffle of an index array, in-place, seeded. */
function seededShuffle(n, seed) {
  const idx = Array.from({ length: n }, (_, i) => i);
  const rand = mulberry32(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/**
 * Skip shuffling when re-ordering would break the question semantically.
 * Heuristic: if the question text or any option references "first option",
 * "option A/B/C", "wiersz A", "(A)" etc., leave it alone — the author meant
 * to anchor an order. Better safe than wrong.
 */
function looksOrderSensitive(question, options) {
  const haystack = (question + '\n' + options.join('\n')).toLowerCase();
  // Common Polish + English self-references to option positions
  const patterns = [
    /\bopcja [abcd]\b/, /\bopcj[ęeę] [abcd]\b/, /\bwariant [abcd]\b/,
    /\bodpowied[źz] [abcd]\b/,
    /\boption [abcd]\b/, /\banswer [abcd]\b/,
    /\bfirst (option|answer|choice)\b/, /\blast (option|answer|choice)\b/,
    /\b(pierwsza|ostatnia) (opcja|odpowied[źz])\b/,
    /\(\s*[abcd]\s*\)/,
    /none of the (above|below)/, /all of the (above|below)/,
    /żadn[aey] z (powy|poni)/, /wszystkie (powy|poni)/,
  ];
  return patterns.some((re) => re.test(haystack));
}

async function processLesson(lessonPath, opts, courseSlug) {
  const raw = await fs.readFile(lessonPath, 'utf8');
  const lesson = JSON.parse(raw);
  if (!Array.isArray(lesson.sections)) return null;

  let changed = 0;
  let skipped = 0;
  const log = [];

  for (const section of lesson.sections) {
    if (section.type !== 'quiz' || !section.data) continue;
    const d = section.data;
    if (!Array.isArray(d.options) || d.options.length < 2) continue;
    if (!Array.isArray(d.correct) || d.correct.length === 0) continue;

    const before = d.correct.slice();
    if (looksOrderSensitive(d.question ?? '', d.options)) {
      skipped++;
      log.push(`  ${section.id}: SKIP (order-sensitive)`);
      continue;
    }

    const seed = hashStr(
      `${courseSlug}::${lesson.slug}::${section.id}::${d.options.length}`,
    );
    const perm = seededShuffle(d.options.length, seed);

    // Identity permutation? Nothing to do.
    if (perm.every((v, i) => v === i)) {
      log.push(`  ${section.id}: noop (identity)`);
      continue;
    }

    const newOptions = perm.map((oldIdx) => d.options[oldIdx]);
    // correct stores OLD indices; map to NEW positions.
    const oldToNew = new Array(d.options.length);
    perm.forEach((oldIdx, newIdx) => { oldToNew[oldIdx] = newIdx; });
    const newCorrect = d.correct.map((c) => oldToNew[c]).sort((a, b) => a - b);

    d.options = newOptions;
    d.correct = newCorrect;
    changed++;
    log.push(
      `  ${section.id}: correct ${JSON.stringify(before)} → ${JSON.stringify(newCorrect)}` +
        ` (perm ${perm.join(',')})`,
    );
  }

  if (changed === 0 && skipped === 0) return { changed: 0, skipped: 0, log };

  if (!opts.dryRun) {
    if (opts.backup && changed > 0) {
      const backupPath = lessonPath.replace(/\.json$/, '.pre-shuffle.json');
      // Don't clobber an existing backup — preserves the truly-original copy.
      try {
        await fs.access(backupPath);
      } catch {
        await fs.writeFile(backupPath, raw, 'utf8');
      }
    }
    if (changed > 0) {
      await fs.writeFile(
        lessonPath,
        JSON.stringify(lesson, null, 2) + '\n',
        'utf8',
      );
    }
  }
  return { changed, skipped, log };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const courseDir = path.join(repoRoot, 'courses', opts.slug);
  const lessonsDir = path.join(courseDir, 'lessons');

  try {
    await fs.access(lessonsDir);
  } catch {
    die(`lessons dir not found: ${lessonsDir}`);
  }

  const files = (await fs.readdir(lessonsDir))
    .filter((f) => f.endsWith('.json') && !f.endsWith('.pre-shuffle.json'))
    .sort();

  console.log(`[shuffle-quizzes] course: ${opts.slug}`);
  console.log(`[shuffle-quizzes] lessons: ${files.length}`);
  if (opts.dryRun) console.log(`[shuffle-quizzes] DRY RUN — no files will be modified`);

  let totalChanged = 0;
  let totalSkipped = 0;
  let lessonsTouched = 0;

  for (const f of files) {
    const r = await processLesson(path.join(lessonsDir, f), opts, opts.slug);
    if (!r) continue;
    if (r.changed > 0) lessonsTouched++;
    totalChanged += r.changed;
    totalSkipped += r.skipped;
    if (!opts.quiet && (r.changed > 0 || r.skipped > 0)) {
      console.log(`\n[${f}] changed=${r.changed} skipped=${r.skipped}`);
      r.log.forEach((line) => console.log(line));
    }
  }

  console.log(`\n[shuffle-quizzes] ===== SUMMARY =====`);
  console.log(`[shuffle-quizzes] lessons touched: ${lessonsTouched}/${files.length}`);
  console.log(`[shuffle-quizzes] quizzes shuffled: ${totalChanged}`);
  console.log(`[shuffle-quizzes] quizzes skipped (order-sensitive): ${totalSkipped}`);
  if (!opts.dryRun && opts.backup) {
    console.log(`[shuffle-quizzes] backups: lessons/*.pre-shuffle.json (first run only)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
