// Display DSP for the EEG widgets: RBJ biquads, zero-phase filtering,
// min/max decimation, physical scaling and caliper measurements.
//
// Pure TypeScript, Node-safe.
//
// ── Polarity convention ─────────────────────────────────────────────────────
// Clinical EEG is drawn NEGATIVE UP: when input 1 (G1, "plus") is more
// negative than input 2 (G2, "minus") the trace deflects UPWARDS. A channel
// value is V(G1) − V(G2) in µV; on screen (y grows downwards) a positive
// value therefore moves the pen DOWN. Every renderer must go through
// `uvToDy` so the convention lives in one place.
//
// ── Display filtering ───────────────────────────────────────────────────────
// Display filters are applied ZERO-PHASE (forward–backward, "filtfilt") by
// default: spikes and sharp waves keep their latency and their onset/peak
// alignment across channels, which matters when the learner measures
// durations or compares timing between channels. Edge transients are limited
// by odd reflection padding plus steady-state initial conditions. Because a
// forward–backward pass squares the magnitude response, display filters are
// designed with a corrected cutoff so the combined response is −3 dB at the
// NOMINAL cutoff the learner selected (as on a clinical reader).
//
// Filter orders follow clinical practice:
//   • LFF = FIRST-order high-pass (the classic "time constant" filter,
//     TC = 1/2πf, 6 dB/octave), so the attenuation of slow waves matches what
//     a clinician expects (e.g. LFF 1 Hz leaves ≈ 40 % of a 0.5 Hz wave);
//   • HFF = 2nd-order Butterworth low-pass; notch = RBJ notch (Q 30).
// Trade-off of zero-phase: a step-like slow event (lateral eye movement)
// gets a symmetric drift BEFORE and after the step instead of the purely
// exponential decay of a causal amplifier filter. `phase: 'causal'` shows
// the clinical-amplifier look (single forward pass, uncorrected cutoffs).

/** Negative-up display convention (G1 more negative than G2 → upward deflection). */
export const POLARITY_NEGATIVE_UP = true;

/**
 * CSS pixels per nominal millimetre (96 dpi / 25.4). Physical scale on a
 * screen is nominal only — show a scale bar, never claim true mm.
 */
export const PX_PER_MM = 96 / 25.4;

// ---------------------------------------------------------------------------
// Display defaults and option lists (IFCN/ILAE 2023, Peltola et al.)
// ---------------------------------------------------------------------------

export interface DisplayFilterSettings {
  /** Low-frequency filter (high-pass) cutoff in Hz, or null = off. */
  lffHz: number | null;
  /** High-frequency filter (low-pass) cutoff in Hz, or null = off. */
  hffHz: number | null;
  /** Mains notch frequency, or null = off. */
  notchHz: number | null;
  /** 'zero' (default): forward–backward; 'causal': one forward pass (amplifier-like). */
  phase?: 'zero' | 'causal';
}

export interface DisplaySettings extends DisplayFilterSettings {
  /** µV per (nominal) mm. Larger number = smaller traces. */
  sensitivityUvPerMm: number;
  secondsPerPage: number;
}

/** Recommended display defaults for children (adults: sensitivity 7 µV/mm). */
export const DISPLAY_DEFAULTS: Readonly<DisplaySettings> = {
  lffHz: 0.5,
  hffHz: 70,
  notchHz: null,
  sensitivityUvPerMm: 10,
  secondsPerPage: 10,
};

export const ADULT_SENSITIVITY_UV_PER_MM = 7;

export const SENSITIVITY_OPTIONS = [1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 150, 200, 300, 500] as const;
export const SECONDS_PER_PAGE_OPTIONS = [5, 10, 15, 20, 30] as const;
export const LFF_OPTIONS: readonly (number | null)[] = [null, 0.1, 0.3, 0.5, 1, 2, 5];
export const HFF_OPTIONS: readonly (number | null)[] = [null, 15, 30, 35, 50, 70];
/** 50 Hz is the mains frequency in Poland/Europe, 60 Hz in the Americas. */
export const NOTCH_OPTIONS: readonly (number | null)[] = [null, 50, 60];

