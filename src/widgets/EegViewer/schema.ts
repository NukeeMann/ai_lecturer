// eegViewer — multichannel EEG reader (spec §3.1). Node-safe: schema + pure
// helpers only (the widget, the tutor serializer and the static exporter all
// import from here).

import { z } from 'zod';

import {
  DISPLAY_DEFAULTS,
  HFF_OPTIONS,
  LFF_OPTIONS,
  MONTAGE_IDS,
  SECONDS_PER_PAGE_OPTIONS,
  SENSITIVITY_OPTIONS,
  SIM_PRESET_IDS,
  SimulationSpecSchema,
  formatTimeRange,
  type DisplayFilterSettings,
} from '@/lib/eeg';
import { AttributionSchema } from '@/widgets/common/eeg/figure';

// ── Data ─────────────────────────────────────────────────────────────────

export const EegViewerRecordingSourceSchema = z.object({
  kind: z.literal('recording'),
  /** `/api/courses/<slug>/assets/eeg/<name>.json` (format ai-lecturer-eeg@1). */
  src: z.string().min(1),
});

export const EegViewerSimulationSourceSchema = z.object({
  kind: z.literal('simulation'),
  /** One of the built-in mechanism presets (src/lib/eeg/synth.ts). */
  preset: z.enum(SIM_PRESET_IDS).optional(),
  /** Custom simulation (wins over `preset`). */
  spec: SimulationSpecSchema.optional(),
});

export const EegViewerSourceSchema = z
  .discriminatedUnion('kind', [EegViewerRecordingSourceSchema, EegViewerSimulationSourceSchema])
  .superRefine((s, ctx) => {
    if (s.kind === 'simulation' && !s.preset && !s.spec) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['preset'], message: 'A simulation source needs `preset` or `spec`' });
    }
  });

export const EegViewerInitialSchema = z.object({
  montage: z.string().min(1).optional(),
  sensitivityUvPerMm: z.number().positive().max(2000).optional(),
  secondsPerPage: z.number().positive().max(60).optional(),
  /** null = filter off. */
  lffHz: z.number().positive().max(10).nullable().optional(),
  hffHz: z.number().positive().max(200).nullable().optional(),
  notchHz: z.union([z.literal(50), z.literal(60)]).nullable().optional(),
  startSec: z.number().nonnegative().optional(),
  /** 'zero' (default, no latency shift) or 'causal' (amplifier-like look for slow steps). */
  filterPhase: z.enum(['zero', 'causal']).optional(),
});

export const EegViewerControlsSchema = z
  .object({
    montage: z.boolean().default(true),
    sensitivity: z.boolean().default(true),
    timebase: z.boolean().default(true),
    filters: z.boolean().default(true),
    caliper: z.boolean().default(true),
    navigation: z.boolean().default(true),
  })
  .default({});

export const EegViewerTargetSchema = z.object({
  id: z.string().min(1),
  onsetSec: z.number().nonnegative(),
  offsetSec: z.number().nonnegative().optional(),
  /** Electrodes ("T7") or channel labels ("F7-T7") where the event is seen. */
  channels: z.array(z.string().min(1)).optional(),
  label: z.string().min(1),
  required: z.boolean().optional(),
});

export const EegViewerTaskSchema = z
  .object({
    kind: z.literal('markEvents'),
    prompt: z.string().min(1),
    mode: z.enum(['point', 'range']).default('point'),
    targets: z.array(EegViewerTargetSchema).min(1),
    toleranceSec: z.number().nonnegative().max(10).default(0.5),
    requireChannel: z.boolean().default(false),
    maxMarks: z.number().int().positive().optional(),
    /** Markdown shown after Check. */
    explanation: z.string().min(1),
  })
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    t.targets.forEach((tg, i) => {
      if (seen.has(tg.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targets', i, 'id'], message: `Duplicate target id "${tg.id}"` });
      seen.add(tg.id);
      if (tg.offsetSec !== undefined && tg.offsetSec < tg.onsetSec) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targets', i, 'offsetSec'], message: 'offsetSec must not be before onsetSec' });
      }
    });
  });

