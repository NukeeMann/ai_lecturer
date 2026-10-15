// Synthetic EEG for MECHANISM DEMONSTRATIONS ONLY (montage/polarity,
// artifacts, filters). Never present this as a real recording: every widget
// that renders it must show the SimulationBadge (`recording.synthetic`).
//
// Pure TypeScript, Node-safe, deterministic: the same spec (incl. `seed`)
// always yields the same samples (mulberry32 PRNG).
//
// ── Model ───────────────────────────────────────────────────────────────────
// Each component produces a scalp FIELD × TIME COURSE on electrode potentials
// against an ideal (infinitely distant) reference; the result is a
// `reference: 'common'` recording, so every montage — including ear and
// average reference with their contamination effects — can be derived.
//
// The field of a focal generator is approximated as
//     V(e) = amplitude × exp(−(angularDistance(e, centre) / spreadDeg)²)
// on the idealised spherical head of electrodes.ts. This is a DIDACTIC
// approximation of the surface negativity of a radial dipole (its distant
// opposite pole is ignored); it reproduces the reading rules being taught
// (maximum at the centre, phase reversal in bipolar chains, cancellation
// between equipotential electrodes) without pretending to be a head model.
//
// Clinical anchors (IFCN 2017, Kane et al.; ACNS 2016):
//   • spike: main component 20–<70 ms; sharp wave: 70–200 ms; both usually
//     surface-NEGATIVE, di-/triphasic, optionally with an after-going slow wave.
//   • blink: the cornea is positive; Bell's phenomenon rotates it towards
//     Fp1/Fp2 → frontal POSITIVITY, maximal at Fp1/Fp2, 200–400 ms.
//   • lateral eye movement: the cornea approaches the lateral canthus on the
//     side of gaze → F7 POSITIVE and F8 NEGATIVE for gaze to the left (and
//     vice versa); lateral rectus spikes at the side of gaze.
//   • ECG: largest at the left ear/mastoid → prominent with ear reference.

import { z } from 'zod';

import { applyBiquad, highpass, lowpass, SHARP_WAVE_DURATION_MS, SPIKE_DURATION_MS } from './dsp';
import {
  angularDistanceDeg,
  DEFAULT_RECORDING_ELECTRODES,
  electrodePosition,
  nearestElectrode,
  normalizeElectrode,
  sphericalToCartesian,
  type SphericalPoint,
  type Vec3,
} from './electrodes';
import type { DecodedRecording, EegAnnotation } from './recording';

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

/** mulberry32: tiny, fast, good-enough 32-bit PRNG → [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix a base seed with salts into an independent 32-bit seed. */
export function deriveSeed(seed: number, ...salts: number[]): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const s of salts) {
    h = Math.imul(h ^ (s + 0x7f4a7c15), 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
  }
  return h >>> 0;
}

function gaussianSource(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u <= 1e-12) u = rng();
    const v = rng();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

// ---------------------------------------------------------------------------
// Spec schema
// ---------------------------------------------------------------------------

/** Named scalp regions usable as a component centre. */
export const SIM_REGIONS: Readonly<Record<string, SphericalPoint>> = {
  vertex: { theta: 0, phi: 0 },
  frontopolar: { theta: 90, phi: 0 },
  frontal: { theta: 55, phi: 0 },
  central: { theta: 22, phi: 0 },
  parietal: { theta: 45, phi: 180 },
  posterior: { theta: 90, phi: 180 },
  occipital: { theta: 90, phi: 180 },
  leftFrontal: { theta: 70, phi: -40 },
  rightFrontal: { theta: 70, phi: 40 },
  leftCentral: { theta: 45, phi: -90 },
  rightCentral: { theta: 45, phi: 90 },
  leftTemporal: { theta: 95, phi: -90 },
  rightTemporal: { theta: 95, phi: 90 },
  leftOccipital: { theta: 90, phi: -162 },
  rightOccipital: { theta: 90, phi: 162 },
};

const SphericalPointSchema = z.object({
  /** Polar angle from the vertex (deg). Lowest 10-20 ring = 90°. */
  theta: z.number().min(0).max(180),
  /** Azimuth from the nose (deg), positive towards the RIGHT ear. */
  phi: z.number().min(-360).max(360),
});

/** Electrode name ("F8"), region keyword ("posterior") or {theta, phi}. */
export const SimLocationSchema = z.union([z.string().min(1), SphericalPointSchema]);
export type SimLocation = z.infer<typeof SimLocationSchema>;

/** Resolve a location to a unit vector, or null when unknown. */
export function resolveSimLocation(loc: SimLocation): Vec3 | null {
  if (typeof loc !== 'string') return sphericalToCartesian(loc);
  const e = normalizeElectrode(loc);
  if (e) {
    const p = electrodePosition(e);
    if (p) return p;
  }
  const key = Object.keys(SIM_REGIONS).find((k) => k.toLowerCase() === loc.trim().toLowerCase());
  return key ? sphericalToCartesian(SIM_REGIONS[key]) : null;
}

const TimesSchema = z.array(z.number().nonnegative()).min(1);
const LabelField = z.string().min(1).optional();

export const DischargeComponentSchema = z.object({
  kind: z.literal('discharge'),
  center: SimLocationSchema,
  /** Angular spread of the field (deg): V = peak at the centre, 37 % at spreadDeg. */
  spreadDeg: z.number().min(5).max(120).default(30),
  polarity: z.enum(['negative', 'positive']).default('negative'),
  /** Potential at the field centre at the peak (µV, magnitude). */
  peakUv: z.number().positive().max(3000).default(120),
  waveform: z.enum(['spike', 'sharp', 'spikeWave', 'slow']).default('spike'),
  /**
   * Duration of the main component (ms). Defaults: spike 50, sharp 120,
   * spikeWave 50 (+ slow wave), slow 400. Validated against IFCN ranges.
   */
  durationMs: z.number().positive().optional(),
  /** After-going slow wave duration for `spikeWave` (ms, default 250). */
  slowWaveMs: z.number().min(100).max(1000).optional(),
  /** Times of the PEAK of the main component (s). */
  times: TimesSchema,
  /** Annotation label (default "spike", "sharp wave", …). */
  label: LabelField,
});

