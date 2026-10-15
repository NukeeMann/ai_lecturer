// Compact text forms of the EEG widgets for the AI tutor's lesson context
// (serializeSectionBody in context.ts). Node-safe.
//
// Answer keys ARE included — the tutor needs them to coach — under an explicit
// "tutor only" line; the widget's live state (TutorBridge) tells the tutor
// whether the learner has already committed an answer.

import type { EegViewerData } from '@/widgets/EegViewer/schema';
import type { MontageLabData } from '@/widgets/MontageLab/schema';
import type { EegFigureMarkData } from '@/widgets/EegFigureMark/schema';
import type { PatternDrillData } from '@/widgets/PatternDrill/schema';
import type { EegCaseData } from '@/widgets/EegCase/schema';

export const TUTOR_ONLY_KEY_LINE =
  'Answer key (for tutor only — do not reveal before the learner commits an answer):';

function fmtTarget(t: { label: string; onsetSec: number; offsetSec?: number; channels?: string[] }): string {
  const when = t.offsetSec !== undefined ? `${t.onsetSec}–${t.offsetSec} s` : `${t.onsetSec} s`;
  return `- ${t.label} at ${when}${t.channels?.length ? ` (${t.channels.join(', ')})` : ''}`;
}

export function serializeEegViewer(d: EegViewerData): string {
  const parts: string[] = [];
  if (d.source.kind === 'recording') {
    parts.push(`EEG viewer — real recording: ${d.source.src}${d.attribution ? ` (${d.attribution.text}; ${d.attribution.license})` : ''}`);
  } else {
    parts.push(
      `EEG viewer — SYNTHETIC simulation (${d.source.preset ? `preset "${d.source.preset}"` : 'custom spec'}), shown with a "${d.simulationLabel ?? 'SYMULACJA'}" badge; it demonstrates a mechanism and is not a real recording.`,
    );
  }
  if (d.prompt) parts.push(`Prompt: ${d.prompt}`);
  const i = d.initial;
  const init = [
    i.montage && `montage ${i.montage}`,
    i.sensitivityUvPerMm && `${i.sensitivityUvPerMm} µV/mm`,
    i.secondsPerPage && `${i.secondsPerPage} s/page`,
    i.lffHz !== undefined && `LFF ${i.lffHz ?? 'off'}`,
    i.hffHz !== undefined && `HFF ${i.hffHz ?? 'off'}`,
    i.notchHz !== undefined && `notch ${i.notchHz ?? 'off'}`,
  ].filter(Boolean);
  if (init.length) parts.push(`Initial display: ${init.join(', ')}`);
  if (d.task) {
    parts.push(`Task (mark ${d.task.mode === 'range' ? 'time ranges' : 'events'}, tolerance ${d.task.toleranceSec} s): ${d.task.prompt}`);
    parts.push(TUTOR_ONLY_KEY_LINE);
    parts.push(d.task.targets.map(fmtTarget).join('\n'));
    parts.push(`Explanation shown after checking: ${d.task.explanation}`);
  }
  if (d.caption) parts.push(`Caption: ${d.caption}`);
  return parts.join('\n');
}

