// Canvas2D drawing for TraceCanvas. No React; takes a context already scaled
// to CSS pixels (ctx.setTransform(dpr, …)). Kept separate so the drawing can
// be exercised with a recording mock context in tests.

import { formatTime, measureWindow, minMaxDecimate, scaleBarUv, uvToDy, type MinMaxColumns } from '@/lib/eeg/dsp';

import { formatCaliper } from './figureMath';
import { gridLines, timeLabelStep, timeToX, type TraceLayout } from './traceLayout';
import type { EegTheme } from './useEegTheme';

export interface TraceChannel {
  label: string;
  /** µV, display-filtered. */
  data: Float32Array;
  available: boolean;
  /** Chain/group index (gaps between groups). */
  group?: number;
}

export type TraceMarkTone = 'mark' | 'hit' | 'miss' | 'false' | 'key';

/** A learner mark or key item: point (t) or range (t..t1), optionally on one channel. */
export interface TraceMark {
  id?: string;
  t: number;
  t1?: number;
  /** Channel label; null/undefined = all channels. */
  channel?: string | null;
  tone?: TraceMarkTone;
  label?: string;
}

export type TraceShadingTone = 'annotation' | 'selection' | 'key' | 'hit' | 'miss';

/** Background shading of a time span (expert annotation, selection, key). */
export interface TraceShading {
  t0: number;
  t1: number;
  channels?: readonly string[] | null;
  tone?: TraceShadingTone;
  label?: string;
}

export interface TraceCaliper {
  t0: number;
  t1: number;
  channelIndex: number;
}

export interface TraceBaseState {
  channels: readonly TraceChannel[];
  sampleRate: number;
  dataStartSec: number;
  sensitivityUvPerMm: number;
  zoom: number;
  shadings: readonly TraceShading[];
  marks: readonly TraceMark[];
  highlight: ReadonlySet<number>;
  dim: ReadonlySet<number>;
  showTimeAxis: boolean;
  showScaleBar: boolean;
  /** Reusable decimation buffers keyed by channel index. */
  buffers?: Map<number, MinMaxColumns>;
}

export interface TraceOverlayState {
  caliper: TraceCaliper | null;
  /** Range being dragged in mark-range mode. */
  draft: { t0: number; t1: number; channelIndex: number | null } | null;
  /** Hover line (mouse) in interactive modes. */
  hoverT: number | null;
}

function toneColor(theme: EegTheme, tone: TraceMarkTone | TraceShadingTone | undefined): string {
  switch (tone) {
    case 'hit':
      return theme.hit;
    case 'miss':
      return theme.miss;
    case 'false':
      return theme.falseMark;
    case 'key':
      return theme.keyOverlay;
    case 'annotation':
      return theme.annotation;
    default:
      return theme.selection;
  }
}

const GLYPH: Record<TraceMarkTone, string> = { mark: '', hit: '✓', miss: '!', false: '✕', key: '' };

function rowSpan(layout: TraceLayout, index: number): [number, number] {
  const c = layout.rowCenters[index];
  return [c - layout.spacing / 2, c + layout.spacing / 2];
}

function channelSpan(layout: TraceLayout, channels: readonly TraceChannel[], label: string | null | undefined): [number, number] {
  if (label) {
    const i = channels.findIndex((c) => c.label === label);
    if (i >= 0) return rowSpan(layout, i);
  }
  return [layout.plotY, layout.plotY + layout.plotH];
}

function setFont(ctx: CanvasRenderingContext2D, px: number, family: string, weight = 400): void {
  ctx.font = `${weight} ${px}px ${family}`;
}

