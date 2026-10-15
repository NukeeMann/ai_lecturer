// montageLab — montage, polarity and localisation simulator (spec §3.2).
// ALWAYS synthetic (badged). Node-safe: schema + pure helpers.
//
// The lab shows a short epoch (4 s) around one "focus" event of a synthetic
// scenario, a top-view head map coloured by the field of that event, and the
// same epoch in the montage the learner picks. Localisation statements
// (phase reversal, end-of-chain maximum, isoelectric channel, referential
// maximum) are COMPUTED from the derived signals — never hard-coded.

import { z } from 'zod';

import {
  SIM_PRESET_IDS,
  SimulationSpecSchema,
  analyzeChains,
  channelInvolves,
  getMontage,
  maxAmplitudeChannel,
  normalizeElectrode,
  resolveSimulation,
  type DerivedChannel,
  type Montage,
  type SimComponent,
  type SimulationSpec,
  type SphericalPoint,
} from '@/lib/eeg';

// ── Data ─────────────────────────────────────────────────────────────────

export const MontageLabChallengeSchema = z.object({
  id: z.string().min(1),
  /** Markdown question, answered by clicking the head map or a channel. */
  prompt: z.string().min(1),
  answer: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('electrode'), electrodes: z.array(z.string().min(1)).min(1) }),
    z.object({ kind: z.literal('channel'), channels: z.array(z.string().min(1)).min(1) }),
  ]),
  /** Markdown shown after answering. */
  explanation: z.string().min(1),
});

export const MontageLabScenarioSchema = z.union([
  z.object({ preset: z.enum(SIM_PRESET_IDS) }),
  z.object({ spec: SimulationSpecSchema }),
]);

export const MONTAGE_LAB_DEFAULT_MONTAGES = ['LB', 'TB', 'AVG', 'CZ', 'EAR'] as const;

export const MontageLabDataSchema = z
  .object({
    prompt: z.string().optional(),
    scenario: MontageLabScenarioSchema,
    montages: z.array(z.string().min(1)).min(1).default([...MONTAGE_LAB_DEFAULT_MONTAGES]),
    initialMontage: z.string().optional(),
    editable: z
      .object({
        moveSource: z.boolean().default(true),
        polarity: z.boolean().default(true),
        spread: z.boolean().default(true),
      })
      .default({}),
    challenges: z.array(MontageLabChallengeSchema).default([]),
    /** Markdown under the lab (e.g. what to try). */
    caption: z.string().optional(),
    simulationLabel: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    d.montages.forEach((m, i) => {
      if (!getMontage(m)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['montages', i], message: `Unknown montage "${m}"` });
    });
    if (d.initialMontage && !d.montages.some((m) => m.toUpperCase() === d.initialMontage!.toUpperCase())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['initialMontage'], message: 'initialMontage must be one of `montages`' });
    }
    const ids = new Set<string>();
    d.challenges.forEach((c, i) => {
      if (ids.has(c.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['challenges', i, 'id'], message: `Duplicate challenge id "${c.id}"` });
      ids.add(c.id);
      if (c.answer.kind === 'electrode') {
        c.answer.electrodes.forEach((e, j) => {
          if (!normalizeElectrode(e)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['challenges', i, 'answer', 'electrodes', j], message: `Unknown electrode "${e}"` });
          }
        });
      }
    });
  });

export type MontageLabData = z.infer<typeof MontageLabDataSchema>;
export type MontageLabDataInput = z.input<typeof MontageLabDataSchema>;
export type MontageLabChallenge = z.infer<typeof MontageLabChallengeSchema>;

// ── Scenario → lab epoch ─────────────────────────────────────────────────

export const LAB_EPOCH_SEC = 4;
export const LAB_EVENT_AT_SEC = 2;

export function scenarioSpec(data: MontageLabData): SimulationSpec {
  return 'preset' in data.scenario ? resolveSimulation({ preset: data.scenario.preset }) : resolveSimulation({ spec: data.scenario.spec });
}

/** Index of the component the lab focuses on: the first one with event times. */
export function focusComponentIndex(spec: SimulationSpec): number {
  return spec.components.findIndex((c) => 'times' in c && c.times.length > 0);
}

/** Index of the editable source (first discharge), or -1. */
export function editableSourceIndex(spec: SimulationSpec): number {
  return spec.components.findIndex((c) => c.kind === 'discharge');
}