/**
 * Step through a sorted numeric option list. `direction` +1 = next larger
 * value, −1 = next smaller. A value not in the list snaps to the nearest
 * option in the requested direction. (For sensitivity, "bigger traces" is a
 * SMALLER µV/mm, i.e. direction −1.)
 */
export function stepOption(options: readonly number[], current: number, direction: 1 | -1): number {
  if (options.length === 0) return current;
  if (direction > 0) {
    for (const o of options) if (o > current + 1e-9) return o;
    return options[options.length - 1];
  }
  for (let i = options.length - 1; i >= 0; i--) if (options[i] < current - 1e-9) return options[i];
  return options[0];
}

/** Time constant (s) of a first-order high-pass with cutoff `lffHz` (TC = 1 / 2πf). */
export function timeConstantSec(lffHz: number): number {
  return 1 / (2 * Math.PI * lffHz);
}

// ---------------------------------------------------------------------------
// Physical scaling
// ---------------------------------------------------------------------------

/**
 * Screen offset (CSS px, y grows downwards) of a channel value in µV, using
 * the negative-up convention: −50 µV → upward (negative dy).
 */
export function uvToDy(uv: number, sensitivityUvPerMm: number, zoom = 1): number {
  const px = (uv / sensitivityUvPerMm) * PX_PER_MM * zoom;
  return POLARITY_NEGATIVE_UP ? px : -px;
}

/** Inverse of {@link uvToDy}. */
export function dyToUv(dy: number, sensitivityUvPerMm: number, zoom = 1): number {
  const uv = (dy / (PX_PER_MM * zoom)) * sensitivityUvPerMm;
  return POLARITY_NEGATIVE_UP ? uv : -uv;
}

/**
 * A "nice" amplitude for the calibration bar (1-2-5 series, µV) whose height
 * is at most `maxPx` CSS px at the given sensitivity.
 */