/** Draw the static layer: background, grid, shading, labels, traces, marks, scale bar. */
export function drawTraceBase(
  ctx: CanvasRenderingContext2D,
  layout: TraceLayout,
  state: TraceBaseState,
  theme: EegTheme,
  dpr: number,
): void {
  const { plotX, plotY, plotW, plotH } = layout;
  const t0 = layout.startSec;
  const t1 = layout.startSec + layout.secondsPerPage;
  ctx.save();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = theme.bgSubtle;
  ctx.fillRect(0, 0, plotX, layout.height);
  ctx.globalAlpha = 1;

  // Shadings (under the grid and traces).
  for (const s of state.shadings) {
    const a = Math.max(t0, Math.min(s.t0, s.t1));
    const b = Math.min(t1, Math.max(s.t0, s.t1));
    if (b <= a) continue;
    const color = toneColor(theme, s.tone ?? 'annotation');
    const x0 = timeToX(layout, a);
    const x1 = timeToX(layout, b);
    const spans = s.channels && s.channels.length > 0
      ? s.channels.map((l) => channelSpan(layout, state.channels, l))
      : [[plotY, plotY + plotH] as [number, number]];
    ctx.fillStyle = color;
    for (const [y0, y1] of spans) {
      ctx.globalAlpha = s.tone === 'selection' ? 0.16 : 0.12;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.globalAlpha = 1;
    if (s.tone === 'key' || s.tone === 'miss') {
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      for (const [y0, y1] of spans) ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
      ctx.setLineDash([]);
    }
    if (s.label) {
      setFont(ctx, 10, theme.fontSans, 600);
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(s.label, x0 + 3, spans[0][0] + 2, Math.max(20, x1 - x0 - 4));
    }
  }

  // Grid.
  for (const g of gridLines(layout)) {
    const x = Math.round(timeToX(layout, g.t) * dpr) / dpr + 0.5 / dpr;
    ctx.strokeStyle = g.kind === 'strong' ? theme.gridStrong : theme.grid;
    ctx.globalAlpha = g.kind === 'minor' ? 0.5 : 1;
    ctx.lineWidth = g.kind === 'strong' ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(x, plotY);
    ctx.lineTo(x, plotY + plotH);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Time axis.
  if (state.showTimeAxis && plotY > 0) {
    const step = timeLabelStep(layout.pxPerSec);
    setFont(ctx, 10, theme.fontMono);
    ctx.fillStyle = theme.label;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const decimals = step < 1 ? 1 : 0;
    const first = Math.ceil(t0 / step - 1e-9);
    for (let k = first; k * step <= t1 + 1e-9; k++) {
      const t = Number((k * step).toFixed(6));
      const x = timeToX(layout, t);
      if (x < plotX + 18 || x > plotX + plotW - 18) continue;
      ctx.fillText(formatTime(t, decimals), x, plotY / 2);
    }
  }

  // Labels.
  const labelPx = Math.max(9, Math.min(12, layout.spacing * 0.62));
  state.channels.forEach((ch, i) => {
    const y = layout.rowCenters[i];
    setFont(ctx, labelPx, theme.fontSans, state.highlight.has(i) ? 700 : 500);
    ctx.fillStyle = !ch.available || state.dim.has(i) ? theme.traceDim : state.highlight.has(i) ? theme.accent : theme.label;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(ch.label, plotX - 6, y, plotX - 8);
  });

  // Traces (may overlap neighbouring rows, as on paper; clipped to the plot).
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotX, 0, plotW, layout.height);
  ctx.clip();
  const fs = state.sampleRate;
  const startIdx = (t0 - state.dataStartSec) * fs;
  const endIdx = (t1 - state.dataStartSec) * fs;
  const columns = Math.max(1, Math.min(4096, Math.round(plotW * dpr)));
  const samplesPerCol = (endIdx - startIdx) / columns;
  const k = (uv: number) => uvToDy(uv, state.sensitivityUvPerMm, state.zoom);
  state.channels.forEach((ch, i) => {
    const y0 = layout.rowCenters[i];
    if (!ch.available) {
      ctx.strokeStyle = theme.traceDim;
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotX, y0);
      ctx.lineTo(plotX + plotW, y0);
      ctx.stroke();
      ctx.setLineDash([]);
      setFont(ctx, 10, theme.fontSans);
      ctx.fillStyle = theme.traceDim;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('n/a', plotX + 6, y0 - 1);
      return;
    }
    ctx.strokeStyle = state.highlight.has(i) ? theme.accent : state.dim.has(i) ? theme.traceDim : theme.trace;
    ctx.lineWidth = state.highlight.has(i) ? 1.5 : 1;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    if (samplesPerCol >= 1.5) {
      let buf = state.buffers?.get(i);
      buf = minMaxDecimate(ch.data, startIdx, endIdx, columns, buf);
      state.buffers?.set(i, buf);
      const dx = plotW / columns;
      for (let c = 0; c < columns; c++) {
        const mn = buf.min[c];
        const mx = buf.max[c];
        if (!Number.isFinite(mn)) {
          started = false;
          continue;
        }
        const x = plotX + (c + 0.5) * dx;
        if (!started) {
          ctx.moveTo(x, y0 + k(mn));
          started = true;
        } else ctx.lineTo(x, y0 + k(mn));
        ctx.lineTo(x, y0 + k(mx));
      }
    } else {
      const a = Math.max(0, Math.floor(startIdx) - 1);
      const b = Math.min(ch.data.length - 1, Math.ceil(endIdx) + 1);
      for (let s = a; s <= b; s++) {
        const x = timeToX(layout, state.dataStartSec + s / fs);
        const y = y0 + k(ch.data[s]);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  });
  ctx.restore();

  // Marks.
  for (const m of state.marks) {
    const tone = m.tone ?? 'mark';
    const color = toneColor(theme, tone);
    const [ya, yb] = channelSpan(layout, state.channels, m.channel);
    const xa = timeToX(layout, m.t);
    const isRange = m.t1 !== undefined && m.t1 !== m.t;
    const xb = isRange ? timeToX(layout, m.t1!) : xa;
    if (Math.max(xa, xb) < plotX || Math.min(xa, xb) > plotX + plotW) continue;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = tone === 'mark' ? 1.5 : 2;
    ctx.setLineDash(tone === 'miss' || tone === 'key' ? [5, 3] : tone === 'false' ? [2, 2] : []);
    if (isRange) {
      const x0 = Math.min(xa, xb);
      const w = Math.abs(xb - xa);
      ctx.globalAlpha = 0.14;
      ctx.fillRect(x0, ya, w, yb - ya);
      ctx.globalAlpha = 1;
      ctx.strokeRect(x0, ya, w, yb - ya);
    } else {
      ctx.beginPath();
      ctx.moveTo(xa, ya);
      ctx.lineTo(xa, yb);
      ctx.stroke();
      // Small flag at the top so a thin line is easy to find.
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(xa - 4, ya);
      ctx.lineTo(xa + 4, ya);
      ctx.lineTo(xa, ya + 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.setLineDash([]);
    const text = [GLYPH[tone], m.label].filter(Boolean).join(' ');
    if (text) {
      setFont(ctx, 11, theme.fontSans, 700);
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      const tx = Math.min(Math.min(xa, xb) + 4, plotX + plotW - 40);
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.bg;
      ctx.strokeText(text, tx, ya + 6);
      ctx.fillStyle = color;
      ctx.fillText(text, tx, ya + 6);
    }
  }

  // Calibration bar: 1 s horizontally, a nice µV value vertically.
  if (state.showScaleBar && layout.pxPerSec > 0) {
    const uv = scaleBarUv(state.sensitivityUvPerMm, Math.min(40, layout.plotH / 4), state.zoom);
    const h = Math.abs(uvToDy(uv, state.sensitivityUvPerMm, state.zoom));
    const w = layout.pxPerSec;
    const right = plotX + plotW - 8;
    const bottom = layout.height - 6;
    const label = `1 s · ${uv} µV`;
    setFont(ctx, 10, theme.fontSans, 500);
    const tw = ctx.measureText ? ctx.measureText(label).width : label.length * 6;
    const boxW = Math.max(w, tw) + 12;
    if (boxW < plotW * 0.6) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(right - boxW, bottom - h - 18, boxW + 4, h + 20);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.label;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(right - w, bottom - h);
      ctx.lineTo(right - w, bottom);
      ctx.lineTo(right, bottom);
      ctx.stroke();
      ctx.fillStyle = theme.label;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, right, bottom - h - 2);
    }
  }
  ctx.restore();
}

/** Readout of a caliper on its channel (null when the channel is missing/unavailable). */
export function caliperMeasurement(
  channels: readonly TraceChannel[],
  caliper: TraceCaliper,
  sampleRate: number,
  dataStartSec = 0,
): ReturnType<typeof measureWindow> | null {
  const ch = channels[caliper.channelIndex];
  if (!ch || !ch.available) return null;
  return measureWindow(ch.data, sampleRate, caliper.t0, caliper.t1, dataStartSec);
}

/** Draw the interactive layer: hover line, draft range, caliper with readout. */
export function drawTraceOverlay(
  ctx: CanvasRenderingContext2D,
  layout: TraceLayout,
  base: Pick<TraceBaseState, 'channels' | 'sampleRate' | 'dataStartSec'>,
  state: TraceOverlayState,
  theme: EegTheme,
): void {
  ctx.clearRect(0, 0, layout.width, layout.height);
  const { plotX, plotY, plotW, plotH } = layout;
  ctx.save();
  if (state.hoverT !== null) {
    const x = timeToX(layout, state.hoverT);
    if (x >= plotX && x <= plotX + plotW) {
      ctx.strokeStyle = theme.label;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plotY);
      ctx.lineTo(x, plotY + plotH);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  if (state.draft) {
    const x0 = timeToX(layout, Math.min(state.draft.t0, state.draft.t1));
    const x1 = timeToX(layout, Math.max(state.draft.t0, state.draft.t1));
    const [ya, yb] = state.draft.channelIndex !== null ? rowSpan(layout, state.draft.channelIndex) : [plotY, plotY + plotH];
    ctx.fillStyle = theme.selection;
    ctx.globalAlpha = 0.18;
    ctx.fillRect(x0, ya, x1 - x0, yb - ya);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.selection;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0, ya, x1 - x0, yb - ya);
    ctx.setLineDash([]);
  }
  if (state.caliper) {
    const c = state.caliper;
    const xa = timeToX(layout, Math.min(c.t0, c.t1));
    const xb = timeToX(layout, Math.max(c.t0, c.t1));
    const center = layout.rowCenters[c.channelIndex] ?? plotY + plotH / 2;
    const half = Math.max(layout.spacing * 1.5, 18);
    ctx.fillStyle = theme.caliper;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(xa, center - half, xb - xa, 2 * half);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.caliper;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const x of [xa, xb]) {
      ctx.moveTo(x, center - half);
      ctx.lineTo(x, center + half);
    }
    ctx.moveTo(xa, center - half);
    ctx.lineTo(xb, center - half);
    ctx.stroke();
    const m = caliperMeasurement(base.channels, c, base.sampleRate, base.dataStartSec);
    if (m) {
      const text = formatCaliper({ dtMs: m.dtMs, freqHz: m.freqHz, dvUv: m.ppUv });
      setFont(ctx, 11, theme.fontMono, 600);
      const w = ctx.measureText ? ctx.measureText(text).width : text.length * 7;
      const tx = Math.max(plotX + 2, Math.min(xa, plotX + plotW - w - 8));
      const ty = Math.max(plotY + 2, center - half - 20);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(tx - 3, ty - 1, w + 8, 17);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.caliper;
      ctx.lineWidth = 1;
      ctx.strokeRect(tx - 3, ty - 1, w + 8, 17);
      ctx.fillStyle = theme.caliper;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(text, tx + 1, ty + 2);
    }
  }
  ctx.restore();
}
