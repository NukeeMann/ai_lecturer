// Electrode names, label normalisation and head geometry for the EEG widgets.
//
// Pure TypeScript, Node-safe (no DOM, no React): imported by widget schemas,
// the EDF converter, the print page and the browser renderers alike.
//
// Naming follows the modern 10-10 / ACNS 2016 nomenclature (T7/T8/P7/P8);
// the old 10-20 names T3/T4/T5/T6 are accepted as aliases on input only.

/** The 19 scalp electrodes of the international 10-20 system (modern names). */
export const ELECTRODES_10_20 = [
  'Fp1',
  'Fp2',
  'F7',
  'F3',
  'Fz',
  'F4',
  'F8',
  'T7',
  'C3',
  'Cz',
  'C4',
  'T8',
  'P7',
  'P3',
  'Pz',
  'P4',
  'P8',
  'O1',
  'O2',
] as const;

/** Inferior temporal row added by the IFCN 25-electrode array (Seeck et al. 2017). */
export const IFCN_25_ADDITIONS = ['F9', 'T9', 'P9', 'F10', 'T10', 'P10'] as const;

/** Ear / mastoid electrodes (used as references, never part of the scalp average). */
export const EAR_ELECTRODES = ['A1', 'A2'] as const;

/** Other scalp positions that appear in clinical recordings. */
export const EXTRA_SCALP_ELECTRODES = ['Fpz', 'Oz', 'T1', 'T2'] as const;

/** Non-scalp polygraphic channels (no head position). */
export const NON_SCALP_CHANNELS = ['ECG', 'EOG', 'LOC', 'ROC', 'EMG'] as const;

export type Electrode10_20 = (typeof ELECTRODES_10_20)[number];

/** Default electrode set of a synthetic recording: 10-20 + both ears. */
export const DEFAULT_RECORDING_ELECTRODES: readonly string[] = [
  ...ELECTRODES_10_20,
  ...EAR_ELECTRODES,
];

export type ElectrodeKind = 'scalp' | 'ear' | 'nonScalp';

const SCALP_SET = new Set<string>([
  ...ELECTRODES_10_20,
  ...IFCN_25_ADDITIONS,
  ...EXTRA_SCALP_ELECTRODES,
]);
const EAR_SET = new Set<string>(EAR_ELECTRODES);
const NON_SCALP_SET = new Set<string>(NON_SCALP_CHANNELS);

/** Every canonical name `normalizeElectrode` can return. */
export const CANONICAL_ELECTRODES: readonly string[] = [
  ...ELECTRODES_10_20,
  ...IFCN_25_ADDITIONS,
  ...EAR_ELECTRODES,
  ...EXTRA_SCALP_ELECTRODES,
  ...NON_SCALP_CHANNELS,
];

/** Old 10-20 names (and mastoid synonyms) → canonical names. */
export const ELECTRODE_ALIASES: Readonly<Record<string, string>> = {
  T3: 'T7',
  T4: 'T8',
  T5: 'P7',
  T6: 'P8',
  M1: 'A1',
  M2: 'A2',
  EKG: 'ECG',
};

// Lower-case lookup table covering canonical names and aliases.
const LOOKUP = new Map<string, string>();
for (const name of CANONICAL_ELECTRODES) LOOKUP.set(name.toLowerCase(), name);
for (const [alias, name] of Object.entries(ELECTRODE_ALIASES)) {
  LOOKUP.set(alias.toLowerCase(), name);
}

// Vendor prefixes seen in EDF exports ("EEG Fp1-REF", "POL T3", "EKG1").
const PREFIX_RE = /^(?:eeg|pol)[\s_:]+/i;
// Reference suffixes that only describe the recording reference.
const REF_SUFFIX_RE = /[\s_-]+(?:ref|le|avg|ave|av|car)$/i;

/** Lower-level clean-up shared by electrode and derivation parsing. */
function cleanLabel(label: string): string {
  return label.trim().replace(PREFIX_RE, '').trim();
}

function lookupElectrode(token: string): string | null {
  const t = token.trim();
  if (!t) return null;
  const hit = LOOKUP.get(t.toLowerCase());
  if (hit) return hit;
  // "ECG1", "EKG 2", "EOG-L" style polygraphy labels.
  const poly = /^(ecg|ekg|eog|emg)[\s_-]*\w{0,3}$/i.exec(t);
  if (poly) return LOOKUP.get(poly[1].toLowerCase()) ?? null;
  return null;
}

/**
 * Normalise a channel label to a canonical electrode name, or `null` when it
 * is not a known single electrode.
 *
 * Handles case ("FP1" → "Fp1"), whitespace, the vendor prefixes "EEG "/"POL ",
 * reference suffixes ("-REF", "-Ref", "-LE", "-AVG") and the old 10-20 names
 * (T3→T7, T4→T8, T5→P7, T6→P8). A bipolar label such as "Fp1-F7" returns
 * `null` — use {@link parseChannelLabel} for those.
 */
