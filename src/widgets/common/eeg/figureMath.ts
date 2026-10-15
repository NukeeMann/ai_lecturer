// Pure zoom/pan math, overlay item types and calibrated-caliper readouts for
// FigureCanvas. Node-safe, unit-tested.
//
// Coordinates:
//   • viewport px: the visible box (W × H) at the top-left of the component;
//   • normalised: 0..1 of the image's natural size, origin top-left;
//   • scale 1 = image fitted to the viewport width (fit-width default).

import type { NormPoint, NormRect } from '@/lib/eeg/scoring';

import type { FigureCalibration } from './figure';

export interface ViewTransform {
  /** ≥ 1, relative to fit-width. */
  scale: number;
  /** Image offset in viewport px (≤ 0 once zoomed). */
  tx: number;
  ty: number;
}

export const IDENTITY_VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

/** Keep the zoomed image covering the viewport and the scale in [1, maxScale]. */
export function clampView(v: ViewTransform, W: number, H: number, maxScale = 8): ViewTransform {
  const scale = Math.min(maxScale, Math.max(1, Number.isFinite(v.scale) ? v.scale : 1));
  const minTx = W - W * scale;
  const minTy = H - H * scale;
  return {
    scale,
    tx: Math.min(0, Math.max(minTx, v.tx)),
    ty: Math.min(0, Math.max(minTy, v.ty)),
  };
}

/** Zoom by `factor` keeping the image point under (px, py) fixed. */
export function zoomAt(
  v: ViewTransform,
  factor: number,
  px: number,
  py: number,
  W: number,
  H: number,
  maxScale = 8,
): ViewTransform {
  const scale = Math.min(maxScale, Math.max(1, v.scale * factor));
  const ix = (px - v.tx) / v.scale;
  const iy = (py - v.ty) / v.scale;
  return clampView({ scale, tx: px - ix * scale, ty: py - iy * scale }, W, H, maxScale);
}

export function panBy(v: ViewTransform, dx: number, dy: number, W: number, H: number, maxScale = 8): ViewTransform {
  return clampView({ scale: v.scale, tx: v.tx + dx, ty: v.ty + dy }, W, H, maxScale);
}

export function screenToNorm(v: ViewTransform, px: number, py: number, W: number, H: number): NormPoint {
  return { x: (px - v.tx) / (W * v.scale), y: (py - v.ty) / (H * v.scale) };
}

export function normToScreen(v: ViewTransform, p: NormPoint, W: number, H: number): { x: number; y: number } {
  return { x: v.tx + p.x * W * v.scale, y: v.ty + p.y * H * v.scale };
}

/** Normalised rectangle of the image currently visible. */
export function viewRect(v: ViewTransform, W: number, H: number): NormRect {
  const a = screenToNorm(v, 0, 0, W, H);
  return { x: a.x, y: a.y, w: 1 / v.scale, h: 1 / v.scale };
}

// ---------------------------------------------------------------------------
// Overlay items (drawn by FigureCanvas in viewport px; data in normalised)
// ---------------------------------------------------------------------------

/**
 * `mark` learner mark before checking · `hit` correct mark · `false` wrong
 * mark · `miss` expert target not found · `key` expert target (found or
 * revealed) · `distractor` wrong mark in a known confusable region ·
 * `draft` mark being drawn · `caliper` measurement.
 */
export type FigureOverlayTone = 'mark' | 'hit' | 'miss' | 'false' | 'key' | 'distractor' | 'draft' | 'caliper';

export type FigureOverlayItem =
  | { kind: 'point'; id?: string; x: number; y: number; tone: FigureOverlayTone; label?: string }
  | { kind: 'rect'; id?: string; rect: NormRect; tone: FigureOverlayTone; label?: string }
  | { kind: 'caliper'; id?: string; from: NormPoint; to: NormPoint; label?: string };

/** Text glyph per tone so colour is never the only signal. */
export const TONE_GLYPH: Readonly<Record<FigureOverlayTone, string>> = {
  mark: '',
  hit: '✓',
  miss: '!',
  false: '✕',
  key: '',
  distractor: '!',
  draft: '',
  caliper: '',
};

// ---------------------------------------------------------------------------
// Calibrated caliper on a figure
// ---------------------------------------------------------------------------

export interface FigureCaliperReadout {
  dtMs: number;
  freqHz: number;
  /** null without `uvPerPx`. */
  dvUv: number | null;
  /** Channel row under the start point (null without rows or when far from any). */
  rowLabel: string | null;
}

/** Nearest calibrated row to a normalised y (within half the typical row spacing). */
export function rowLabelAt(y: number, naturalHeight: number, rows: FigureCalibration['rows']): string | null {
  if (!rows || rows.length === 0) return null;
  const ypx = y * naturalHeight;
  const sorted = [...rows].sort((a, b) => a.yPx - b.yPx);
  let spacing = Infinity;
  for (let i = 1; i < sorted.length; i++) spacing = Math.min(spacing, sorted[i].yPx - sorted[i - 1].yPx);
  if (!Number.isFinite(spacing) || spacing <= 0) spacing = naturalHeight;
  let best = sorted[0];
  for (const r of sorted) if (Math.abs(r.yPx - ypx) < Math.abs(best.yPx - ypx)) best = r;
  return Math.abs(best.yPx - ypx) <= spacing / 2 + 1e-9 ? best.label : null;
}

/** Δt / frequency / ΔV between two normalised points of a calibrated figure. */
export function figureCaliperReadout(
  from: NormPoint,
  to: NormPoint,
  natural: { width: number; height: number },
  cal: FigureCalibration,
): FigureCaliperReadout {
  const dxPx = Math.abs(to.x - from.x) * natural.width;
  const dyPx = Math.abs(to.y - from.y) * natural.height;
  const dt = dxPx / cal.pxPerSecond;
  return {
    dtMs: dt * 1000,
    freqHz: dt > 0 ? 1 / dt : Infinity,
    dvUv: cal.uvPerPx ? dyPx * cal.uvPerPx : null,
    rowLabel: rowLabelAt(from.y, natural.height, cal.rows),
  };
}

/** "Δt 52 ms · 19.2 Hz · ΔV 84 µV" (shared by TraceCanvas and figure calipers). */
export function formatCaliper(m: { dtMs: number; freqHz: number; dvUv?: number | null }): string {
  const parts = [`Δt ${m.dtMs < 10 ? m.dtMs.toFixed(1) : Math.round(m.dtMs)} ms`];
  if (Number.isFinite(m.freqHz)) {
    const f = Math.round(m.freqHz * 100) / 100; // decide decimals after rounding (9.9999 → "10.0")
    parts.push(`${f < 10 ? f.toFixed(2) : f.toFixed(1)} Hz`);
  }
  if (m.dvUv != null && Number.isFinite(m.dvUv)) parts.push(`ΔV ${Math.round(m.dvUv)} µV`);
  return parts.join(' · ');
}
