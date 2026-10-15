import { describe, expect, it } from 'vitest';

import { computeTraceLayout } from './traceLayout';
import { caliperMeasurement, drawTraceBase, drawTraceOverlay, type TraceBaseState } from './traceRender';
import { EEG_THEME_FALLBACK } from './useEegTheme';

/** Minimal CanvasRenderingContext2D double that records path points and text. */
function recordingContext() {
  const points: { op: string; x: number; y: number; strokeStyle: string }[] = [];
  const texts: { text: string; x: number; y: number; fillStyle: string }[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineJoin: 'miter',
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    rect() {},
    clip() {},
    fill() {},
    stroke() {},
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    setLineDash() {},
    moveTo(x: number, y: number) {
      points.push({ op: 'M', x, y, strokeStyle: String(this.strokeStyle) });
    },
    lineTo(x: number, y: number) {
      points.push({ op: 'L', x, y, strokeStyle: String(this.strokeStyle) });
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, fillStyle: String(this.fillStyle) });
    },
    strokeText() {},
    measureText(text: string) {
      return { width: text.length * 6 };
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, points, texts };
}

const fs = 100;
const n = 1000;
const layout = computeTraceLayout({
  width: 600,
  height: 200,
  groups: [0, 0, 1],
  labelWidth: 60,
  timeAxisHeight: 18,
  bottomPad: 6,
  startSec: 0,
  secondsPerPage: 10,
});

function state(over: Partial<TraceBaseState> = {}): TraceBaseState {
  return {
    channels: [
      { label: 'NEG', data: new Float32Array(n).fill(-50), available: true },
      { label: 'POS', data: new Float32Array(n).fill(50), available: true },
      { label: 'Fp1-A1', data: new Float32Array(n), available: false },
    ],
    sampleRate: fs,
    dataStartSec: 0,
    sensitivityUvPerMm: 10,
    zoom: 1,
    shadings: [],
    marks: [],
    highlight: new Set(),
    dim: new Set(),
    showTimeAxis: true,
    showScaleBar: true,
    ...over,
  };
}

describe('drawTraceBase', () => {
  it('draws negative values ABOVE the baseline and positive below (negative up)', () => {
    const { ctx, points } = recordingContext();
    drawTraceBase(ctx, layout, state(), EEG_THEME_FALLBACK, 1);
    const traced = points.filter((p) => p.strokeStyle === EEG_THEME_FALLBACK.trace && p.x > layout.plotX);
    const neg = traced.filter((p) => Math.abs(p.y - (layout.rowCenters[0] - (50 / 10) * (96 / 25.4))) < 0.01);
    const pos = traced.filter((p) => Math.abs(p.y - (layout.rowCenters[1] + (50 / 10) * (96 / 25.4))) < 0.01);
    expect(neg.length).toBeGreaterThan(100);
    expect(pos.length).toBeGreaterThan(100);
  });

  it('labels channels, marks unavailable ones n/a and prints the calibration bar', () => {
    const { ctx, texts } = recordingContext();
    drawTraceBase(
      ctx,
      layout,
      state({ marks: [{ t: 2, tone: 'hit', label: 'spike' }, { t: 4, t1: 5, tone: 'false', channel: 'POS' }] }),
      EEG_THEME_FALLBACK,
      1,
    );
    const all = texts.map((t) => t.text);
    expect(all).toEqual(expect.arrayContaining(['NEG', 'POS', 'Fp1-A1', 'n/a', '1 s · 100 µV', '00:01', '✓ spike', '✕']));
    expect(texts.find((t) => t.text === 'Fp1-A1')!.fillStyle).toBe(EEG_THEME_FALLBACK.traceDim);
  });

  it('draws raw samples when zoomed in (fewer samples than pixels)', () => {
    const zoomed = computeTraceLayout({ width: 600, height: 200, groups: [0], labelWidth: 60, timeAxisHeight: 18, bottomPad: 6, startSec: 1, secondsPerPage: 1 });
    const { ctx, points } = recordingContext();
    drawTraceBase(ctx, zoomed, state({ channels: [{ label: 'A', data: new Float32Array(n), available: true }] }), EEG_THEME_FALLBACK, 1);
    const traced = points.filter((p) => p.strokeStyle === EEG_THEME_FALLBACK.trace);
    expect(traced.length).toBeGreaterThanOrEqual(101);
    expect(traced.length).toBeLessThanOrEqual(105);
  });
});

describe('caliper overlay', () => {
  it('measures on the caliper channel and prints the readout', () => {
    const sine = new Float32Array(n);
    for (let i = 0; i < n; i++) sine[i] = 40 * Math.sin((2 * Math.PI * 10 * i) / fs);
    const base = { channels: [{ label: 'A', data: sine, available: true }], sampleRate: fs, dataStartSec: 0 };
    const cal = { t0: 1, t1: 1.1, channelIndex: 0 };
    const m = caliperMeasurement(base.channels, cal, fs)!;
    expect(m.dtMs).toBeCloseTo(100, 6);
    expect(m.freqHz).toBeCloseTo(10, 6);
    expect(m.ppUv).toBeGreaterThan(70);
    expect(caliperMeasurement([{ label: 'x', data: sine, available: false }], cal, fs)).toBeNull();
    const { ctx, texts } = recordingContext();
    drawTraceOverlay(ctx, layout, base, { caliper: cal, draft: null, hoverT: 3 }, EEG_THEME_FALLBACK);
    expect(texts[0].text).toMatch(/^Δt 100 ms · 10\.0 Hz · ΔV \d+ µV$/);
  });
});