export const EegViewerDataSchema = z.object({
  /** Markdown above the viewer. */
  prompt: z.string().optional(),
  source: EegViewerSourceSchema,
  initial: EegViewerInitialSchema.default({}),
  controls: EegViewerControlsSchema,
  /** Montage ids the learner may pick (default: every montage the recording supports). */
  allowedMontages: z.array(z.string().min(1)).min(1).optional(),
  /** Expert annotations stored in the recording file. */
  annotations: z.enum(['hidden', 'toggle', 'always']).default('toggle'),
  task: EegViewerTaskSchema.optional(),
  /** Markdown under the viewer. */
  caption: z.string().optional(),
  /** Required for recordings unless the file's `source` block names the dataset + licence. */
  attribution: AttributionSchema.optional(),
  simulationLabel: z.string().optional(),
  /** Canvas height in px (default ≈ 18 px per channel, min 320). */
  height: z.number().int().min(200).max(1600).optional(),
});

export type EegViewerData = z.infer<typeof EegViewerDataSchema>;
export type EegViewerDataInput = z.input<typeof EegViewerDataSchema>;
export type EegViewerSource = z.infer<typeof EegViewerSourceSchema>;
export type EegViewerTask = z.infer<typeof EegViewerTaskSchema>;
export type EegViewerTarget = z.infer<typeof EegViewerTargetSchema>;

/** Asset paths the asset gate must check (recordings only; simulations have none). */
export function eegViewerAssetPaths(data: EegViewerData): string[] {
  return data.source.kind === 'recording' ? [data.source.src] : [];
}

// ── Display settings ─────────────────────────────────────────────────────

export interface ViewerSettings {
  montage: string;
  sensitivityUvPerMm: number;
  secondsPerPage: number;
  lffHz: number | null;
  hffHz: number | null;
  notchHz: number | null;
  startSec: number;
}

/** Width below which the viewer defaults to 5 s pages (traces stay legible on phones). */
export const NARROW_VIEWER_PX = 560;

export function resolveInitialSettings(
  data: EegViewerData,
  opts: { availableMontages: readonly string[]; durationSec: number; narrow: boolean },
): ViewerSettings {
  const init = data.initial;
  const wanted = init.montage?.toUpperCase();
  const montage =
    (wanted && opts.availableMontages.find((m) => m.toUpperCase() === wanted)) ?? opts.availableMontages[0] ?? 'LB';
  const secondsPerPage = init.secondsPerPage ?? (opts.narrow ? 5 : DISPLAY_DEFAULTS.secondsPerPage);
  return {
    montage,
    sensitivityUvPerMm: init.sensitivityUvPerMm ?? DISPLAY_DEFAULTS.sensitivityUvPerMm,
    secondsPerPage,
    lffHz: init.lffHz === undefined ? DISPLAY_DEFAULTS.lffHz : init.lffHz,
    hffHz: init.hffHz === undefined ? DISPLAY_DEFAULTS.hffHz : init.hffHz,
    notchHz: init.notchHz === undefined ? DISPLAY_DEFAULTS.notchHz : init.notchHz,
    startSec: clampStart(init.startSec ?? 0, secondsPerPage, opts.durationSec),
  };
}

/** Keep the page inside the recording (a page longer than the recording starts at 0). */
export function clampStart(startSec: number, secondsPerPage: number, durationSec: number): number {
  const maxStart = Math.max(0, durationSec - secondsPerPage);
  if (!Number.isFinite(startSec)) return 0;
  return Math.min(maxStart, Math.max(0, startSec));
}

/** Next/previous page start; pages overlap by nothing (clinical paging). */
export function pageStart(current: ViewerSettings, direction: 1 | -1, durationSec: number): number {
  return clampStart(current.startSec + direction * current.secondsPerPage, current.secondsPerPage, durationSec);
}

export function filterSettings(s: ViewerSettings, phase: 'zero' | 'causal' | undefined): DisplayFilterSettings {
  return { lffHz: s.lffHz, hffHz: s.hffHz, notchHz: s.notchHz, phase: phase ?? 'zero' };
}

/** Option lists for the toolbar: the standard lists plus any off-list authored value. */
export function withValue<T extends number | null>(options: readonly T[], value: T): T[] {
  return options.includes(value) ? [...options] : [...options, value].sort((a, b) => (a ?? -1) - (b ?? -1));
}

