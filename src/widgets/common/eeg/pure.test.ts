// Node tests for the pure parts of the shared EEG UI layer.

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { divergingColor, formatRgba, mixColors, parseCssColor, relativeLuminance, withAlpha } from './color';
import { describeDataError, formatZodIssues } from './dataError';
import {
  AttributionSchema,
  FigureCalibrationSchema,
  FigureMarksSnapshotSchema,
  FigureRefSchema,
  FigureTargetSchema,
  NormRectSchema,
  uniqueIdIssues,
} from './figure';
import { buildFigureOverlay, EMPTY_FIGURE_MARKS, figureMarksReducer, marksForStorage, scoreMarks } from './figureMarks';
import {
  clampView,
  figureCaliperReadout,
  formatCaliper,
  normToScreen,
  panBy,
  rowLabelAt,
  screenToNorm,
  viewRect,
  zoomAt,
} from './figureMath';
import {
  buildProgressPatch,
  createProgressSaver,
  parseWidgetState,
  saveWidgetProgress,
  WIDGET_STATE_MAX_CHARS,
} from './progress';
import {
  computeTraceLayout,
  defaultTraceHeight,
  estimateLabelWidth,
  gridLines,
  timeLabelStep,
  timeToX,
  xToTime,
  yToChannel,
} from './traceLayout';

describe('color', () => {
  it('parses hex and rgb() forms', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor('#2563eb')).toEqual({ r: 37, g: 99, b: 235, a: 1 });
    expect(parseCssColor('#00000080')!.a).toBeCloseTo(0.502, 3);
    expect(parseCssColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseCssColor('rgba(1,2,3,0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseCssColor('rgb(10 20 30 / 25%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
    expect(parseCssColor('transparent')!.a).toBe(0);
    expect(parseCssColor('oklch(0.7 0.1 200)')).toBeNull();
    expect(parseCssColor('#12')).toBeNull();
  });

  it('formats, applies alpha and mixes', () => {
    expect(formatRgba({ r: 1.4, g: 2, b: 3, a: 1 })).toBe('rgb(1, 2, 3)');
    expect(withAlpha('#000000', 0.5)).toBe('rgba(0, 0, 0, 0.5)');
    expect(withAlpha('oklch(1 0 0)', 0.5)).toBe('oklch(1 0 0)');
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)');
    expect(mixColors('bad', '#ffffff', 0.2)).toBe('bad');
  });

  it('computes luminance and a diverging palette', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
    expect(relativeLuminance('#000')).toBe(0);
    const pal = { negative: '#0000ff', neutral: '#ffffff', positive: '#ff0000' };
    expect(divergingColor(-10, 10, pal)).toBe('rgb(0, 0, 255)');
    expect(divergingColor(10, 10, pal)).toBe('rgb(255, 0, 0)');
    expect(divergingColor(0, 10, pal)).toBe('rgb(255, 255, 255)');
    expect(divergingColor(5, 0, pal)).toBe('#ffffff');
  });
});

describe('figure schemas', () => {
  const figure = {
    src: '/api/courses/x/assets/figures/fig84.png',
    alt: 'Lateral rectus spikes',
    attribution: { text: 'AES 2016, Fig. 84', license: 'CC BY-NC-SA 4.0', url: 'https://www.ncbi.nlm.nih.gov/books/NBK390354/' },
  };

  it('accepts a minimal figure and rejects a missing attribution', () => {
    expect(FigureRefSchema.parse(figure).attribution.restricted).toBeUndefined();
    expect(FigureRefSchema.safeParse({ ...figure, attribution: undefined }).success).toBe(false);
    expect(AttributionSchema.safeParse({ text: 'x', license: 'y', url: 'not a url' }).success).toBe(false);
  });

  it('keeps rectangles inside the unit square', () => {
    expect(NormRectSchema.safeParse({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }).success).toBe(true);
    expect(NormRectSchema.safeParse({ x: 0.6, y: 0.5, w: 0.5, h: 0.2 }).success).toBe(false);
    expect(NormRectSchema.safeParse({ x: 0.1, y: 0.1, w: 0, h: 0.2 }).success).toBe(false);
    expect(FigureTargetSchema.safeParse({ id: 't', rect: { x: 0, y: 0, w: 1, h: 1 }, label: 'all' }).success).toBe(true);
  });

  it('validates calibration and persisted marks', () => {
    expect(FigureCalibrationSchema.safeParse({ pxPerSecond: 120, rows: [{ label: 'Fp1-F7', yPx: 40 }] }).success).toBe(true);
    expect(FigureCalibrationSchema.safeParse({ pxPerSecond: 0 }).success).toBe(false);
    expect(FigureMarksSnapshotSchema.safeParse({ marks: [{ kind: 'point', x: 0.2, y: 0.3 }], checked: false }).success).toBe(true);
    expect(FigureMarksSnapshotSchema.safeParse({ marks: [{ kind: 'blob' }], checked: false }).success).toBe(false);
  });

  it('reports duplicate ids for superRefine', () => {
    const schema = z.array(z.object({ id: z.string() })).superRefine((items, ctx) => {
      for (const issue of uniqueIdIssues(items, [])) ctx.addIssue(issue);
    });
    const r = schema.safeParse([{ id: 'a' }, { id: 'b' }, { id: 'a' }]);
    expect(r.success).toBe(false);
    if (!r.success) expect(formatZodIssues(r.error)).toEqual(['2.id: Duplicate id "a"']);
  });
});

