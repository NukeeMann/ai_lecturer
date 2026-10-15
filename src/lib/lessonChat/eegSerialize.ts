// Compact text forms of the EEG widgets for the AI tutor's lesson context
// (serializeSectionBody in context.ts). Node-safe.
//
// Answer keys ARE included — the tutor needs them to coach — under an explicit
// "tutor only" line; the widget's live state (TutorBridge) tells the tutor
// whether the learner has already committed an answer.

import type { EegViewerData } from '@/widgets/EegViewer/schema';

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