export const RhythmComponentSchema = z.object({
  kind: z.literal('rhythm'),
  center: SimLocationSchema,
  spreadDeg: z.number().min(5).max(180).default(40),
  freqHz: z.number().positive().max(100),
  /** Amplitude (µV, sine peak) at the field centre. */
  amplitudeUv: z.number().positive().max(1000),
  onsetSec: z.number().nonnegative().optional(),
  offsetSec: z.number().positive().optional(),
  /** Waxing and waning amplitude modulation (e.g. posterior alpha). */
  waxing: z.boolean().default(false),
  /** Raised-cosine ramp at onset/offset (s). */
  rampSec: z.number().nonnegative().max(5).default(0.3),
  label: LabelField,
});

export const BlinkComponentSchema = z.object({
  kind: z.literal('blink'),
  /** Times of peak frontal positivity (s). */
  times: TimesSchema,
  /** Positivity at Fp1/Fp2 (µV). */
  amplitudeUv: z.number().positive().max(2000).default(150),
  durationMs: z.number().min(150).max(600).default(300),
  label: LabelField,
});

export const LateralEyeMovementComponentSchema = z.object({
  kind: z.literal('lateralEyeMovement'),
  direction: z.enum(['left', 'right']),
  /** Saccade onsets (s): eyes move to `direction`, stay `holdSec`, return. */
  times: TimesSchema,
  /** Potential at F7/F8 while the gaze is held (µV; + on the gaze side). */
  amplitudeUv: z.number().positive().max(1000).default(70),
  holdSec: z.number().positive().max(10).default(1),
  /** Brief lateral rectus spikes at saccade onset (F7 for left gaze). */
  lateralRectusSpikes: z.boolean().default(false),
  label: LabelField,
});

export const MuscleComponentSchema = z.object({
  kind: z.literal('muscle'),
  center: SimLocationSchema,
  spreadDeg: z.number().min(5).max(90).default(25),
  /** RMS of the 20–100 Hz activity at the centre (µV). */
  amplitudeUv: z.number().positive().max(500).default(30),
  bursts: z
    .array(z.object({ onsetSec: z.number().nonnegative(), durationSec: z.number().positive() }))
    .min(1),
  label: LabelField,
});

export const ElectrodePopComponentSchema = z.object({
  kind: z.literal('electrodePop'),
  electrode: z.string().min(1),
  times: TimesSchema,
  amplitudeUv: z.number().positive().max(2000).default(150),
  /** Exponential decay time constant (ms). */
  decayMs: z.number().positive().max(5000).default(250),
  polarity: z.enum(['negative', 'positive']).default('positive'),
  label: LabelField,
});

export const LineNoiseComponentSchema = z.object({
  kind: z.literal('lineNoise'),
  /** Electrodes with high impedance that pick up mains interference. */
  electrodes: z.array(z.string().min(1)).min(1),
  freqHz: z.union([z.literal(50), z.literal(60)]).default(50),
  amplitudeUv: z.number().positive().max(500).default(20),
  label: LabelField,
});

export const EcgComponentSchema = z.object({
  kind: z.literal('ecg'),
  heartRateBpm: z.number().min(30).max(240).default(90),
  /** R-wave amplitude at the field maximum (left ear / mastoid), µV. */
  amplitudeUv: z.number().positive().max(500).default(15),
  /** Field centre; default low left posterior (below/behind A1). */
  center: SimLocationSchema.default({ theta: 130, phi: -110 }),
  spreadDeg: z.number().min(10).max(120).default(55),
  /** Add a separate "ECG" polygraphic channel. */
  includeChannel: z.boolean().default(true),
  label: LabelField,
});

export const SweatComponentSchema = z.object({
  kind: z.literal('sweat'),
  electrodes: z.array(z.string().min(1)).min(1),
  amplitudeUv: z.number().positive().max(1000).default(60),
  /** Dominant drift frequency (< 0.5 Hz). */
  freqHz: z.number().positive().max(0.5).default(0.2),
  label: LabelField,
});

export const SimComponentSchema = z.discriminatedUnion('kind', [
  DischargeComponentSchema,
  RhythmComponentSchema,
  BlinkComponentSchema,
  LateralEyeMovementComponentSchema,
  MuscleComponentSchema,
  ElectrodePopComponentSchema,
  LineNoiseComponentSchema,
  EcgComponentSchema,
  SweatComponentSchema,
]);
export type SimComponent = z.infer<typeof SimComponentSchema>;
export type SimComponentInput = z.input<typeof SimComponentSchema>;

/** Default main-component durations (ms) per discharge waveform. */
export const DISCHARGE_DEFAULT_MS = { spike: 50, sharp: 120, spikeWave: 50, slow: 400 } as const;

/** Allowed main-component durations (ms): [min, max) for spikes, [min, max] otherwise. */
export const DISCHARGE_DURATION_RANGES_MS = {
  spike: [SPIKE_DURATION_MS.min, SPIKE_DURATION_MS.max],
  spikeWave: [SPIKE_DURATION_MS.min, SPIKE_DURATION_MS.max],
  sharp: [SHARP_WAVE_DURATION_MS.min, SHARP_WAVE_DURATION_MS.max],
  slow: [200, 2000],
} as const;

/** Event times of a component with their JSON paths (for range validation). */
function eventTimes(c: SimComponent): { t: number; path: (string | number)[] }[] {
  if ('times' in c) return c.times.map((t, j) => ({ t, path: ['times', j] }));
  if (c.kind === 'muscle') return c.bursts.map((b, j) => ({ t: b.onsetSec, path: ['bursts', j, 'onsetSec'] }));
  if (c.kind === 'rhythm' && c.onsetSec !== undefined) return [{ t: c.onsetSec, path: ['onsetSec'] }];
  return [];
}