export function serializeMontageLab(d: MontageLabData): string {
  const parts: string[] = [];
  const scenario = 'preset' in d.scenario ? `preset "${d.scenario.preset}"` : 'custom simulation spec';
  parts.push(
    `Montage lab — SYNTHETIC simulation (${scenario}), always shown with a "${d.simulationLabel ?? 'SYMULACJA'}" badge. The learner switches montages (${d.montages.join(', ')}), sees a head map of the field, and can move the simulated source; the widget computes phase reversals / end-of-chain / referential maxima from the signals.`,
  );
  if (d.prompt) parts.push(`Prompt: ${d.prompt}`);
  if (d.challenges.length) {
    parts.push(`Challenges (answered by clicking the head map or a channel):`);
    parts.push(d.challenges.map((c) => `- ${c.prompt}`).join('\n'));
    parts.push(TUTOR_ONLY_KEY_LINE);
    parts.push(
      d.challenges
        .map((c) => `- ${c.id}: ${c.answer.kind === 'electrode' ? c.answer.electrodes.join(' / ') : c.answer.channels.join(' / ')} — ${c.explanation}`)
        .join('\n'),
    );
  }
  if (d.caption) parts.push(`Caption: ${d.caption}`);
  return parts.join('\n');
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function serializeEegFigureMark(d: EegFigureMarkData): string {
  const parts: string[] = [
    `Mark-the-fragment exercise on a REAL EEG figure: ${d.figure.alt} (${d.figure.attribution.text}; ${d.figure.attribution.license}).`,
    `Task (${d.mode === 'box' ? 'draw boxes' : 'click points'}): ${d.prompt}`,
  ];
  if (d.figure.caption) parts.push(`Caption: ${d.figure.caption}`);
  parts.push(TUTOR_ONLY_KEY_LINE);
  parts.push(
    d.targets
      .map((t) => `- ${t.label} — region x ${pct(t.rect.x)}–${pct(t.rect.x + t.rect.w)}, y ${pct(t.rect.y)}–${pct(t.rect.y + t.rect.h)} of the image`)
      .join('\n'),
  );
  if (d.distractors?.length) parts.push(`Known look-alikes: ${d.distractors.map((x) => x.note).join(' | ')}`);
  parts.push(`Explanation shown after checking: ${d.explanation}`);
  return parts.join('\n');
}

export function serializePatternDrill(d: PatternDrillData): string {
  const label = (id: string) => d.categories.find((c) => c.id === id)?.label ?? id;
  const parts: string[] = [
    `Pattern-recognition drill on REAL EEG figures (${d.items.length} cards, interleaved, missed cards repeat).`,
    `Categories: ${d.categories.map((c, i) => `${i + 1}. ${c.label}`).join('; ')}.`,
  ];
  if (d.prompt) parts.push(`Prompt: ${d.prompt}`);
  if (d.session.showCriteriaChecklist) parts.push('The learner may tick the 6 IFCN criteria for an epileptiform discharge before answering (≥ 4 suggests epileptiform).');
  parts.push(TUTOR_ONLY_KEY_LINE);
  parts.push(d.items.map((it) => `- ${it.figure.alt} → ${label(it.answer)}: ${it.explanation}`).join('\n'));
  return parts.join('\n');
}

export function serializeEegCase(d: EegCaseData): string {
  const parts: string[] = [`Staged EEG case (steps unlock one by one). Vignette: ${d.vignette}`];
  if (d.figure) parts.push(`EEG: REAL figure — ${d.figure.alt} (${d.figure.attribution.text}; ${d.figure.attribution.license}).`);
  if (d.viewer) parts.push(`EEG: interactive viewer (${d.viewer.source.kind === 'simulation' ? 'SYNTHETIC simulation' : 'real recording'}).`);
  parts.push('Steps:');
  parts.push(d.steps.map((s, i) => `${i + 1}. [${s.kind}] ${s.prompt}`).join('\n'));
  parts.push(TUTOR_ONLY_KEY_LINE);
  parts.push(
    d.steps
      .map((s, i) => {
        switch (s.kind) {
          case 'choice':
          case 'multi':
            return `${i + 1}. ${s.correct.map((c) => s.options[c]).join(' + ')} — ${s.explanation}`;
          case 'measure':
            return `${i + 1}. ${s.expected} ± ${s.tolerance} (${s.quantity}) — ${s.explanation}`;
          case 'mark':
            return `${i + 1}. ${s.targets.map((t) => t.label).join('; ')} — ${s.explanation}`;
          case 'reveal':
            return `${i + 1}. ${s.content}`;
        }
      })
      .join('\n'),
  );
  parts.push(`Expert summary (shown at the end): ${d.summary}`);
  return parts.join('\n');
}
