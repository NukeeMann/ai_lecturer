// Pure layout math for TraceCanvas (CSS pixels). Node-safe, unit-tested.

export interface TraceLayoutInput {
  /** Canvas size in CSS px. */
  width: number;
  height: number;
  /** Group (chain) index per channel; a change between neighbours inserts a gap. */
  groups: readonly number[];
  labelWidth: number;
  /** Height of the time axis strip at the top (0 = none). */
  timeAxisHeight: number;
  /** Free space under the last channel (scale bar etc.). */
  bottomPad: number;
  startSec: number;
  secondsPerPage: number;
  /** Gap between groups, as a fraction of the channel spacing (default 0.6). */
  groupGap?: number;
}

export interface TraceLayout {
  width: number;
  height: number;
  plotX: number;
  plotY: number;
  plotW: number;
  plotH: number;
  /** Distance between neighbouring baselines (px). */
  spacing: number;
  /** Baseline y of every channel. */
  rowCenters: number[];
  pxPerSec: number;
  startSec: number;
  secondsPerPage: number;
}

export function computeTraceLayout(input: TraceLayoutInput): TraceLayout {
  const n = input.groups.length;
  const gapK = input.groupGap ?? 0.6;
  const plotX = Math.max(0, input.labelWidth);
  const plotY = Math.max(0, input.timeAxisHeight);
  const plotW = Math.max(1, input.width - plotX - 4);
  const plotH = Math.max(1, input.height - plotY - Math.max(0, input.bottomPad));
  let breaks = 0;
  for (let i = 1; i < n; i++) if (input.groups[i] !== input.groups[i - 1]) breaks++;
  const units = Math.max(1, n + gapK * breaks);
  const spacing = plotH / units;
  const rowCenters: number[] = [];
  let gapsBefore = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && input.groups[i] !== input.groups[i - 1]) gapsBefore++;
    rowCenters.push(plotY + spacing * (i + 0.5 + gapK * gapsBefore));
  }
  const sec = Math.max(1e-6, input.secondsPerPage);
  return {
    width: input.width,
    height: input.height,
    plotX,
    plotY,
    plotW,
    plotH,
    spacing,
    rowCenters,
    pxPerSec: plotW / sec,
    startSec: input.startSec,
    secondsPerPage: sec,
  };
}

export function timeToX(l: TraceLayout, t: number): number {
  return l.plotX + (t - l.startSec) * l.pxPerSec;
}

export function xToTime(l: TraceLayout, x: number): number {
  return l.startSec + (x - l.plotX) / l.pxPerSec;
}

/** Channel whose baseline is nearest to y (within the plot), or null. */
export function yToChannel(l: TraceLayout, y: number): number | null {
  if (l.rowCenters.length === 0 || y < l.plotY - l.spacing / 2 || y > l.plotY + l.plotH + l.spacing / 2) return null;
  let best = 0;
  let bestD = Infinity;
  l.rowCenters.forEach((c, i) => {
    const d = Math.abs(c - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export interface GridLine {
  t: number;
  kind: 'minor' | 'second' | 'strong';
}

/**
 * Vertical grid: every second (stronger every 5 s); 0.2 s minor lines when
 * there are at least `minorMinPx` px per second.
 */
export function gridLines(l: TraceLayout, minorMinPx = 150): GridLine[] {
  const out: GridLine[] = [];
  const t0 = l.startSec;
  const t1 = l.startSec + l.secondsPerPage;
  const step = l.pxPerSec >= minorMinPx ? 0.2 : 1;
  const first = Math.ceil(t0 / step - 1e-9) * step;
  for (let k = 0; ; k++) {
    const t = Number((first + k * step).toFixed(6));
    if (t > t1 + 1e-9) break;
    const whole = Math.abs(t - Math.round(t)) < 1e-6;
    out.push({ t, kind: whole ? (Math.round(t) % 5 === 0 ? 'strong' : 'second') : 'minor' });
  }
  return out;
}

/** Seconds between time labels so labels are ≥ `minPx` apart (0.2, 0.5, 1, 2, 5, 10…). */
export function timeLabelStep(pxPerSec: number, minPx = 46): number {
  for (const s of [0.2, 0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * pxPerSec >= minPx) return s;
  return 60;
}

/** Label column width (px) for a set of labels at a given font size. */
export function estimateLabelWidth(labels: readonly string[], fontPx = 11): number {
  const longest = labels.reduce((m, l) => Math.max(m, l.length), 0);
  return Math.ceil(Math.min(120, Math.max(40, longest * fontPx * 0.6 + 12)));
}

/** Default canvas height: ≈ 18 px per channel + axis, at least 320 px. */
export function defaultTraceHeight(nChannels: number, nGroupBreaks = 0, timeAxisHeight = 18): number {
  return Math.max(320, Math.round(nChannels * 18 + nGroupBreaks * 11 + timeAxisHeight + 24));
}