export const SimulationSpecSchema = z
  .object({
    durationSec: z.number().positive().max(120),
    sampleRate: z.number().int().min(64).max(1024).default(256),
    seed: z.number().int().default(1),
    background: z
      .object({
        kind: z.enum(['pink', 'none']).default('pink'),
        /** Approximate RMS of the background at each electrode (µV). */
        amplitudeUv: z.number().nonnegative().max(500).default(10),
      })
      .default({}),
    components: z.array(SimComponentSchema).default([]),
    /** Electrodes to generate (default 10-20 + A1/A2). */
    electrodes: z.array(z.string().min(1)).optional(),
    /** Add an annotation per simulated event (default true). */
    annotate: z.boolean().default(true),
  })
  .superRefine((spec, ctx) => {
    if (spec.electrodes) {
      spec.electrodes.forEach((e, i) => {
        const n = normalizeElectrode(e);
        if (!n || !electrodePosition(n)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['electrodes', i], message: `Unknown scalp electrode "${e}"` });
        }
      });
    }
    spec.components.forEach((c, i) => {
      const at = (p: (string | number)[]) => ['components', i, ...p];
      if ('center' in c && c.center !== undefined && !resolveSimLocation(c.center)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: at(['center']),
          message: `Unknown location ${JSON.stringify(c.center)} (use an electrode, a region keyword or {theta, phi})`,
        });
      }
      const names = c.kind === 'electrodePop' ? [c.electrode] : 'electrodes' in c ? c.electrodes : [];
      names.forEach((e, j) => {
        const n = normalizeElectrode(e);
        if (!n || !electrodePosition(n)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: at(c.kind === 'electrodePop' ? ['electrode'] : ['electrodes', j]),
            message: `Unknown scalp electrode "${e}"`,
          });
        }
      });
      eventTimes(c).forEach(({ t, path }) => {
        if (t >= spec.durationSec) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: at(path),
            message: `Event time ${t} s is outside the ${spec.durationSec} s simulation`,
          });
        }
      });
      if (c.kind === 'discharge' && c.durationMs !== undefined) {
        const [lo, hi] = DISCHARGE_DURATION_RANGES_MS[c.waveform];
        const spikeLike = c.waveform === 'spike' || c.waveform === 'spikeWave';
        const ok = spikeLike ? c.durationMs >= lo && c.durationMs < hi : c.durationMs >= lo && c.durationMs <= hi;
        if (!ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: at(['durationMs']),
            message: spikeLike
              ? `A spike lasts ${lo}–<${hi} ms (IFCN); use waveform "sharp" for 70–200 ms`
              : `A ${c.waveform} wave must last ${lo}–${hi} ms`,
          });
        }
      }
      if (c.kind === 'rhythm' && c.offsetSec !== undefined && c.offsetSec <= (c.onsetSec ?? 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: at(['offsetSec']), message: 'offsetSec must be after onsetSec' });
      }
      if (c.kind === 'rhythm' && c.freqHz >= spec.sampleRate / 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: at(['freqHz']), message: 'freqHz must be below the Nyquist frequency' });
      }
    });
  });

/** Parsed spec (defaults applied). */
export type SimulationSpec = z.infer<typeof SimulationSpecSchema>;
/** Spec as authored in lesson JSON (defaults optional). */
export type SimulationSpecInput = z.input<typeof SimulationSpecSchema>;

// ---------------------------------------------------------------------------
// Waveform templates (time relative to the event, seconds → normalised value)
// ---------------------------------------------------------------------------

/** Raised-cosine bump on [start, start + width], peak 1 in the middle. */
function bump(t: number, start: number, width: number): number {
  if (t < start || t > start + width || width <= 0) return 0;
  return 0.5 * (1 - Math.cos((2 * Math.PI * (t - start)) / width));
}

/** Asymmetric main component: rises over `rise`, falls over `fall`, peak 1 at t = 0. */
function asymPeak(t: number, rise: number, fall: number): number {
  if (t < -rise || t > fall) return 0;
  return t <= 0 ? 0.5 * (1 + Math.cos((Math.PI * t) / rise)) : 0.5 * (1 + Math.cos((Math.PI * t) / fall));
}

/** Smooth 0→1 ramp over [start, start + width]. */
function ramp(t: number, start: number, width: number): number {
  if (t <= start) return 0;
  if (width <= 0 || t >= start + width) return 1;
  return 0.5 * (1 - Math.cos((Math.PI * (t - start)) / width));
}

/**
 * Spike / sharp-wave template of main duration D (s): a small opposite
 * pre-phase, the asymmetric main component (steeper rise) and an opposite,
 * slower after-phase — the di-/triphasic morphology of IFCN criterion 2.
 */
function transientTemplate(t: number, D: number): number {
  const rise = 0.42 * D;
  const fall = 0.58 * D;
  return (
    asymPeak(t, rise, fall) -
    0.12 * bump(t, -rise - 0.5 * D, 0.5 * D) -
    0.28 * bump(t, fall, 1.4 * D)
  );
}

type DischargeComponent = Extract<SimComponent, { kind: 'discharge' }>;

/** Support [from, to] (s, relative to the peak) of a discharge's main template. */
function dischargeSupport(c: DischargeComponent, D: number): [number, number] {
  if (c.waveform === 'slow') return [-D / 2, D / 2];
  return [-0.42 * D - 0.5 * D, 0.58 * D + 1.4 * D];
}