export function scaleBarUv(sensitivityUvPerMm: number, maxPx = 40, zoom = 1): number {
  const maxUv = (maxPx / (PX_PER_MM * zoom)) * sensitivityUvPerMm;
  const nice = [1, 2, 5];
  let best = 1;
  for (let e = -1; e <= 4; e++) {
    for (const m of nice) {
      const v = m * Math.pow(10, e);
      if (v <= maxUv + 1e-9) best = v;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Biquads (Robert Bristow-Johnson, "Audio EQ Cookbook")
// ---------------------------------------------------------------------------

/** Normalised biquad coefficients (a0 = 1). */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function design(kind: 'lp' | 'hp' | 'notch', f0: number, fs: number, q: number): Biquad {
  if (!(fs > 0) || !(f0 > 0) || f0 >= fs / 2) {
    throw new RangeError(`Biquad cutoff ${f0} Hz must be in (0, ${fs / 2}) for fs = ${fs} Hz`);
  }
  if (!(q > 0)) throw new RangeError(`Biquad Q must be positive (got ${q})`);
  const w0 = (2 * Math.PI * f0) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  let b0: number, b1: number, b2: number;
  if (kind === 'lp') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  } else if (kind === 'hp') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  } else {
    b0 = 1;
    b1 = -2 * cos;
    b2 = 1;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** RBJ high-pass; with the default Q (Butterworth) |H(fc)| = −3 dB. */
export function highpass(fc: number, fs: number, q = Math.SQRT1_2): Biquad {
  return design('hp', fc, fs, q);
}

/** RBJ low-pass; with the default Q (Butterworth) |H(fc)| = −3 dB. */
export function lowpass(fc: number, fs: number, q = Math.SQRT1_2): Biquad {
  return design('lp', fc, fs, q);
}

/** RBJ notch (band-stop); bandwidth ≈ f0 / q. */
export function notch(f0: number, fs: number, q = 30): Biquad {
  return design('notch', f0, fs, q);
}

/**
 * First-order high-pass (bilinear transform, pre-warped) as a degenerate
 * biquad: the classic EEG "time constant" LFF. |H(fc)| = −3 dB.
 */
export function highpass1(fc: number, fs: number): Biquad {
  if (!(fs > 0) || !(fc > 0) || fc >= fs / 2) {
    throw new RangeError(`First-order cutoff ${fc} Hz must be in (0, ${fs / 2}) for fs = ${fs} Hz`);
  }
  const k = Math.tan((Math.PI * fc) / fs);
  const a0 = 1 + k;
  return { b0: 1 / a0, b1: -1 / a0, b2: 0, a1: (k - 1) / a0, a2: 0 };
}

/** First-order low-pass (bilinear, pre-warped) as a degenerate biquad. |H(fc)| = −3 dB. */
export function lowpass1(fc: number, fs: number): Biquad {
  if (!(fs > 0) || !(fc > 0) || fc >= fs / 2) {
    throw new RangeError(`First-order cutoff ${fc} Hz must be in (0, ${fs / 2}) for fs = ${fs} Hz`);
  }
  const k = Math.tan((Math.PI * fc) / fs);
  const a0 = 1 + k;
  return { b0: k / a0, b1: k / a0, b2: 0, a1: (k - 1) / a0, a2: 0 };
}

/** |H(e^{jω})| of a biquad at frequency `f` (single pass). */
export function biquadMagnitude(c: Biquad, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2;
  const ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = 1 + c.a1 * c1 + c.a2 * c2;
  const di = -(c.a1 * s1 + c.a2 * s2);
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}

/** Magnitude of a cascade, optionally for a forward–backward (zero-phase) pass. */
export function cascadeMagnitude(sections: readonly Biquad[], f: number, fs: number, zeroPhase = false): number {
  let m = 1;
  for (const s of sections) m *= biquadMagnitude(s, f, fs);
  return zeroPhase ? m * m : m;
}

function dcGain(c: Biquad): number {
  const den = 1 + c.a1 + c.a2;
  return Math.abs(den) < 1e-15 ? 0 : (c.b0 + c.b1 + c.b2) / den;
}

/** Run one biquad in place (transposed direct form II) from steady state for `x0`. */
function runSectionInPlace(buf: Float64Array, c: Biquad, x0: number): void {
  // Steady-state state for a constant input x0 (cf. scipy.signal.lfilter_zi).
  const g = dcGain(c);
  let z1 = x0 * (c.b1 + c.b2 - (c.a1 + c.a2) * g);
  let z2 = x0 * (c.b2 - c.a2 * g);
  const { b0, b1, b2, a1, a2 } = c;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    buf[i] = y;
  }
}

function runCascadeInPlace(buf: Float64Array, sections: readonly Biquad[]): void {
  let level = buf.length > 0 ? buf[0] : 0;
  for (const s of sections) {
    runSectionInPlace(buf, s, level);
    level *= dcGain(s);
  }
}

/**
 * Causal single-pass filtering (zero initial state) — e.g. for the synthetic
 * generator or to demonstrate phase distortion. Returns a new array.
 */
export function applyBiquad(x: ArrayLike<number>, c: Biquad | readonly Biquad[]): Float32Array {
  const sections = Array.isArray(c) ? (c as readonly Biquad[]) : [c as Biquad];
  let buf = Float64Array.from(x as ArrayLike<number>);
  for (const s of sections) {
    const { b0, b1, b2, a1, a2 } = s;
    let z1 = 0, z2 = 0;
    const out = new Float64Array(buf.length);
    for (let i = 0; i < buf.length; i++) {
      const xi = buf[i];
      const y = b0 * xi + z1;
      z1 = b1 * xi - a1 * y + z2;
      z2 = b2 * xi - a2 * y;
      out[i] = y;
    }
    buf = out;
  }
  return Float32Array.from(buf);
}

export interface FiltfiltOptions {
  /**
   * Samples of odd-reflection padding at each end (clamped to n − 1).
   * Default: 3 × (2 × sections + 1), like scipy.
   */
  padLen?: number;
}

/**
 * Zero-phase forward–backward filtering through a biquad cascade. Edges are
 * padded by odd reflection and each pass starts from steady state, which
 * keeps start/end transients small. Returns a new Float32Array.
 */
export function filtfilt(
  x: ArrayLike<number>,
  sections: readonly Biquad[],
  opts: FiltfiltOptions = {},
): Float32Array {
  const n = x.length;
  if (n === 0) return new Float32Array(0);
  if (sections.length === 0) return Float32Array.from(x as ArrayLike<number>);
  const pad = Math.max(0, Math.min(n - 1, Math.floor(opts.padLen ?? 3 * (2 * sections.length + 1))));
  const len = n + 2 * pad;
  const buf = new Float64Array(len);
  const x0 = x[0];
  const xn = x[n - 1];
  for (let i = 0; i < pad; i++) buf[i] = 2 * x0 - x[pad - i];
  for (let i = 0; i < n; i++) buf[pad + i] = x[i];
  for (let i = 0; i < pad; i++) buf[pad + n + i] = 2 * xn - x[n - 2 - i];
  runCascadeInPlace(buf, sections);
  buf.reverse();
  runCascadeInPlace(buf, sections);
  buf.reverse();
  return Float32Array.from(buf.subarray(pad, pad + n));
}

/**
 * Cutoff correction for a 2nd-order Butterworth section run forward AND
 * backward: the squared response is −3 dB at fc × 0.8023 (low-pass: divide,
 * high-pass: multiply) — (√2 − 1)^(1/4).
 */
export const FILTFILT_BUTTERWORTH2_CORRECTION = Math.pow(Math.SQRT2 - 1, 0.25);

/** Same correction for a first-order section run forward and backward: (√2 − 1)^(1/2) ≈ 0.6436. */
export const FILTFILT_FIRST_ORDER_CORRECTION = Math.sqrt(Math.SQRT2 - 1);

export type DisplayFilterKind = 'lff' | 'hff' | 'notch';

/**
 * Scale a cutoff in the bilinear-warped frequency domain, where the digital
 * Butterworth magnitude is exactly the analog one: tan(πf'/fs) = k·tan(πf/fs).
 * (A plain f·k would be wrong near Nyquist, e.g. HFF 70 Hz at 256 Hz.)
 */
function warpedCutoff(fc: number, fs: number, k: number): number {
  return (fs / Math.PI) * Math.atan(Math.tan((Math.PI * fc) / fs) * k);
}

/**
 * Biquad cascade for the display filters. For the default zero-phase use
 * (with {@link filtfilt}) cutoffs are corrected so the combined two-pass
 * response is −3 dB at the nominal LFF/HFF; for `phase: 'causal'` they are
 * the nominal ones. Settings outside (0, Nyquist) are skipped (e.g. HFF
 * 70 Hz on a 128 Hz recording); `skipped` lists them so the UI can say so.
 */
export function designDisplayFilters(
  settings: DisplayFilterSettings,
  fs: number,
): { sections: Biquad[]; skipped: DisplayFilterKind[] } {
  const sections: Biquad[] = [];
  const skipped: DisplayFilterKind[] = [];
  const nyq = fs / 2;
  const zero = settings.phase !== 'causal';
  const k1 = zero ? FILTFILT_FIRST_ORDER_CORRECTION : 1;
  const k2 = zero ? FILTFILT_BUTTERWORTH2_CORRECTION : 1;
  if (settings.lffHz != null && settings.lffHz > 0) {
    if (settings.lffHz < nyq * 0.95) sections.push(highpass1(warpedCutoff(settings.lffHz, fs, k1), fs));
    else skipped.push('lff');
  }
  if (settings.hffHz != null && settings.hffHz > 0) {
    if (settings.hffHz < nyq * 0.95) sections.push(lowpass(warpedCutoff(settings.hffHz, fs, 1 / k2), fs));
    else skipped.push('hff');
  }
  if (settings.notchHz != null && settings.notchHz > 0) {
    if (settings.notchHz < nyq * 0.95) sections.push(notch(settings.notchHz, fs));
    else skipped.push('notch');
  }
  return { sections, skipped };
}

/** Padding long enough to settle the lowest cutoff (≈ one period), capped by n − 1. */
export function displayPadLen(settings: DisplayFilterSettings, fs: number, n: number): number {
  const lowest = settings.lffHz != null && settings.lffHz > 0 ? settings.lffHz : null;
  const base = lowest ? Math.ceil(fs / lowest) : Math.ceil(fs / 2);
  return Math.max(0, Math.min(n - 1, base));
}

/** Causal cascade from steady state at x[0] (no start-up transient). */
function causalFromSteadyState(x: ArrayLike<number>, sections: readonly Biquad[]): Float32Array {
  const buf = Float64Array.from(x as ArrayLike<number>);
  runCascadeInPlace(buf, sections);
  return Float32Array.from(buf);
}

/**
 * Display filtering of one channel (returns a new array; a copy if no filter
 * is active). Zero-phase by default; `settings.phase === 'causal'` runs one
 * forward pass started from steady state.
 */
export function applyDisplayFilters(
  x: Float32Array,
  settings: DisplayFilterSettings,
  fs: number,
): Float32Array {
  const { sections } = designDisplayFilters(settings, fs);
  if (sections.length === 0) return Float32Array.from(x);
  if (settings.phase === 'causal') return causalFromSteadyState(x, sections);
  return filtfilt(x, sections, { padLen: displayPadLen(settings, fs, x.length) });
}

// ---------------------------------------------------------------------------
// Decimation for drawing
// ---------------------------------------------------------------------------

export interface MinMaxColumns {
  min: Float32Array;
  max: Float32Array;
}

/**
 * Min/max decimation of `data[startIdx, endIdx)` into `columns` pixel columns
 * (plain striding would drop spikes). Each column also includes the last
 * sample of the previous column so that adjacent columns connect when drawn
 * as vertical segments. Fractional indices are allowed (sub-sample paging);
 * columns that fall outside the data are NaN.
 */
export function minMaxDecimate(
  data: ArrayLike<number>,
  startIdx: number,
  endIdx: number,
  columns: number,
  out?: MinMaxColumns,
): MinMaxColumns {
  const cols = Math.max(0, Math.floor(columns));
  const min = out && out.min.length === cols ? out.min : new Float32Array(cols);
  const max = out && out.max.length === cols ? out.max : new Float32Array(cols);
  const n = data.length;
  const span = endIdx - startIdx;
  for (let c = 0; c < cols; c++) {
    const a = startIdx + (c * span) / cols;
    const b = startIdx + ((c + 1) * span) / cols;
    // Sample i is held over [i, i + 1); a column covers positions [a, b).
    if (b <= 0 || a >= n) {
      min[c] = NaN;
      max[c] = NaN;
      continue;
    }
    const i0 = Math.ceil(a); // first sample inside the column
    const i1 = Math.ceil(b); // exclusive
    // Also take the last sample before the column: adjacent columns then
    // connect, and an empty column (upsampling) gets its two neighbours.
    const lo = Math.max(0, i0 - 1);
    const hi = Math.min(n, Math.max(i1, i0 + 1));
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = lo; i < hi; i++) {
      const v = data[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    min[c] = mn;
    max[c] = mx;
  }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Measurements (caliper)
// ---------------------------------------------------------------------------

/** Linearly interpolated value at time `t` (s); NaN outside the data. */
export function sampleAt(data: ArrayLike<number>, fs: number, t: number, dataStartSec = 0): number {
  const x = (t - dataStartSec) * fs;
  if (!(x >= 0) || x > data.length - 1) return NaN;
  const i = Math.floor(x);
  const f = x - i;
  if (f === 0 || i + 1 >= data.length) return data[i];
  return data[i] * (1 - f) + data[i + 1] * f;
}

export interface WindowMeasurement {
  /** |t1 − t0| in milliseconds. */
  dtMs: number;
  /** 1 / Δt in Hz (Infinity when Δt = 0). */
  freqHz: number;
  minUv: number;
  maxUv: number;
  /** Peak-to-peak amplitude in the window (max − min), µV. */
  ppUv: number;
  /** Times (s) of the minimum and maximum. */
  minT: number;
  maxT: number;
}

/**
 * Caliper readout between two times on one channel: Δt (ms), 1/Δt (Hz) and
 * the peak-to-peak amplitude inside the window. Order of t0/t1 does not matter.
 */
export function measureWindow(
  data: ArrayLike<number>,
  fs: number,
  t0: number,
  t1: number,
  dataStartSec = 0,
): WindowMeasurement {
  const a = Math.min(t0, t1);
  const b = Math.max(t0, t1);
  const dt = b - a;
  const i0 = Math.max(0, Math.floor((a - dataStartSec) * fs));
  const i1 = Math.min(data.length - 1, Math.ceil((b - dataStartSec) * fs));
  let mn = Infinity, mx = -Infinity, iMin = i0, iMax = i0;
  for (let i = i0; i <= i1; i++) {
    const v = data[i];
    if (v < mn) { mn = v; iMin = i; }
    if (v > mx) { mx = v; iMax = i; }
  }
  if (!Number.isFinite(mn)) {
    mn = NaN;
    mx = NaN;
  }
  return {
    dtMs: dt * 1000,
    freqHz: dt > 0 ? 1 / dt : Infinity,
    minUv: mn,
    maxUv: mx,
    ppUv: mx - mn,
    minT: dataStartSec + iMin / fs,
    maxT: dataStartSec + iMax / fs,
  };
}

/** IFCN duration classes for a transient (Kane et al. 2017). */
export const SPIKE_DURATION_MS = { min: 20, max: 70 } as const;
export const SHARP_WAVE_DURATION_MS = { min: 70, max: 200 } as const;

/** Classify a measured transient duration: spike 20–<70 ms, sharp wave 70–200 ms. */
export function classifyTransientDuration(ms: number): 'spike' | 'sharp' | 'other' {
  if (ms >= SPIKE_DURATION_MS.min && ms < SPIKE_DURATION_MS.max) return 'spike';
  if (ms >= SHARP_WAVE_DURATION_MS.min && ms <= SHARP_WAVE_DURATION_MS.max) return 'sharp';
  return 'other';
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/** "mm:ss" (or "h:mm:ss"); `decimals` adds fractional seconds. */
export function formatTime(sec: number, decimals = 0): string {
  const neg = sec < 0;
  const s = Math.abs(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s - h * 3600 - m * 60;
  let ss = decimals > 0 ? rest.toFixed(decimals) : String(Math.floor(rest + 1e-9));
  if (Number(ss) >= 60) ss = decimals > 0 ? (59.999).toFixed(decimals) : '59';
  const [whole, frac] = ss.split('.');
  const sPart = whole.padStart(2, '0') + (frac ? `.${frac}` : '');
  const mm = String(m).padStart(2, '0');
  return `${neg ? '-' : ''}${h > 0 ? `${h}:` : ''}${mm}:${sPart}`;
}

/** "mm:ss–mm:ss" for a page readout. */
export function formatTimeRange(startSec: number, endSec: number): string {
  return `${formatTime(startSec)}–${formatTime(endSec)}`;
}