export const VIEWER_OPTIONS = {
  sensitivity: SENSITIVITY_OPTIONS as readonly number[],
  secondsPerPage: SECONDS_PER_PAGE_OPTIONS as readonly number[],
  lff: LFF_OPTIONS,
  hff: HFF_OPTIONS,
} as const;

export const BUILTIN_MONTAGE_IDS: readonly string[] = MONTAGE_IDS;

// ── Persisted widget state ───────────────────────────────────────────────

export const ViewerMarkSchema = z.union([
  z.object({ t: z.number(), channel: z.string().nullable().optional() }),
  z.object({ t0: z.number(), t1: z.number(), channel: z.string().nullable().optional() }),
]);
export type ViewerMark = z.infer<typeof ViewerMarkSchema>;

export const EegViewerStateSchema = z.object({
  v: z.literal(1),
  settings: z
    .object({
      montage: z.string(),
      sensitivityUvPerMm: z.number().positive(),
      secondsPerPage: z.number().positive(),
      lffHz: z.number().nullable(),
      hffHz: z.number().nullable(),
      notchHz: z.number().nullable(),
      startSec: z.number().nonnegative(),
    })
    .optional(),
  marks: z.array(ViewerMarkSchema).max(200).default([]),
  checked: z.boolean().default(false),
});
export type EegViewerState = z.infer<typeof EegViewerStateSchema>;

// ── Text for the AI tutor (live state) ───────────────────────────────────

function fmtFilter(v: number | null, unit = 'Hz'): string {
  return v === null ? 'off' : `${v} ${unit}`;
}

function fmtMark(m: ViewerMark): string {
  const where = m.channel ? ` on ${m.channel}` : '';
  return 't' in m ? `${m.t.toFixed(2)} s${where}` : `${m.t0.toFixed(2)}–${m.t1.toFixed(2)} s${where}`;
}

export interface ViewerLiveStateInput {
  settings: ViewerSettings;
  montageLabel: string;
  durationSec: number;
  synthetic: boolean;
  sourceLabel: string;
  task?: EegViewerTask;
  marks: readonly ViewerMark[];
  checked: boolean;
  result?: { hits: number; misses: number; falseMarks: number } | null;
  caliper?: { dtMs: number; freqHz: number; ppUv: number; channel: string } | null;
}

/** Plain-text description of the current view (≤ 2000 chars) for the tutor bridge. */
export function describeViewerState(i: ViewerLiveStateInput): string {
  const s = i.settings;
  const lines = [
    `EEG viewer — ${i.synthetic ? 'SYNTHETIC simulation (mechanism demo, not a real recording)' : 'real recording'}: ${i.sourceLabel}.`,
    `Showing ${formatTimeRange(s.startSec, s.startSec + s.secondsPerPage)} of ${formatTimeRange(0, i.durationSec)}; montage ${i.montageLabel}; sensitivity ${s.sensitivityUvPerMm} µV/mm; ${s.secondsPerPage} s/page; LFF ${fmtFilter(s.lffHz)}, HFF ${fmtFilter(s.hffHz)}, notch ${fmtFilter(s.notchHz)}.`,
  ];
  if (i.caliper) {
    lines.push(
      `Caliper on ${i.caliper.channel}: Δt ${Math.round(i.caliper.dtMs)} ms (${i.caliper.freqHz.toFixed(1)} Hz), peak-to-peak ${Math.round(i.caliper.ppUv)} µV.`,
    );
  }
  if (i.task) {
    lines.push(`Task: ${i.task.prompt}`);
    lines.push(i.marks.length > 0 ? `Learner marks (${i.marks.length}): ${i.marks.slice(0, 20).map(fmtMark).join('; ')}.` : 'Learner has not marked anything yet.');
    if (i.checked && i.result) {
      lines.push(`Checked: ${i.result.hits} found, ${i.result.misses} missed, ${i.result.falseMarks} false marks.`);
    } else {
      lines.push('Not checked yet — do not reveal the answer key.');
    }
  }
  const text = lines.join('\n');
  return text.length > 2000 ? `${text.slice(0, 1997)}…` : text;
}