function shiftComponent(c: SimComponent, shift: number, dur: number): SimComponent | null {
  const inside = (t: number) => t >= 0.15 && t <= dur - 0.15;
  if ('times' in c) {
    const times = c.times.map((t) => t + shift).filter(inside);
    return times.length > 0 ? ({ ...c, times } as SimComponent) : null;
  }
  if (c.kind === 'muscle') {
    const bursts = c.bursts.map((b) => ({ ...b, onsetSec: b.onsetSec + shift })).filter((b) => inside(b.onsetSec));
    return bursts.length > 0 ? { ...c, bursts } : null;
  }
  if (c.kind === 'rhythm') {
    const on = Math.max(0, (c.onsetSec ?? 0) + shift);
    const off = c.offsetSec === undefined ? undefined : Math.min(dur, c.offsetSec + shift);
    if (off !== undefined && off <= on + 0.05) return null;
    return { ...c, onsetSec: on, offsetSec: off };
  }
  return c;
}

/**
 * A 4 s spec centred on the focus event (event at 2.0 s), so regeneration
 * while dragging the source stays cheap. Scenarios without a focus event
 * are returned unchanged (whole spec shown).
 */
export function labSpec(spec: SimulationSpec): { spec: SimulationSpec; eventSec: number | null } {
  const fi = focusComponentIndex(spec);
  if (fi < 0) return { spec, eventSec: null };
  const focus = spec.components[fi] as Extract<SimComponent, { times: number[] }>;
  const shift = LAB_EVENT_AT_SEC - focus.times[0];
  const components = spec.components
    .map((c) => shiftComponent(c, shift, LAB_EPOCH_SEC))
    .filter((c): c is SimComponent => c !== null);
  return { spec: { ...spec, durationSec: LAB_EPOCH_SEC, components }, eventSec: LAB_EVENT_AT_SEC };
}

export interface SourceEdit {
  center?: string | SphericalPoint;
  polarity?: 'negative' | 'positive';
  spreadDeg?: number;
}

/** Apply a learner edit to the editable discharge (no-op without one). */
export function withSourceEdit(spec: SimulationSpec, edit: SourceEdit): SimulationSpec {
  const i = editableSourceIndex(spec);
  if (i < 0) return spec;
  const c = spec.components[i] as Extract<SimComponent, { kind: 'discharge' }>;
  const next: SimComponent = {
    ...c,
    center: edit.center ?? c.center,
    polarity: edit.polarity ?? c.polarity,
    spreadDeg: edit.spreadDeg ?? c.spreadDeg,
  };
  const components = spec.components.slice();
  components[i] = next;
  return { ...spec, components };
}

export const SPREAD_RANGE_DEG = { min: 12, max: 70 } as const;

// ── Localisation summary (computed from the data) ────────────────────────

export interface LocalizationSummary {
  /** Polish, learner-facing sentences. */
  lines: string[];
  /** Channels to emphasise (reversal pairs, isoelectric channels, maxima). */
  highlight: number[];
  /** Electrodes the analysis points to. */
  electrodes: string[];
}

const POL = { negative: 'ujemności', positive: 'dodatniości' } as const;

