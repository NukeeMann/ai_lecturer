// EXPORT step (offline workflow): for a course, write ready-to-paste prompt
// files (instructions + a JSON array of polishable fields) plus a sidecar map
// per file. You paste each .prompt.md into Gemini on the web; Gemini returns a
// JSON array; that goes back through the APPLY step.
//
// Lessons are packed into files by a field budget (never splitting a lesson),
// so each paste's expected output stays small enough to avoid truncation.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadCourseLessons } from './loadCourse.mjs';
import { collectFields } from './walker.mjs';
import { hintFor, buildBatchPrompt } from './prompt.mjs';
import { maskProtected } from './protectedTokens.mjs';

function pad(n, w = 3) {
  return String(n).padStart(w, '0');
}

export async function exportPrompts(courseSlug, { lesson = null, maxChars = 10000, maxFields = 150, outDir, fresh = false } = {}) {
  // Guard FIRST: never silently destroy finished work. NNN.result.json files
  // are pasted/generated replies — re-exporting would orphan or delete them.
  const existing = await fs.readdir(outDir).catch(() => []);
  const existingResults = existing.filter((e) => e.endsWith('.result.json'));
  if (existingResults.length > 0 && !fresh) {
    throw new Error(
      `out dir already contains ${existingResults.length} result file(s) (${outDir}).\n` +
        `  Apply them first (npm run apply) or pass --fresh to wipe and start over.`,
    );
  }

  const { lessons } = await loadCourseLessons(courseSlug, lesson);

  // Flatten every polishable field across all lessons (a lesson may be split
  // across files — apply re-groups by lesson and writes incrementally).
  let gid = 0;
  const items = [];
  for (const { slug, lesson: lessonObj } of lessons) {
    for (const f of collectFields(lessonObj)) {
      const { masked, spans } = maskProtected(f.value);
      items.push({
        id: gid++,
        lesson: slug,
        path: f.path,
        label: f.ctx.label,
        hint: hintFor(f.ctx),
        text: masked, // what Gemini sees (protected spans hidden as ⟦N⟧)
        original: f.value, // pristine text, for the apply-time check
        spans, // ⟦i⟧ -> original span, restored on apply
        len: masked.length,
      });
    }
  }

  // Pack into files by a CHARACTER budget (a proxy for Gemini's output length,
  // which is what truncates). A field bigger than the budget gets its own file.
  const files = [];
  let cur = [];
  let curChars = 0;
  for (const it of items) {
    if (cur.length > 0 && (curChars + it.len > maxChars || cur.length >= maxFields)) {
      files.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(it);
    curChars += it.len;
  }
  if (cur.length) files.push(cur);

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  // (safe: the result-file guard above already ran — by the time we get here
  // the dir holds only regenerable artifacts, or the user passed --fresh)

  const promptHead = buildBatchPrompt();
  const manifest = [`# Export manifest — ${courseSlug}`, '', `Files: ${files.length} (budżet ~${maxChars} znaków/plik)`, ''];

  let fileNo = 0;
  for (const allItems of files) {
    fileNo++;
    const name = pad(fileNo);
    const lessonSlugs = [...new Set(allItems.map((it) => it.lesson))];
    const chars = allItems.reduce((a, it) => a + it.len, 0);

    // .prompt.md — paste this WHOLE file into Gemini on the web.
    const payload = allItems.map((it) => ({ id: it.id, hint: it.hint, text: it.text }));
    const promptBody =
      promptHead + '\n```json\n' + JSON.stringify(payload, null, 2) + '\n```\n';
    await fs.writeFile(path.join(outDir, `${name}.prompt.md`), promptBody);

    // .map.json — sidecar used by APPLY (you don't touch this).
    const map = {
      course: courseSlug,
      file: name,
      lessons: lessonSlugs,
      fields: allItems.map((it) => ({
        id: it.id,
        lesson: it.lesson,
        path: it.path,
        label: it.label,
        original: it.original,
        spans: it.spans,
      })),
    };
    await fs.writeFile(path.join(outDir, `${name}.map.json`), JSON.stringify(map, null, 2));

    manifest.push(
      `- **${name}** — ${allItems.length} pól · ~${chars} znaków · lekcje: ${lessonSlugs.join(', ')}` +
        `  → paste \`${name}.prompt.md\`, save reply to \`${name}.result.json\``,
    );
  }

  await fs.writeFile(path.join(outDir, 'MANIFEST.md'), manifest.join('\n') + '\n');

  return {
    files: fileNo,
    fields: items.length,
    lessons: new Set(items.map((it) => it.lesson)).size,
    outDir,
  };
}