export function normalizeElectrode(label: string): string | null {
  if (typeof label !== 'string') return null;
  const cleaned = cleanLabel(label).replace(REF_SUFFIX_RE, '');
  return lookupElectrode(cleaned);
}

export type ParsedChannelLabel =
  | { kind: 'electrode'; electrode: string; label: string }
  | { kind: 'derivation'; plus: string; minus: string; label: string };

/**
 * Parse a recording channel label into either a single electrode (common
 * reference) or a derivation `plus-minus` (fixed bipolar channel). Returns
 * `null` for unknown labels. `label` in the result is the canonical form
 * (e.g. "EEG FP1-F7" → `{kind:'derivation', plus:'Fp1', minus:'F7', label:'Fp1-F7'}`).
 */
export function parseChannelLabel(label: string): ParsedChannelLabel | null {
  if (typeof label !== 'string') return null;
  const single = normalizeElectrode(label);
  if (single) return { kind: 'electrode', electrode: single, label: single };
  const cleaned = cleanLabel(label);
  const parts = cleaned.split(/\s*-\s*/);
  if (parts.length !== 2) return null;
  const plus = lookupElectrode(parts[0]);
  const minus = lookupElectrode(parts[1]);
  if (!plus || !minus || plus === minus) return null;
  return { kind: 'derivation', plus, minus, label: `${plus}-${minus}` };
}

export function electrodeKind(name: string): ElectrodeKind | null {
  if (SCALP_SET.has(name)) return 'scalp';
  if (EAR_SET.has(name)) return 'ear';
  if (NON_SCALP_SET.has(name)) return 'nonScalp';
  return null;
}

/** True for electrodes that belong in the common average (scalp only). */
export function isScalpElectrode(name: string): boolean {
  return SCALP_SET.has(name);
}