export function summarizeLocalization(
  montage: Montage,
  channels: readonly DerivedChannel[],
  peakIdx: number,
): LocalizationSummary {
  const lines: string[] = [];
  const highlight = new Set<number>();
  const electrodes = new Set<string>();

  if (montage.kind === 'referential') {
    const max = maxAmplitudeChannel(channels, peakIdx);
    if (max) {
      const ch = montage.channels[max.index];
      const sign = max.value < 0 ? 'negative' : 'positive';
      highlight.add(max.index);
      electrodes.add(ch.plus);
      lines.push(
        `Montaż referencyjny: największe wychylenie w kanale **${ch.label}** (${sign === 'negative' ? 'ujemne' : 'dodatnie'}) — maksimum ${POL[sign]} pod **${ch.plus}**. W montażu referencyjnym lokalizujemy po amplitudzie, nie po odwróceniu fazy.`,
      );
    }
    return { lines, highlight: [...highlight], electrodes: [...electrodes] };
  }

  const chains = analyzeChains(montage, channels, peakIdx);
  for (const chain of chains) {
    for (const r of chain.reversals) {
      const up = montage.channels[r.upperIndex];
      const lo = montage.channels[r.lowerIndex];
      highlight.add(r.upperIndex);
      highlight.add(r.lowerIndex);
      r.isoelectricIndices.forEach((i) => highlight.add(i));
      r.electrodes.forEach((e) => electrodes.add(e));
      const where =
        r.isoelectricIndices.length > 0
          ? `między **${r.electrodes.join('** i **')}** (kanał izoelektryczny ${r.isoelectricIndices.map((i) => montage.channels[i].label).join(', ')} — pole równe pod obiema elektrodami)`
          : `pod **${r.electrodes[0]}**`;
      lines.push(
        r.kind === 'negative'
          ? `Ujemne odwrócenie fazy: **${up.label}** i **${lo.label}** wychylają się „do siebie” — maksimum ujemności ${where}.`
          : `Dodatnie odwrócenie fazy: **${up.label}** i **${lo.label}** wychylają się „od siebie” — maksimum dodatniości ${where}.`,
      );
    }
    if (chain.reversals.length === 0 && chain.endMaximum) {
      const m = chain.endMaximum;
      highlight.add(m.channelIndex);
      electrodes.add(m.electrode);
      lines.push(
        `Brak odwrócenia fazy w łańcuchu ${montage.channels[chain.indices[0]].label}…${montage.channels[chain.indices[chain.indices.length - 1]].label}: największe wychylenie na ${m.end === 'start' ? 'początku' : 'końcu'} łańcucha — maksimum ${POL[m.polarity]} na elektrodzie skrajnej **${m.electrode}** („end of chain”).`,
      );
    }
  }
  if (lines.length === 0) lines.push('W tej chwili żaden łańcuch nie pokazuje wyraźnego odwrócenia fazy ani maksimum na końcu łańcucha.');
  return { lines, highlight: [...highlight], electrodes: [...electrodes] };
}

// ── Challenges ───────────────────────────────────────────────────────────

export type ChallengeAnswer = { electrode: string } | { channel: string };

export function checkChallenge(challenge: MontageLabChallenge, answer: ChallengeAnswer): boolean {
  if (challenge.answer.kind === 'electrode') {
    if (!('electrode' in answer)) return false;
    const got = normalizeElectrode(answer.electrode);
    return challenge.answer.electrodes.some((e) => normalizeElectrode(e) === got);
  }
  if (!('channel' in answer)) return false;
  const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  return challenge.answer.channels.some((c) => norm(c) === norm(answer.channel));
}

/** Channels of `montage` that contain `electrode` (for click-to-highlight). */
export function channelsWithElectrode(montage: Montage, electrode: string): number[] {
  return montage.channels.map((ch, i) => (channelInvolves(ch, electrode) ? i : -1)).filter((i) => i >= 0);
}

// ── Persisted state ──────────────────────────────────────────────────────

export const MontageLabStateSchema = z.object({
  v: z.literal(1),
  montage: z.string().optional(),
  answers: z
    .record(z.object({ value: z.string(), correct: z.boolean() }))
    .default({}),
});
export type MontageLabState = z.infer<typeof MontageLabStateSchema>;

// ── Tutor live state ─────────────────────────────────────────────────────

export function describeLabState(i: {
  scenarioLabel: string;
  montageLabel: string;
  source: { center: string; polarity: string; spreadDeg: number } | null;
  summary: LocalizationSummary;
  challenge?: { prompt: string; answered: boolean; correct?: boolean; value?: string } | null;
  challengesDone: number;
  challengesTotal: number;
}): string {
  const lines = [
    `Montage lab — SYNTHETIC simulation (badged "SYMULACJA"; mechanism demo, not a real recording): ${i.scenarioLabel}.`,
    `Montage: ${i.montageLabel}.`,
  ];
  if (i.source) lines.push(`Simulated source: ${i.source.polarity} field centred at ${i.source.center}, spread ${Math.round(i.source.spreadDeg)}°.`);
  lines.push(`Computed localisation (what the learner sees): ${i.summary.lines.join(' ').replace(/\*\*/g, '')}`);
  if (i.challengesTotal > 0) {
    lines.push(`Challenges answered: ${i.challengesDone}/${i.challengesTotal}.`);
    if (i.challenge) {
      lines.push(`Current challenge: ${i.challenge.prompt}`);
      lines.push(
        i.challenge.answered
          ? `Learner answered ${i.challenge.value} — ${i.challenge.correct ? 'correct' : 'incorrect'}.`
          : 'Not answered yet — do not reveal the answer.',
      );
    }
  }
  const text = lines.join('\n');
  return text.length > 2000 ? `${text.slice(0, 1997)}…` : text;
}