describe('dataError', () => {
  it('formats zod issues with paths and limits', () => {
    const r = z.object({ a: z.string(), b: z.number() }).safeParse({});
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(formatZodIssues(r.error)).toEqual(['a: Required', 'b: Required']);
    expect(formatZodIssues(r.error, 1)).toEqual(['a: Required', '…and 1 more']);
    expect(describeDataError(r.error)).toHaveLength(2);
    expect(describeDataError(new Error('boom'))).toEqual(['boom']);
    expect(describeDataError('plain')).toEqual(['plain']);
  });
});

describe('traceLayout', () => {
  const groups = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
  const l = computeTraceLayout({
    width: 700,
    height: 400,
    groups,
    labelWidth: 60,
    timeAxisHeight: 18,
    bottomPad: 6,
    startSec: 10,
    secondsPerPage: 10,
  });

  it('spaces rows with gaps between chains', () => {
    expect(l.rowCenters).toHaveLength(18);
    const d1 = l.rowCenters[1] - l.rowCenters[0];
    const dBreak = l.rowCenters[4] - l.rowCenters[3];
    expect(d1).toBeCloseTo(l.spacing, 9);
    expect(dBreak).toBeCloseTo(l.spacing * 1.6, 9);
    expect(l.rowCenters[17] + l.spacing / 2).toBeCloseTo(l.plotY + l.plotH, 6);
    expect(l.plotX).toBe(60);
    expect(l.pxPerSec).toBeCloseTo((700 - 60 - 4) / 10, 9);
  });

  it('maps time ↔ x and y → channel', () => {
    expect(timeToX(l, 10)).toBe(60);
    expect(xToTime(l, timeToX(l, 13.7))).toBeCloseTo(13.7, 9);
    expect(yToChannel(l, l.rowCenters[5] + 1)).toBe(5);
    expect(yToChannel(l, -50)).toBeNull();
  });

  it('builds the grid: 1 s lines, strong every 5 s, minor 0.2 s when zoomed', () => {
    const g = gridLines(l);
    expect(g.map((x) => x.t)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(g.filter((x) => x.kind === 'strong').map((x) => x.t)).toEqual([10, 15, 20]);
    const zoomed = computeTraceLayout({ ...l, groups, labelWidth: 60, timeAxisHeight: 18, bottomPad: 6, secondsPerPage: 2, startSec: 0.1 });
    const gz = gridLines(zoomed);
    expect(gz.some((x) => x.kind === 'minor')).toBe(true);
    expect(gz[0].t).toBeCloseTo(0.2, 9);
  });

  it('chooses label steps, label widths and default heights', () => {
    expect(timeLabelStep(64)).toBe(1);
    expect(timeLabelStep(20)).toBe(5);
    expect(estimateLabelWidth(['Fp1-F7', 'Cz-A1A2'])).toBeGreaterThanOrEqual(40);
    expect(defaultTraceHeight(18, 4)).toBeGreaterThanOrEqual(320);
    expect(defaultTraceHeight(4)).toBe(320);
  });
});

describe('figureMath', () => {
  const W = 600;
  const H = 300;

  it('zooms around a point and keeps it fixed', () => {
    const v = zoomAt({ scale: 1, tx: 0, ty: 0 }, 2, 150, 75, W, H);
    expect(v.scale).toBe(2);
    const before = screenToNorm({ scale: 1, tx: 0, ty: 0 }, 150, 75, W, H);
    const after = screenToNorm(v, 150, 75, W, H);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('clamps scale and offsets so the image covers the viewport', () => {
    expect(clampView({ scale: 0.5, tx: 10, ty: 10 }, W, H)).toEqual({ scale: 1, tx: 0, ty: 0 });
    expect(clampView({ scale: 20, tx: 0, ty: 0 }, W, H, 8).scale).toBe(8);
    const panned = panBy({ scale: 2, tx: 0, ty: 0 }, -10_000, -10_000, W, H);
    expect(panned).toEqual({ scale: 2, tx: -600, ty: -300 });
  });

  it('round-trips normalised ↔ screen and reports the visible rect', () => {
    const v = { scale: 2, tx: -100, ty: -50 };
    const s = normToScreen(v, { x: 0.3, y: 0.6 }, W, H);
    const n = screenToNorm(v, s.x, s.y, W, H);
    expect(n.x).toBeCloseTo(0.3, 9);
    expect(n.y).toBeCloseTo(0.6, 9);
    const r = viewRect(v, W, H);
    expect(r.x).toBeCloseTo(100 / 1200, 9);
    expect(r.w).toBe(0.5);
  });

  it('reads a calibrated caliper', () => {
    const cal = { pxPerSecond: 100, uvPerPx: 2, rows: [{ label: 'Fp1-F7', yPx: 50 }, { label: 'F7-T7', yPx: 100 }] };
    const r = figureCaliperReadout({ x: 0.1, y: 0.1 }, { x: 0.15, y: 0.2 }, { width: 1000, height: 500 }, cal);
    expect(r.dtMs).toBeCloseTo(500, 9);
    expect(r.freqHz).toBeCloseTo(2, 9);
    expect(r.dvUv).toBeCloseTo(100, 9);
    expect(r.rowLabel).toBe('Fp1-F7');
    expect(rowLabelAt(0.9, 500, cal.rows)).toBeNull();
    expect(figureCaliperReadout({ x: 0, y: 0 }, { x: 0, y: 0 }, { width: 10, height: 10 }, { pxPerSecond: 1 }).dvUv).toBeNull();
    expect(formatCaliper({ dtMs: 52.4, freqHz: 19.08, dvUv: 84.4 })).toBe('Δt 52 ms · 19.1 Hz · ΔV 84 µV');
    expect(formatCaliper({ dtMs: 0, freqHz: Infinity })).toBe('Δt 0.0 ms');
  });
});

describe('figureMarks reducer and overlay', () => {
  const cfgPoint = { mode: 'point' as const, maxMarks: 2 };
  const cfgBox = { mode: 'box' as const };
  const targets = [
    { id: 'a', rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, label: '**Spike** F8' },
    { id: 'b', rect: { x: 0.6, y: 0.6, w: 0.1, h: 0.1 }, label: 'Spike T8', required: false },
  ];
  const distractors = [{ rect: { x: 0.8, y: 0.0, w: 0.2, h: 0.2 }, note: 'Blink' }];

  it('adds, limits, removes and locks marks', () => {
    let s = figureMarksReducer(EMPTY_FIGURE_MARKS, { type: 'addPoint', p: { x: 0.15, y: 0.15 } }, cfgPoint);
    s = figureMarksReducer(s, { type: 'addBox', rect: { x: 0.8, y: 0.05, w: 0.1, h: 0.1 } }, cfgPoint); // → centre point
    s = figureMarksReducer(s, { type: 'addPoint', p: { x: 0.5, y: 0.5 } }, cfgPoint); // over the limit
    expect(s.marks).toEqual([
      { kind: 'point', x: 0.15, y: 0.15, id: 'm1' },
      { kind: 'point', x: 0.8500000000000001, y: 0.1, id: 'm2' },
    ]);
    s = figureMarksReducer(s, { type: 'remove', id: 'm1' }, cfgPoint);
    expect(s.marks.map((m) => m.id)).toEqual(['m2']);
    s = figureMarksReducer(s, { type: 'check' }, cfgPoint);
    expect(figureMarksReducer(s, { type: 'addPoint', p: { x: 0.1, y: 0.1 } }, cfgPoint)).toBe(s);
    expect(figureMarksReducer(s, { type: 'clear' }, cfgPoint)).toBe(s);
    const r = figureMarksReducer(s, { type: 'reset' }, cfgPoint);
    expect(r).toMatchObject({ marks: [], checked: false });
  });

  it('turns taps into default boxes and rejects degenerate boxes in box mode', () => {
    let s = figureMarksReducer(EMPTY_FIGURE_MARKS, { type: 'addPoint', p: { x: 0.99, y: 0.5 } }, cfgBox);
    expect(s.marks[0]).toMatchObject({ kind: 'box', w: 0.05, h: 0.07 });
    expect(s.marks[0].kind === 'box' && s.marks[0].x + s.marks[0].w).toBeLessThanOrEqual(1);
    s = figureMarksReducer(s, { type: 'addBox', rect: { x: 0.2, y: 0.2, w: 0.001, h: 0.3 } }, cfgBox);
    expect(s.marks[1]).toMatchObject({ kind: 'box', w: 0.05 }); // degenerate → tap box
  });

  it('restores persisted marks and serialises them back', () => {
    const s = figureMarksReducer(
      EMPTY_FIGURE_MARKS,
      { type: 'restore', marks: [{ kind: 'point', x: 0.15, y: 0.15 }, { kind: 'point', x: 2, y: -1 }], checked: true },
      cfgPoint,
    );
    expect(s.checked).toBe(true);
    expect(s.marks[1]).toMatchObject({ x: 1, y: 0 });
    expect(marksForStorage(s.marks)).toEqual([{ kind: 'point', x: 0.15, y: 0.15 }, { kind: 'point', x: 1, y: 0 }]);
    expect(figureMarksReducer(EMPTY_FIGURE_MARKS, { type: 'restore', marks: [], checked: true }, cfgPoint).checked).toBe(false);
  });

  it('builds the overlay before and after checking', () => {
    let s = figureMarksReducer(EMPTY_FIGURE_MARKS, { type: 'addPoint', p: { x: 0.15, y: 0.15 } }, { mode: 'point' });
    s = figureMarksReducer(s, { type: 'addPoint', p: { x: 0.9, y: 0.1 } }, { mode: 'point' });
    const input = { mode: 'point' as const, targets, distractors };
    expect(buildFigureOverlay(s, input, null).map((i) => (i.kind === 'caliper' ? null : i.tone))).toEqual(['mark', 'mark']);
    s = figureMarksReducer(s, { type: 'check' }, { mode: 'point' });
    const result = scoreMarks(s.marks, input);
    const overlay = buildFigureOverlay(s, input, result, { revealKey: true });
    const tones = Object.fromEntries(overlay.map((i) => [i.id, i.kind === 'caliper' ? null : i.tone]));
    expect(tones).toEqual({ 'target:a': 'key', 'target:b': 'miss', 'distractor:0': 'distractor', m1: 'hit', m2: 'distractor' });
    expect(buildFigureOverlay(s, input, result, { revealKey: false }).some((i) => i.id?.startsWith('target:'))).toBe(false);
  });
});

describe('progress', () => {
  const key = { courseSlug: 'c', lessonSlug: 'l', sectionId: 's' };

  it('builds a full-state PATCH body with sanitised score', () => {
    expect(buildProgressPatch(key, { done: true, widgetState: { v: 1, marks: [] }, score: { correct: 2.4, total: 1 } })).toEqual({
      courseSlug: 'c',
      lessonSlug: 'l',
      sectionState: { s: { done: true, widgetState: { v: 1, marks: [] }, score: { correct: 2, total: 2 } } },
    });
    expect(buildProgressPatch(key, { done: false })).toEqual({ courseSlug: 'c', lessonSlug: 'l', sectionState: { s: { done: false } } });
  });

  it('drops an oversized widgetState but keeps done/score', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const big = { blob: 'x'.repeat(WIDGET_STATE_MAX_CHARS + 10) };
    const body = buildProgressPatch(key, { done: true, widgetState: big }) as { sectionState: Record<string, unknown> };
    expect(body.sectionState.s).toEqual({ done: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('PATCHes /api/progress and never throws; no key → no request', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await saveWidgetProgress(key, { done: true }, { fetchImpl })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/progress');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body)).sectionState.s.done).toBe(true);
    expect(await saveWidgetProgress(undefined, { done: true }, { fetchImpl })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await saveWidgetProgress(key, { done: true }, { fetchImpl: failing })).toBe(false);
    const rejected = vi.fn(async () => new Response('bad', { status: 400 }));
    expect(await saveWidgetProgress(key, { done: true }, { fetchImpl: rejected })).toBe(false);
  });

  it('debounces settings saves (latest wins) and flushes on demand', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const saver = createProgressSaver(800, { fetchImpl });
    saver.save(key, { done: false, widgetState: { v: 1, n: 1 } });
    saver.save(key, { done: false, widgetState: { v: 1, n: 2 } });
    expect(saver.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(799);
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.sectionState.s.widgetState.n).toBe(2);
    saver.save(key, { done: true });
    expect(await saver.flush()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    saver.save(key, { done: true });
    saver.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    saver.save(undefined, { done: true });
    expect(saver.pending).toBe(false);
    vi.useRealTimers();
  });

  it('validates restored widget state', () => {
    const schema = z.object({ v: z.literal(1), marks: z.array(z.number()) });
    expect(parseWidgetState({ v: 1, marks: [1] }, schema)).toEqual({ v: 1, marks: [1] });
    expect(parseWidgetState({ v: 2 }, schema)).toBeNull();
    expect(parseWidgetState(undefined, schema)).toBeNull();
  });
});