/** Hemisphere of an electrode: odd numbers left, even right, "z" midline. */
export function electrodeSide(name: string): 'left' | 'right' | 'midline' | null {
  if (!SCALP_SET.has(name) && !EAR_SET.has(name)) return null;
  if (/z$/.test(name)) return 'midline';
  const m = /(\d+)$/.exec(name);
  if (!m) return null;
  return Number(m[1]) % 2 === 1 ? 'left' : 'right';
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
//
// Idealised spherical head (unit sphere). Head frame:
//   x → towards the RIGHT ear, y → towards the nose (anterior), z → vertex.
// Spherical angles used throughout the EEG library:
//   theta = polar angle from the vertex (Cz = 0°), in degrees;
//   phi   = azimuth measured from the nose direction, POSITIVE towards the
//           right ear (right hemisphere φ > 0, left hemisphere φ < 0).
//
// Following the BESA/EEGLAB idealisation, the lowest 10-20 ring
// (Fpz–Fp1–F7–T7–P7–O1–Oz and its mirror) lies on the equator (θ = 90°), so
// 10 % of the nasion–inion arc corresponds to 22.5°. The IFCN inferior row
// (F9/T9/P9…) and the nasion level sit at θ = 112.5°. Inner electrodes are
// great-circle midpoints, exactly as the 10-20 rules place them (F3 halfway
// between F7 and Fz, C3 halfway between T7 and Cz, …).

export interface SphericalPoint {
  /** Polar angle from the vertex, degrees (0 = Cz, 90 = lowest 10-20 ring). */
  theta: number;
  /** Azimuth from the nose, degrees, positive towards the right ear. */
  phi: number;
}

export type Vec3 = readonly [number, number, number];

const DEG = Math.PI / 180;

export function sphericalToCartesian({ theta, phi }: SphericalPoint): Vec3 {
  const t = theta * DEG;
  const p = phi * DEG;
  return [Math.sin(t) * Math.sin(p), Math.sin(t) * Math.cos(p), Math.cos(t)];
}

export function cartesianToSpherical(v: Vec3): SphericalPoint {
  const [x, y, z] = normalize(v);
  const theta = Math.acos(Math.max(-1, Math.min(1, z))) / DEG;
  const phi = theta < 1e-9 ? 0 : Math.atan2(x, y) / DEG;
  return { theta, phi };
}

function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (n === 0) return [0, 0, 1];
  return [v[0] / n, v[1] / n, v[2] / n];
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return normalize([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
}

/** Angle between two points on the sphere, degrees (0..180). */
export function angularDistanceDeg(a: Vec3, b: Vec3): number {
  const an = normalize(a);
  const bn = normalize(b);
  const dot = an[0] * bn[0] + an[1] * bn[1] + an[2] * bn[2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) / DEG;
}

function buildPositions(): Map<string, Vec3> {
  const s = (theta: number, phi: number): Vec3 => sphericalToCartesian({ theta, phi });
  const p = new Map<string, Vec3>();
  // Equator ring (θ = 90°), 10 % of the circumference = 36° of azimuth.
  p.set('Fpz', s(90, 0));
  p.set('Fp1', s(90, -18));
  p.set('Fp2', s(90, 18));
  p.set('F7', s(90, -54));
  p.set('F8', s(90, 54));
  p.set('T7', s(90, -90));
  p.set('T8', s(90, 90));
  p.set('P7', s(90, -126));
  p.set('P8', s(90, 126));
  p.set('O1', s(90, -162));
  p.set('O2', s(90, 162));
  p.set('Oz', s(90, 180));
  // Midline and central coronal line: 20 % steps of 45°.
  p.set('Cz', s(0, 0));
  p.set('Fz', s(45, 0));
  p.set('Pz', s(45, 180));
  p.set('C3', s(45, -90));
  p.set('C4', s(45, 90));
  // Parasagittal F/P electrodes: midpoints of the F7–Fz / P7–Pz arcs.
  p.set('F3', midpoint(p.get('F7')!, p.get('Fz')!));
  p.set('F4', midpoint(p.get('F8')!, p.get('Fz')!));
  p.set('P3', midpoint(p.get('P7')!, p.get('Pz')!));
  p.set('P4', midpoint(p.get('P8')!, p.get('Pz')!));
  // IFCN inferior temporal row, 10 % (22.5°) below the equator ring.
  p.set('F9', s(112.5, -54));
  p.set('F10', s(112.5, 54));
  p.set('T9', s(112.5, -90));
  p.set('T10', s(112.5, 90));
  p.set('P9', s(112.5, -126));
  p.set('P10', s(112.5, 126));
  // Anterior temporal (sub-temporal) electrodes between F9/T9 and F10/T10.
  p.set('T1', s(108, -72));
  p.set('T2', s(108, 72));
  // Ear lobes / mastoids: below and slightly behind the preauricular points.
  p.set('A1', s(125, -100));
  p.set('A2', s(125, 100));
  return p;
}

const POSITIONS = buildPositions();

/** Unit-sphere position of a canonical electrode, or null (non-scalp/unknown). */
export function electrodePosition(name: string): Vec3 | null {
  return POSITIONS.get(name) ?? null;
}

/** Spherical angles (θ, φ) of a canonical electrode, or null. */
export function electrodeSpherical(name: string): SphericalPoint | null {
  const v = POSITIONS.get(name);
  return v ? cartesianToSpherical(v) : null;
}

/** All electrodes that have a head position (scalp + ears). */
export const POSITIONED_ELECTRODES: readonly string[] = [...POSITIONS.keys()];

/** Resolve an electrode name or spherical point to a unit vector. */
export function resolvePoint(point: string | SphericalPoint): Vec3 | null {
  if (typeof point === 'string') {
    const name = normalizeElectrode(point) ?? point;
    return electrodePosition(name);
  }
  if (!Number.isFinite(point.theta) || !Number.isFinite(point.phi)) return null;
  return sphericalToCartesian(point);
}

/** Electrode (from `candidates`, default all positioned) closest to a point. */
export function nearestElectrode(
  point: Vec3 | SphericalPoint,
  candidates: readonly string[] = POSITIONED_ELECTRODES,
): string | null {
  const v = Array.isArray(point) ? (point as Vec3) : sphericalToCartesian(point as SphericalPoint);
  let best: string | null = null;
  let bestD = Infinity;
  for (const name of candidates) {
    const pos = POSITIONS.get(name);
    if (!pos) continue;
    const d = angularDistanceDeg(v, pos);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 2-D projection for the SVG head (top view)
// ---------------------------------------------------------------------------
//
// Azimuthal-equidistant projection centred on the vertex: the distance from
// the centre is proportional to θ, normalised so the equator ring
// (Fpz–T7–Oz–T8, θ = 90°) has radius 1. Inferior electrodes (F9/T9/A1…) fall
// slightly outside the unit circle, as on standard topographic plots.
//
// Drawing convention: the head is seen FROM ABOVE with the nose at the top.
// The patient's LEFT hemisphere is drawn on the LEFT of the picture and the
// right hemisphere on the right (label the head "L"/"R"). Output is in SVG
// screen orientation: x > 0 = right hemisphere, y < 0 = anterior (nose up).

export interface Point2D {
  x: number;
  y: number;
}

export function projectSpherical({ theta, phi }: SphericalPoint): Point2D {
  const r = theta / 90;
  return { x: r * Math.sin(phi * DEG), y: -r * Math.cos(phi * DEG) };
}

/** Inverse of {@link projectSpherical}; clamps θ to `maxTheta` (default 130°). */
export function unprojectToSpherical(p: Point2D, maxTheta = 130): SphericalPoint {
  const r = Math.hypot(p.x, p.y);
  const theta = Math.min(maxTheta, r * 90);
  const phi = r < 1e-9 ? 0 : Math.atan2(p.x, -p.y) / DEG;
  return { theta, phi };
}

/** 2-D head-map position of a canonical electrode, or null. */
export function projectElectrode(name: string): Point2D | null {
  const s = electrodeSpherical(name);
  return s ? projectSpherical(s) : null;
}