/** QRS-T template relative to the R peak (normalised R = 1). */
function ecgTemplate(t: number): number {
  return (
    -0.12 * bump(t, -0.035, 0.02) +
    1.0 * bump(t, -0.02, 0.04) -
    0.3 * bump(t, 0.015, 0.03) +
    0.28 * bump(t, 0.17, 0.16)
  );
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function gaussField(center: Vec3, spreadDeg: number, pos: Vec3): number {
  const d = angularDistanceDeg(center, pos);
  return Math.exp(-((d / spreadDeg) ** 2));
}

/** Gaussian field weights (0..1) of a centre over `electrodes`. */
export function fieldWeights(
  center: SimLocation,
  spreadDeg: number,
  electrodes: readonly string[],
): Record<string, number> {
  const c = resolveSimLocation(center);
  const out: Record<string, number> = {};
  for (const e of electrodes) {
    const p = electrodePosition(e);
    out[e] = c && p ? gaussField(c, spreadDeg, p) : 0;
  }
  return out;
}

const BLINK_CENTER: Vec3 = sphericalToCartesian({ theta: 115, phi: 0 }); // between/below the eyes
const BLINK_SPREAD = 45;
const EYE_LEFT: Vec3 = sphericalToCartesian({ theta: 105, phi: -50 }); // left lateral canthus
const EYE_RIGHT: Vec3 = sphericalToCartesian({ theta: 105, phi: 50 });
const EYE_SPREAD = 30;

function blinkWeights(electrodes: readonly string[]): Record<string, number> {
  const ref = gaussField(BLINK_CENTER, BLINK_SPREAD, electrodePosition('Fp1')!);
  const out: Record<string, number> = {};
  for (const e of electrodes) {
    const p = electrodePosition(e);
    out[e] = p ? gaussField(BLINK_CENTER, BLINK_SPREAD, p) / ref : 0;
  }
  return out;
}

/** Signed weights for gaze to `direction`: +1 at the gaze-side F7/F8, −1 opposite. */
function eyeMovementWeights(direction: 'left' | 'right', electrodes: readonly string[]): Record<string, number> {
  const pos = direction === 'left' ? EYE_LEFT : EYE_RIGHT;
  const neg = direction === 'left' ? EYE_RIGHT : EYE_LEFT;
  const sideEl = electrodePosition(direction === 'left' ? 'F7' : 'F8')!;
  const ref = gaussField(pos, EYE_SPREAD, sideEl) - gaussField(neg, EYE_SPREAD, sideEl);
  const out: Record<string, number> = {};
  for (const e of electrodes) {
    const p = electrodePosition(e);
    out[e] = p ? (gaussField(pos, EYE_SPREAD, p) - gaussField(neg, EYE_SPREAD, p)) / ref : 0;
  }
  return out;
}

function resolveCenterOrThrow(loc: SimLocation): Vec3 {
  const v = resolveSimLocation(loc);
  if (!v) throw new Error(`Unknown simulation location ${JSON.stringify(loc)}`);
  return v;
}

function centreWeights(center: SimLocation, spreadDeg: number, electrodes: readonly string[]): Record<string, number> {
  const c = resolveCenterOrThrow(center);
  const out: Record<string, number> = {};
  for (const e of electrodes) {
    const p = electrodePosition(e);
    out[e] = p ? gaussField(c, spreadDeg, p) : 0;
  }
  return out;
}

/**
 * Signed peak potential (µV) of a component at each electrode, without
 * background — e.g. to colour montageLab's head map at the discharge peak.
 * Rhythm/muscle/ECG give their amplitude envelope; point artifacts
 * (pop, line noise, sweat) give their amplitude on their electrodes.
 */
export function componentPeakField(
  input: SimComponentInput | SimComponent,
  electrodes: readonly string[] = DEFAULT_RECORDING_ELECTRODES,
): Record<string, number> {
  const c = SimComponentSchema.parse(input);
  const zero = (): Record<string, number> => Object.fromEntries(electrodes.map((e) => [e, 0]));
  const scale = (w: Record<string, number>, k: number) => {
    const out: Record<string, number> = {};
    for (const e of electrodes) out[e] = (w[e] ?? 0) * k;
    return out;
  };
  switch (c.kind) {
    case 'discharge':
      return scale(centreWeights(c.center, c.spreadDeg, electrodes), (c.polarity === 'negative' ? -1 : 1) * c.peakUv);
    case 'rhythm':
      return scale(centreWeights(c.center, c.spreadDeg, electrodes), c.amplitudeUv);
    case 'muscle':
      return scale(centreWeights(c.center, c.spreadDeg, electrodes), c.amplitudeUv);
    case 'blink':
      return scale(blinkWeights(electrodes), c.amplitudeUv);
    case 'lateralEyeMovement':
      return scale(eyeMovementWeights(c.direction, electrodes), c.amplitudeUv);
    case 'ecg': {
      // Normalised so the field equals amplitudeUv at A1 (left ear).
      const centre = resolveCenterOrThrow(c.center);
      const ref = gaussField(centre, c.spreadDeg, electrodePosition('A1')!) || 1;
      return scale(centreWeights(c.center, c.spreadDeg, electrodes), c.amplitudeUv / ref);
    }
    case 'electrodePop': {
      const out = zero();
      const e = normalizeElectrode(c.electrode);
      if (e && e in out) out[e] = (c.polarity === 'negative' ? -1 : 1) * c.amplitudeUv;
      return out;
    }
    case 'lineNoise':
    case 'sweat': {
      const out = zero();
      for (const raw of c.electrodes) {
        const e = normalizeElectrode(raw);
        if (e && e in out) out[e] = c.amplitudeUv;
      }
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/** Latent background generators spread over the head (spatially correlated noise). */
const BACKGROUND_SOURCES: readonly SphericalPoint[] = [
  { theta: 0, phi: 0 },
  { theta: 45, phi: 0 },
  { theta: 45, phi: 180 },
  { theta: 90, phi: 180 },
  { theta: 70, phi: -45 },
  { theta: 70, phi: 45 },
  { theta: 90, phi: -90 },
  { theta: 90, phi: 90 },
  { theta: 70, phi: -135 },
  { theta: 70, phi: 135 },
  { theta: 90, phi: 0 },
];
const BACKGROUND_SPREAD = 50;
const BACKGROUND_CORRELATED_SHARE = 0.75; // fraction of variance shared via latent sources

/** Unit-RMS, zero-mean pink (1/f) noise (Paul Kellet's filter), band-limited to ≈ 0.16–22 Hz. */
function pinkNoise(n: number, fs: number, gauss: () => number): Float64Array {
  const out = new Float64Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  // Warm-up so the filter state is stationary from the first sample.
  const warm = Math.min(4096, 4 * n);
  for (let i = -warm; i < n; i++) {
    const w = gauss();
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    if (i >= 0) out[i] = v;
  }
  // Band-limit to an EEG-like spectrum: gentle high-pass against drift and a
  // 2nd-order low-pass at 22 Hz (the white floor of the pink filter would
  // otherwise look like muscle activity at clinical sensitivities).
  const shaped = applyBiquad(out, [highpass(Math.min(0.16, fs / 8), fs), lowpass(Math.min(22, fs / 4), fs)]);
  return normalizeRms(Float64Array.from(shaped));
}

function normalizeRms(x: Float64Array): Float64Array {
  let mean = 0;
  for (let i = 0; i < x.length; i++) mean += x[i];
  mean /= x.length || 1;
  let ss = 0;
  for (let i = 0; i < x.length; i++) {
    x[i] -= mean;
    ss += x[i] * x[i];
  }
  const rms = Math.sqrt(ss / (x.length || 1));
  if (rms > 0) for (let i = 0; i < x.length; i++) x[i] /= rms;
  return x;
}

/** Add `amp × course(t − t0)` to `target` over the course's support. */
function addEvent(
  target: Float64Array,
  fs: number,
  t0: number,
  from: number,
  to: number,
  amp: number,
  course: (t: number) => number,
): void {
  if (amp === 0) return;
  const i0 = Math.max(0, Math.floor((t0 + from) * fs));
  const i1 = Math.min(target.length - 1, Math.ceil((t0 + to) * fs));
  for (let i = i0; i <= i1; i++) target[i] += amp * course(i / fs - t0);
}

function annotationChannels(weights: Record<string, number>, minShare = 0.5): string[] {
  const entries = Object.entries(weights).filter(([, w]) => Number.isFinite(w));
  const max = Math.max(0, ...entries.map(([, w]) => Math.abs(w)));
  if (max === 0) return [];
  return entries.filter(([, w]) => Math.abs(w) >= minShare * max).map(([e]) => e);
}

/**
 * Generate a deterministic synthetic recording (`reference: 'common'`,
 * `synthetic: true`) from a spec. Accepts raw lesson JSON (validated and
 * defaulted here); throws a ZodError on an invalid spec.
 */
export function generateRecording(input: SimulationSpecInput | SimulationSpec): DecodedRecording {
  const spec = SimulationSpecSchema.parse(input);
  const fs = spec.sampleRate;
  const n = Math.max(1, Math.round(spec.durationSec * fs));

  // Electrode set: requested (or default) + any electrode a component names.
  const electrodes: string[] = [];
  const addElectrode = (raw: string) => {
    const e = normalizeElectrode(raw);
    if (e && electrodePosition(e) && !electrodes.includes(e)) electrodes.push(e);
  };
  (spec.electrodes ?? DEFAULT_RECORDING_ELECTRODES).forEach(addElectrode);
  for (const c of spec.components) {
    if (c.kind === 'electrodePop') addElectrode(c.electrode);
    if (c.kind === 'lineNoise' || c.kind === 'sweat') c.electrodes.forEach(addElectrode);
  }

  const acc = new Map<string, Float64Array>(electrodes.map((e) => [e, new Float64Array(n)]));
  const extra = new Map<string, Float64Array>();
  const annotations: EegAnnotation[] = [];
  const annotate = (a: EegAnnotation) => {
    if (spec.annotate) annotations.push(a);
  };

  // ── Background ────────────────────────────────────────────────────────────
  if (spec.background.kind === 'pink' && spec.background.amplitudeUv > 0) {
    const g = gaussianSource(mulberry32(deriveSeed(spec.seed, 0xbac)));
    const latent = BACKGROUND_SOURCES.map(() => pinkNoise(n, fs, g));
    const centres = BACKGROUND_SOURCES.map((s) => sphericalToCartesian(s));
    for (const e of electrodes) {
      const p = electrodePosition(e)!;
      const w = centres.map((c) => gaussField(c, BACKGROUND_SPREAD, p));
      const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0)) || 1;
      const kc = Math.sqrt(BACKGROUND_CORRELATED_SHARE) / norm;
      const own = pinkNoise(n, fs, g);
      const ki = Math.sqrt(1 - BACKGROUND_CORRELATED_SHARE);
      const target = acc.get(e)!;
      const amp = spec.background.amplitudeUv;
      for (let i = 0; i < n; i++) {
        let v = ki * own[i];
        for (let k = 0; k < latent.length; k++) v += kc * w[k] * latent[k][i];
        target[i] += amp * v;
      }
    }
  }

  // ── Components ────────────────────────────────────────────────────────────
  spec.components.forEach((c, ci) => {
    const rng = mulberry32(deriveSeed(spec.seed, ci + 1, c.kind.length));
    const gauss = gaussianSource(rng);
    switch (c.kind) {
      case 'discharge': {
        const D = (c.durationMs ?? DISCHARGE_DEFAULT_MS[c.waveform]) / 1000;
        const W = (c.slowWaveMs ?? 250) / 1000;
        const sign = c.polarity === 'negative' ? -1 : 1;
        const w = centreWeights(c.center, c.spreadDeg, electrodes);
        const ww = c.waveform === 'spikeWave' ? centreWeights(c.center, c.spreadDeg * 1.3, electrodes) : null;
        const [from, to] = dischargeSupport(c, D);
        for (const t0 of c.times) {
          const amp = sign * c.peakUv * Math.min(1.15, Math.max(0.85, 1 + 0.06 * gauss()));
          for (const e of electrodes) {
            const target = acc.get(e)!;
            if (c.waveform === 'slow') {
              addEvent(target, fs, t0, from, to, amp * w[e], (t) => bump(t, -D / 2, D));
            } else {
              addEvent(target, fs, t0, from, to, amp * w[e], (t) => transientTemplate(t, D));
              if (ww) {
                const start = 0.58 * D + 0.5 * D;
                addEvent(target, fs, t0, start, start + W, 0.75 * amp * ww[e], (t) => bump(t, start, W));
              }
            }
          }
          const label =
            c.label ??
            { spike: 'spike', sharp: 'sharp wave', spikeWave: 'spike-and-wave', slow: 'slow wave' }[c.waveform];
          annotate({
            onsetSec: Math.max(0, t0 - 0.42 * D),
            durationSec: c.waveform === 'spikeWave' ? D + 0.5 * D + W : D,
            label,
            channels: annotationChannels(w),
            source: 'simulation',
          });
        }
        break;
      }
      case 'rhythm': {
        const w = centreWeights(c.center, c.spreadDeg, electrodes);
        const onset = c.onsetSec ?? 0;
        const offset = c.offsetSec ?? Infinity;
        const phase0 = rng() * 2 * Math.PI;
        const waxPeriod = 2 + rng();
        const waxPhase = rng() * Math.PI;
        // Slow frequency jitter (±2 %), smoothed random walk.
        const course = new Float64Array(n);
        let phase = phase0;
        let jitter = 0;
        for (let i = 0; i < n; i++) {
          const t = i / fs;
          jitter = 0.995 * jitter + 0.1 * gauss() * 0.02;
          const f = c.freqHz * (1 + Math.max(-0.04, Math.min(0.04, jitter)));
          phase += (2 * Math.PI * f) / fs;
          let env = ramp(t, onset, c.rampSec) * (1 - ramp(t, offset, c.rampSec));
          if (c.waxing) env *= 0.55 + 0.45 * Math.sin((Math.PI * t) / waxPeriod + waxPhase) ** 2;
          course[i] = env * Math.sin(phase);
        }
        for (const e of electrodes) {
          const k = c.amplitudeUv * w[e];
          if (k === 0) continue;
          const target = acc.get(e)!;
          for (let i = 0; i < n; i++) target[i] += k * course[i];
        }
        break;
      }
      case 'blink': {
        const D = c.durationMs / 1000;
        const w = blinkWeights(electrodes);
        for (const t0 of c.times) {
          const amp = c.amplitudeUv * Math.min(1.15, Math.max(0.85, 1 + 0.06 * gauss()));
          for (const e of electrodes) {
            addEvent(acc.get(e)!, fs, t0, -0.35 * D, 0.65 * D, amp * w[e], (t) => asymPeak(t, 0.35 * D, 0.65 * D));
          }
          annotate({ onsetSec: Math.max(0, t0 - 0.35 * D), durationSec: D, label: c.label ?? 'eye blink', channels: ['Fp1', 'Fp2'], source: 'simulation' });
        }
        break;
      }
      case 'lateralEyeMovement': {
        const w = eyeMovementWeights(c.direction, electrodes);
        const saccade = 0.04;
        const sideEl = c.direction === 'left' ? 'F7' : 'F8';
        const otherEl = c.direction === 'left' ? 'F8' : 'F7';
        for (const t0 of c.times) {
          const back = t0 + c.holdSec;
          for (const e of electrodes) {
            addEvent(acc.get(e)!, fs, t0, 0, back - t0 + saccade, c.amplitudeUv * w[e], (t) =>
              ramp(t, 0, saccade) * (1 - ramp(t, c.holdSec, saccade)),
            );
          }
          if (c.lateralRectusSpikes) {
            // Brief (~16 ms) muscle spikes at the abducting lateral rectus:
            // gaze side at the outward saccade, the other side on return.
            const spikeAt = (el: string, t: number) => {
              const pos = electrodePosition(el);
              if (!pos) return;
              for (const e of electrodes) {
                const p = electrodePosition(e)!;
                const k = 0.7 * c.amplitudeUv * gaussField(pos, 12, p);
                if (k > 1e-3) addEvent(acc.get(e)!, fs, t, -0.02, 0.04, -k, (tt) => transientTemplate(tt, 0.016));
              }
            };
            spikeAt(sideEl, t0 + 0.006);
            spikeAt(otherEl, back + 0.006);
          }
          annotate({
            onsetSec: t0,
            durationSec: c.holdSec + saccade,
            label: c.label ?? `lateral eye movement (${c.direction})`,
            channels: ['F7', 'F8'],
            source: 'simulation',
          });
        }
        break;
      }
      case 'muscle': {
        const w = centreWeights(c.center, c.spreadDeg, electrodes);
        const edge = 0.06;
        const env = new Float64Array(n);
        for (const b of c.bursts) {
          for (let i = 0; i < n; i++) {
            const t = i / fs;
            env[i] = Math.max(env[i], ramp(t, b.onsetSec, edge) * (1 - ramp(t, b.onsetSec + b.durationSec - edge, edge)));
          }
          annotate({
            onsetSec: b.onsetSec,
            durationSec: b.durationSec,
            label: c.label ?? 'muscle artifact',
            channels: annotationChannels(w),
            source: 'simulation',
          });
        }
        const lpHz = Math.min(100, fs * 0.42);
        const bands = [highpass(20, fs), lowpass(lpHz, fs)];
        for (const e of electrodes) {
          if (w[e] < 0.02) continue;
          const white = new Float64Array(n);
          for (let i = 0; i < n; i++) white[i] = gauss();
          const emg = normalizeRms(Float64Array.from(applyBiquad(white, bands)));
          const target = acc.get(e)!;
          const k = c.amplitudeUv * w[e];
          for (let i = 0; i < n; i++) target[i] += k * env[i] * emg[i];
        }
        break;
      }
      case 'electrodePop': {
        const e = normalizeElectrode(c.electrode)!;
        const tau = c.decayMs / 1000;
        const sign = c.polarity === 'negative' ? -1 : 1;
        for (const t0 of c.times) {
          addEvent(acc.get(e)!, fs, t0, 0, 6 * tau, sign * c.amplitudeUv, (t) => (t < 0 ? 0 : Math.exp(-t / tau)));
          annotate({ onsetSec: t0, durationSec: Math.min(1, 3 * tau), label: c.label ?? 'electrode pop', channels: [e], source: 'simulation' });
        }
        break;
      }
      case 'lineNoise': {
        for (const raw of c.electrodes) {
          const e = normalizeElectrode(raw)!;
          const ph = rng() * 2 * Math.PI;
          const target = acc.get(e)!;
          const k = (2 * Math.PI * c.freqHz) / fs;
          for (let i = 0; i < n; i++) target[i] += c.amplitudeUv * Math.sin(k * i + ph);
        }
        break;
      }
      case 'ecg': {
        const centre = resolveCenterOrThrow(c.center);
        const a1 = electrodePosition('A1')!;
        const norm = gaussField(centre, c.spreadDeg, a1) || 1;
        const rr = 60 / c.heartRateBpm;
        const beats: number[] = [];
        for (let t = rng() * rr; t < spec.durationSec + 0.3; t += rr * (1 + 0.03 * gauss())) beats.push(t);
        for (const e of electrodes) {
          const k = (c.amplitudeUv * gaussField(centre, c.spreadDeg, electrodePosition(e)!)) / norm;
          if (Math.abs(k) < 1e-3) continue;
          for (const tb of beats) addEvent(acc.get(e)!, fs, tb, -0.05, 0.35, k, ecgTemplate);
        }
        if (c.includeChannel) {
          const ch = new Float64Array(n);
          for (const tb of beats) addEvent(ch, fs, tb, -0.05, 0.35, 800, ecgTemplate);
          extra.set('ECG', ch);
        }
        break;
      }
      case 'sweat': {
        for (const raw of c.electrodes) {
          const e = normalizeElectrode(raw)!;
          const target = acc.get(e)!;
          const f1 = c.freqHz * (0.8 + 0.4 * rng());
          const f2 = f1 * 0.55;
          const p1 = rng() * 2 * Math.PI;
          const p2 = rng() * 2 * Math.PI;
          for (let i = 0; i < n; i++) {
            const t = i / fs;
            target[i] += c.amplitudeUv * (0.65 * Math.sin(2 * Math.PI * f1 * t + p1) + 0.35 * Math.sin(2 * Math.PI * f2 * t + p2));
          }
        }
        break;
      }
    }
  });

  annotations.sort((a, b) => a.onsetSec - b.onsetSec);
  return {
    sampleRate: fs,
    nSamples: n,
    durationSec: n / fs,
    reference: 'common',
    signals: [
      ...electrodes.map((e) => ({ label: e, data: Float32Array.from(acc.get(e)!) })),
      ...[...extra].map(([label, d]) => ({ label, data: Float32Array.from(d) })),
    ],
    annotations,
    source: {
      dataset: 'Simulation',
      citation: 'Synthetic EEG (didactic field model) — not a real recording',
    },
    synthetic: true,
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const SIM_PRESET_IDS = [
  'phaseReversalF8',
  'endOfChainFp1',
  'blink',
  'lateralEyeMovementLeft',
  'wideFieldInPhaseCancellation',
  'earReferenceContaminationT7',
  'averageReferenceContaminationBlink',
  'alphaReactivity',
  'electrodePopP7',
  'lineNoise50T8',
  'muscleTemporal',
] as const;
export type SimPresetId = (typeof SIM_PRESET_IDS)[number];

/** Built-in mechanism demos (validated in synth.test.ts). */
export const SIM_PRESETS: Readonly<Record<SimPresetId, SimulationSpecInput>> = {
  // Negative spike maximal at F8: in LB, Fp2-F8 deflects down and F8-T8 up
  // (negative phase reversal at F8); in TB, F4-F8 / F8-… likewise.
  phaseReversalF8: {
    durationSec: 10,
    seed: 801,
    background: { kind: 'pink', amplitudeUv: 10 },
    components: [
      { kind: 'discharge', center: 'F8', spreadDeg: 28, polarity: 'negative', peakUv: 150, waveform: 'spike', times: [1.6, 4.3, 7.4] },
    ],
  },
  // Negative sharp wave maximal at Fp1, the START of the LB chains: no phase
  // reversal; the largest deflection is in Fp1-F7 / Fp1-F3 (upwards).
  endOfChainFp1: {
    durationSec: 10,
    seed: 102,
    background: { kind: 'pink', amplitudeUv: 10 },
    components: [
      { kind: 'discharge', center: 'Fp1', spreadDeg: 25, polarity: 'negative', peakUv: 150, waveform: 'sharp', times: [2.1, 5.6, 8.2] },
    ],
  },
  // Frontal positivity maximal at Fp1/Fp2 (downward in Fp1-F7/Fp1-F3).
  blink: {
    durationSec: 10,
    seed: 3,
    background: { kind: 'pink', amplitudeUv: 10 },
    components: [{ kind: 'blink', times: [1.4, 3.9, 6.2, 8.7], amplitudeUv: 150 }],
  },
  // Gaze to the left: F7 positive, F8 negative (box-shaped), with lateral
  // rectus spikes at F7 on the outward saccade.
  lateralEyeMovementLeft: {
    durationSec: 10,
    seed: 4,
    background: { kind: 'pink', amplitudeUv: 10 },
    components: [
      { kind: 'lateralEyeMovement', direction: 'left', times: [2.0, 6.0], holdSec: 1.5, amplitudeUv: 100, lateralRectusSpikes: true },
    ],
  },
  // Field centred halfway between F8 and T8: both equally negative, so F8-T8
  // is isoelectric between opposite deflections in Fp2-F8 and T8-P8
  // (in-phase cancellation) while referential montages show F8 and T8.
  wideFieldInPhaseCancellation: {
    durationSec: 10,
    seed: 5,
    background: { kind: 'pink', amplitudeUv: 8 },
    components: [
      { kind: 'discharge', center: { theta: 90, phi: 72 }, spreadDeg: 45, polarity: 'negative', peakUv: 140, waveform: 'sharp', times: [2.0, 5.5, 8.0] },
    ],
  },
  // Left inferior temporal negativity whose field reaches A1: with the
  // ipsilateral ear reference, distant left channels (Fp1-A1, O1-A1) show
  // a false opposite (downward) deflection; LB and the right side stay clean.
  earReferenceContaminationT7: {
    durationSec: 10,
    seed: 6,
    background: { kind: 'pink', amplitudeUv: 8 },
    components: [
      { kind: 'discharge', center: { theta: 98, phi: -90 }, spreadDeg: 35, polarity: 'negative', peakUv: 150, waveform: 'sharp', times: [1.8, 4.6, 7.7] },
    ],
  },
  // Large blinks inflate the common average: in AVG every posterior channel
  // shows a false upward (negative-looking) deflection at each blink.
  averageReferenceContaminationBlink: {
    durationSec: 10,
    seed: 7,
    background: { kind: 'pink', amplitudeUv: 8 },
    components: [{ kind: 'blink', times: [1.5, 4.2, 7.0], amplitudeUv: 300, durationMs: 350 }],
  },
  // Posterior 10 Hz alpha with eyes closed, blocked by eye opening at 4 s,
  // returning after eye closure at 8 s (blink-like frontal positivities).
  alphaReactivity: {
    durationSec: 12,
    seed: 8,
    background: { kind: 'pink', amplitudeUv: 8 },
    components: [
      { kind: 'rhythm', center: 'posterior', spreadDeg: 40, freqHz: 10, amplitudeUv: 45, onsetSec: 0, offsetSec: 4.1, waxing: true, rampSec: 0.2, label: 'alpha (eyes closed)' },
      { kind: 'rhythm', center: 'posterior', spreadDeg: 40, freqHz: 10, amplitudeUv: 45, onsetSec: 8.3, waxing: true, rampSec: 0.4, label: 'alpha (eyes closed)' },
      { kind: 'blink', times: [4.0], amplitudeUv: 120, label: 'eyes open' },
      { kind: 'blink', times: [8.0], amplitudeUv: 160, durationMs: 400, label: 'eyes closed' },
    ],
  },
  // Abrupt step at P7 only, exponential decay, no field: narrow phase
  // reversal T7-P7 / P7-O1 and nothing in neighbouring chains.
  electrodePopP7: {
    durationSec: 10,
    seed: 9,
    background: { kind: 'pink', amplitudeUv: 10 },
    components: [{ kind: 'electrodePop', electrode: 'P7', times: [2.3, 6.8], amplitudeUv: 200, decayMs: 250 }],
  },
  // 50 Hz on a high-impedance T8: visible in F8-T8 and T8-P8; the notch removes it.
  lineNoise50T8: {
    durationSec: 10,
    seed: 10,
    background: { kind: 'pink', amplitudeUv: 10 },
    components: [{ kind: 'lineNoise', electrodes: ['T8'], freqHz: 50, amplitudeUv: 25 }],
  },
  // Bilateral temporalis EMG bursts (jaw clenching); a low HFF makes them
  // look deceptively like fast activity or spikes.
  muscleTemporal: {
    durationSec: 10,
    seed: 11,
    background: { kind: 'pink', amplitudeUv: 10 },
    components: [
      { kind: 'muscle', center: 'T7', spreadDeg: 25, amplitudeUv: 35, bursts: [{ onsetSec: 2, durationSec: 1.5 }, { onsetSec: 6, durationSec: 2 }] },
      { kind: 'muscle', center: 'T8', spreadDeg: 25, amplitudeUv: 35, bursts: [{ onsetSec: 2, durationSec: 1.5 }, { onsetSec: 6, durationSec: 2 }] },
    ],
  },
};

/** English UI metadata for the presets (titles for pickers, suggested montages). */
export const SIM_PRESET_INFO: Readonly<Record<SimPresetId, { title: string; suggestedMontages: string[] }>> = {
  phaseReversalF8: { title: 'Phase reversal at F8', suggestedMontages: ['LB', 'TB', 'AVG'] },
  endOfChainFp1: { title: 'End-of-chain maximum at Fp1', suggestedMontages: ['LB', 'AVG', 'CZ'] },
  blink: { title: 'Eye blinks', suggestedMontages: ['LB', 'AVG'] },
  lateralEyeMovementLeft: { title: 'Lateral eye movement (left)', suggestedMontages: ['LB', 'TB', 'AVG'] },
  wideFieldInPhaseCancellation: { title: 'In-phase cancellation (F8–T8)', suggestedMontages: ['LB', 'AVG', 'CZ'] },
  earReferenceContaminationT7: { title: 'Ear-reference contamination', suggestedMontages: ['EAR', 'LB', 'AVG'] },
  averageReferenceContaminationBlink: { title: 'Average-reference contamination by blinks', suggestedMontages: ['AVG', 'LB'] },
  alphaReactivity: { title: 'Alpha reactivity (eyes open/closed)', suggestedMontages: ['LB', 'AVG'] },
  electrodePopP7: { title: 'Electrode pop at P7', suggestedMontages: ['LB', 'AVG'] },
  lineNoise50T8: { title: '50 Hz interference at T8', suggestedMontages: ['LB', 'AVG'] },
  muscleTemporal: { title: 'Temporalis muscle artifact', suggestedMontages: ['LB', 'AVG'] },
};

export function isSimPresetId(id: string): id is SimPresetId {
  return (SIM_PRESET_IDS as readonly string[]).includes(id);
}

/** Parsed preset spec, or null for an unknown id. */
export function getSimPreset(id: string): SimulationSpec | null {
  return isSimPresetId(id) ? SimulationSpecSchema.parse(SIM_PRESETS[id]) : null;
}

/**
 * Resolve a widget's simulation source (`{ preset }` or `{ spec }`; a spec
 * wins when both are given) to a parsed spec. Throws on unknown preset /
 * invalid spec.
 */
export function resolveSimulation(source: { preset?: string; spec?: unknown }): SimulationSpec {
  if (source.spec !== undefined) return SimulationSpecSchema.parse(source.spec);
  if (source.preset) {
    const p = getSimPreset(source.preset);
    if (!p) throw new Error(`Unknown simulation preset "${source.preset}" (known: ${SIM_PRESET_IDS.join(', ')})`);
    return p;
  }
  throw new Error('Simulation source needs a preset or a spec');
}

/** Convenience: preset id or spec → synthetic recording. */
export function simulate(presetOrSpec: string | SimulationSpecInput): DecodedRecording {
  const spec = typeof presetOrSpec === 'string' ? resolveSimulation({ preset: presetOrSpec }) : presetOrSpec;
  return generateRecording(spec);
}

/** Electrode nearest to a simulation location (e.g. to label a dragged source). */
export function nearestElectrodeTo(loc: SimLocation, candidates?: readonly string[]): string | null {
  const v = resolveSimLocation(loc);
  return v ? nearestElectrode(v, candidates) : null;
}
