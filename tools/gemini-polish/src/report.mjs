// Markdown report rendering: a per-field diff report and an aggregated
// concerns / added-context report.

function blockquote(text) {
  return String(text)
    .split('\n')
    .map((l) => '> ' + l)
    .join('\n');
}

const STATUS_LABEL = {
  applied: '✅ APPLIED',
  rejected: '⛔ REJECTED (kept original — needs manual review)',
  unchanged: '· unchanged',
  missing: '❓ MISSING (no result for this id — model dropped/truncated)',
  stale: '⏭ STALE (lesson text changed since export — skipped, re-export to polish it)',
  'gemini-error': '⚠️ GEMINI-ERROR (kept original)',
};

export function renderDiffReport({ slug, model, mode, stamp, lessonReports }) {
  const lines = [];
  lines.push(`# Polish diff — ${slug}`);
  lines.push(`Model: ${model} · Mode: ${mode} · ${stamp}`);
  lines.push('');

  for (const lr of lessonReports) {
    const c = lr.counts;
    lines.push(`---`);
    lines.push(`## ${lr.lessonSlug}`);
    const writeNote = lr.wrote
      ? `written${lr.backup ? ` (backup: ${lr.backup})` : ''}`
      : mode === 'APPLY'
        ? lr.validation && !lr.validation.ok
          ? 'NOT written — schema validation failed'
          : 'NOT written — no accepted changes'
        : 'dry-run (not written)';
    lines.push(
      `applied: ${c.applied} · rejected: ${c.rejected} · unchanged: ${c.unchanged} · missing: ${c.missing ?? 0}${c.stale ? ` · stale: ${c.stale}` : ''}${c.errored ? ` · errored: ${c.errored}` : ''} — ${writeNote}`,
    );
    if (lr.validation && !lr.validation.ok) {
      lines.push('');
      lines.push('**Schema validation FAILED — lesson left untouched:**');
      lines.push('```');
      lines.push((lr.validation.errors || '').slice(0, 1500));
      lines.push('```');
    }
    for (const w of lr.warnings || []) lines.push(`- ⓘ ${w}`);
    lines.push('');

    for (const rec of lr.records) {
      if (rec.status === 'unchanged') continue; // keep the report focused
      lines.push(`### ${rec.label} — ${STATUS_LABEL[rec.status] || rec.status}`);
      if (rec.reason) lines.push(`*${rec.reason}*`);
      if (rec.status === 'applied') {
        if (rec.addedContext) lines.push(`*(addedContext: a clarifying sentence was added — verify)*`);
        lines.push('**Przed:**');
        lines.push(blockquote(rec.before));
        lines.push('**Po:**');
        lines.push(blockquote(rec.after));
      } else if (rec.status === 'rejected') {
        lines.push('**Oryginał (zachowany):**');
        lines.push(blockquote(rec.before));
      }
      lines.push('');
    }
  }
  return lines.join('\n') + '\n';
}

export function renderConcernsReport({ slug, model, stamp, lessonReports }) {
  const lines = [];
  lines.push(`# Concerns & added context — ${slug}`);
  lines.push(`Model: ${model} · ${stamp}`);
  lines.push('');
  lines.push('> Suspected errors are flagged, NOT fixed. Added clarifications are new');
  lines.push('> sentences the polisher introduced — verify they add no wrong facts.');
  lines.push('');

  // Suspected errors
  const allConcerns = [];
  const added = [];
  for (const lr of lessonReports) {
    for (const c of lr.concerns) allConcerns.push({ ...c, lesson: lr.lessonSlug });
    for (const rec of lr.records) {
      if (rec.status === 'applied' && rec.addedContext) {
        added.push({ lesson: lr.lessonSlug, field: rec.label, before: rec.before, after: rec.after });
      }
    }
  }

  const sev = { high: 0, medium: 1, low: 2 };
  allConcerns.sort((a, b) => (sev[a.severity] ?? 1) - (sev[b.severity] ?? 1));

  lines.push(`## Suspected errors (verify manually) — ${allConcerns.length}`);
  if (allConcerns.length === 0) lines.push('_none_');
  for (const c of allConcerns) {
    lines.push(`- **[${c.severity}]** ${c.lesson} · ${c.field}: ${c.issue}`);
  }
  lines.push('');

  lines.push(`## Added clarifications (new sentences) — ${added.length}`);
  if (added.length === 0) lines.push('_none_');
  for (const a of added) {
    lines.push(`- ${a.lesson} · ${a.field}`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}
