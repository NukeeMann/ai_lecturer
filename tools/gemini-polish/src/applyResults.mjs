// APPLY step (offline workflow): read Gemini's JSON replies (saved as
// <NNN>.result.json next to each <NNN>.map.json), match them back to fields,
// verify every protected token byte-for-byte, re-validate each lesson against
// LessonSchema, and (unless --dry) write the lessons with a .bak backup.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readJson, exists } from './loadCourse.mjs';
import { lessonFile } from './paths.mjs';
import { getByPath, setByPath } from './walker.mjs';
import { verifyProtectedTokens, summarizeDiff, unmaskProtected } from './protectedTokens.mjs';
import { validateLesson } from './validate.mjs';
import { writeBackup } from './backup.mjs';

function tryArr(str) {
  try { const a = JSON.parse(str); return Array.isArray(a) ? a : null; } catch { return null; }
}

// Slice the first balanced [...] (brace counting respects strings/escapes).
function balancedSlice(s) {
  const start = s.indexOf('[');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

// Robustly extract the first JSON array from a model reply. Tries a CLEAN parse
// first (so we never corrupt a valid reply), and only falls back to the „…"
// straight-quote repair if clean parsing fails (that repair can otherwise mangle
// a legitimate closing quote, e.g. `„rozwiązać”`).
export function extractJsonArray(text) {
  const s0 = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  // 1) clean
  let a = tryArr(s0); if (a) return a;
  const sl = balancedSlice(s0); if (sl) { a = tryArr(sl); if (a) return a; }
  // 2) fallback: repair a straight " used as a Polish closing quote „…" -> „…”
  const rep = s0.replace(/„([^„”"]*)"/g, '„$1”').replace(/„([^„”"]*)"/g, '„$1”');
  a = tryArr(rep); if (a) return a;
  const rs = balancedSlice(rep); if (rs) { a = tryArr(rs); if (a) return a; }
  return null;
}

function resultIndex(arr) {
  const byId = new Map();
  for (const r of Array.isArray(arr) ? arr : []) {
    if (r && (typeof r.id === 'number' || typeof r.id === 'string')) {
      byId.set(Number(r.id), r);
    }
  }
  return byId;
}

// Apply one map+result pair. Returns an array of per-lesson reports.
async function applyOneFile(mapPath, resultPath, { dryRun, force }) {
  const map = await readJson(mapPath);
  const rawResult = await fs.readFile(resultPath, 'utf8');
  const parsed = extractJsonArray(rawResult);
  if (!parsed) {
    throw new Error(`could not parse a JSON array from ${path.basename(resultPath)} (truncated/malformed?)`);
  }
  const byId = resultIndex(parsed);

  // Group fields by lesson.
  const byLesson = new Map();
  for (const f of map.fields) {
    if (!byLesson.has(f.lesson)) byLesson.set(f.lesson, []);
    byLesson.get(f.lesson).push(f);
  }

  const reports = [];
  for (const [lessonSlug, fields] of byLesson) {
    const file = lessonFile(map.course, lessonSlug);
    if (!(await exists(file))) {
      reports.push({ lessonSlug, records: [], concerns: [], counts: zero(), validation: { ok: false, errors: 'lesson file missing' }, wrote: false, backup: null });
      continue;
    }
    const lesson = await readJson(file);
    const clone = structuredClone(lesson);
    const records = [];
    const concerns = [];
    const counts = zero();

    for (const f of fields) {
      const r = byId.get(Number(f.id));
      const rec = { label: f.label, before: f.original, after: f.original, status: 'unchanged', reason: '', addedContext: false };
      if (!r) {
        rec.status = 'missing';
        rec.reason = 'brak wyniku dla tego id (model pominął/uciął)';
        counts.missing++;
      } else {
        for (const c of normalizeConcerns(r.concerns)) concerns.push({ ...c, field: f.label });
        const maskedPolished = typeof r.polished === 'string' ? r.polished : null;
        // Restore the ⟦N⟧ placeholders to their original protected spans.
        const un = maskedPolished != null
          ? unmaskProtected(maskedPolished, f.spans || [])
          : { ok: false, reason: 'brak pola polished' };
        if (!un.ok) {
          rec.status = 'rejected';
          rec.reason = `placeholder uszkodzony: ${un.reason}`;
          counts.rejected++;
        } else {
          const polished = un.text;
          const current = getByPath(clone, f.path);
          if (r.changed === false || polished.trim() === f.original.trim() || current === polished) {
            rec.status = 'unchanged';
            counts.unchanged++;
          } else if (typeof current === 'string' && current !== f.original) {
            // The lesson text changed since export (manual content fix or a
            // later batch) — never clobber it with a polish derived from the
            // old original. Re-export to polish the current text.
            rec.status = 'stale';
            rec.reason = 'tekst lekcji zmienił się po exporcie (ręczna poprawka?) — pomijam, wykonaj ponowny export';
            counts.stale++;
          } else if (/Rys\.\s*Rys\./.test(polished) && !/Rys\.\s*Rys\./.test(f.original)) {
            // Gemini sometimes writes a literal "Rys." right before the masked
            // "Rys. N" placeholder → "Rys. Rys. N" after unmask.
            rec.status = 'rejected';
            rec.reason = 'artefakt „Rys. Rys.” (model dopisał słowo przed placeholderem numeru rysunku)';
            counts.rejected++;
          } else {
            // Final guard: after unmasking, every protected token must match the
            // original byte-for-byte (it will, unless a span was duplicated).
            const check = verifyProtectedTokens(f.original, polished);
            if (!check.ok) {
              rec.status = 'rejected';
              rec.reason = `protected-token mismatch: ${summarizeDiff(check)}`;
              counts.rejected++;
            } else {
              setByPath(clone, f.path, polished);
              rec.status = 'applied';
              rec.after = polished;
              rec.addedContext = r.addedContext === true;
              counts.applied++;
            }
          }
        }
      }
      records.push(rec);
    }

    const hasAcceptedChanges = counts.applied > 0;
    const validation = hasAcceptedChanges ? await validateLesson(clone) : { ok: true, errors: '' };

    let wrote = false;
    let backup = null;
    if (!dryRun && hasAcceptedChanges && validation.ok) {
      const bak = await writeBackup(file, { force });
      backup = bak.skipped ? `${path.basename(bak.path)} (kept existing)` : path.basename(bak.path);
      await fs.writeFile(file, JSON.stringify(clone, null, 2) + '\n');
      wrote = true;
    }

    reports.push({ lessonSlug, records, concerns, counts, validation, hasAcceptedChanges, wrote, backup, warnings: [] });
  }
  return reports;
}

function zero() {
  return { applied: 0, rejected: 0, unchanged: 0, missing: 0, stale: 0, errored: 0 };
}

function normalizeConcerns(concerns) {
  if (!Array.isArray(concerns)) return [];
  return concerns
    .filter((c) => c && typeof c.issue === 'string' && c.issue.trim())
    .map((c) => ({
      severity: ['low', 'medium', 'high'].includes(c.severity) ? c.severity : 'medium',
      issue: String(c.issue).trim(),
    }));
}

/**
 * Apply all available results in outDir (or just one file via opts.file).
 * Returns { lessonReports, filesApplied, filesPending }.
 */
export async function applyResults(courseSlug, { outDir, file = null, dryRun = false, force = false } = {}) {
  const entries = await fs.readdir(outDir).catch(() => {
    throw new Error(`export dir not found: ${outDir} — run the export step first`);
  });
  const mapFiles = entries.filter((e) => e.endsWith('.map.json')).map((e) => e.slice(0, -'.map.json'.length)).sort();

  const lessonReports = [];
  const pending = [];
  let filesApplied = 0;

  for (const base of mapFiles) {
    if (file && base !== file) continue;
    const mapPath = path.join(outDir, `${base}.map.json`);
    const resultPath = path.join(outDir, `${base}.result.json`);
    if (!(await exists(resultPath))) {
      pending.push(base);
      continue;
    }
    const reports = await applyOneFile(mapPath, resultPath, { dryRun, force });
    lessonReports.push(...reports);
    filesApplied++;
  }

  return { lessonReports, filesApplied, filesPending: pending };
}
