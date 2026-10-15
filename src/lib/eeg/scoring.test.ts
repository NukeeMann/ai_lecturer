import { describe, expect, it } from 'vitest';

import {
  channelMatchesTarget,
  clampRect,
  electrodesOfLabel,
  pointInRect,
  rectCenter,
  rectFromPoints,
  rectIoU,
  scoreFigureMarks,
  scoreTimeMarks,
  type FigureMarkShape,
  type TimeTarget,
} from './scoring';

const T = (id: string, onsetSec: number, extra: Partial<TimeTarget> = {}): TimeTarget => ({ id, onsetSec, ...extra });

describe('scoreTimeMarks — points', () => {
  it('hits within tolerance (inclusive) and misses beyond', () => {
    const targets = [T('a', 2), T('b', 5)];
    const r = scoreTimeMarks([{ t: 2.5 }, { t: 5.5001 }], targets, 0.5);
    expect(r.targets.map((t) => t.hit)).toEqual([true, false]);
    expect(r.targets[0].distanceSec).toBeCloseTo(0.5, 9);
    expect(r.falseMarks).toEqual([1]);
    expect(r.marks[1].reason).toBe('noTarget');
    expect(r.hits).toBe(1);
    expect(r.misses).toBe(1);
    expect(r.precision).toBe(0.5);
    expect(r.recall).toBe(0.5);
    expect(r.allRequiredHit).toBe(false);
  });

  it('counts duplicate marks on one target once', () => {
    const r = scoreTimeMarks([{ t: 2.1 }, { t: 1.95 }, { t: 2.3 }], [T('a', 2)], 0.5);
    expect(r.targets[0].markIndex).toBe(1); // the closest
    expect(r.hits).toBe(1);
    expect(r.falseMarks).toEqual([0, 2]);
    expect(r.marks.filter((m) => m.reason === 'duplicate')).toHaveLength(2);
    expect(r.precision).toBeCloseTo(1 / 3, 9);
    expect(r.allRequiredHit).toBe(true);
  });

  it('assigns marks one-to-one across overlapping targets (best pairs first)', () => {
    // Targets 0.6 s apart with tolerance 0.5: both marks are eligible for both.
    const targets = [T('a', 2.0), T('b', 2.6)];
    const r = scoreTimeMarks([{ t: 2.55 }, { t: 2.05 }], targets, 0.5);
    expect(r.targets.map((t) => t.markIndex)).toEqual([1, 0]);
    expect(r.allRequiredHit).toBe(true);
    // A single mark between them satisfies only the nearer target.
    const one = scoreTimeMarks([{ t: 2.35 }], targets, 0.5);
    expect(one.targets.map((t) => t.hit)).toEqual([false, true]);
  });

  it('treats interval targets as hit anywhere inside (± tolerance)', () => {
    const r = scoreTimeMarks([{ t: 15 }, { t: 21.4 }], [T('seizure', 12, { offsetSec: 20 }), T('x', 21)], 0.5);
    expect(r.targets[0]).toMatchObject({ hit: true, distanceSec: 0 });
    expect(r.targets[1].hit).toBe(true);
  });

  it('handles empty inputs', () => {
    expect(scoreTimeMarks([], [], 0.5)).toMatchObject({ hits: 0, precision: 1, recall: 1, allRequiredHit: true, falseMarks: [] });
    expect(scoreTimeMarks([], [T('a', 1)], 0.5)).toMatchObject({ precision: 0, recall: 0, allRequiredHit: false });
    expect(scoreTimeMarks([{ t: 1 }], [], 0.5)).toMatchObject({ precision: 0, recall: 1, falseMarks: [0] });
  });

  it('ignores optional targets for allRequiredHit', () => {
    const r = scoreTimeMarks([{ t: 1 }], [T('a', 1), T('b', 4, { required: false })], 0.5);
    expect(r.allRequiredHit).toBe(true);
    expect(r.targets[1]).toMatchObject({ hit: false, required: false });
  });
});

describe('scoreTimeMarks — ranges', () => {
  it('hits when the range overlaps the widened target', () => {
    const targets = [T('a', 3), T('sz', 10, { offsetSec: 14 })];
    const r = scoreTimeMarks([{ t0: 3.3, t1: 4 }, { t0: 15, t1: 13 }], targets, 0.2);
    expect(r.targets.map((t) => t.hit)).toEqual([false, true]); // 3.3 > 3 + 0.2
    const r2 = scoreTimeMarks([{ t0: 3.2, t1: 4 }], targets, 0.2);
    expect(r2.targets[0].hit).toBe(true);
  });

  it('prefers the overlapping target over a merely nearby one', () => {
    const r = scoreTimeMarks([{ t0: 5, t1: 6 }], [T('near', 4.8), T('inside', 5.5)], 0.5);
    expect(r.targets.find((t) => t.id === 'inside')!.hit).toBe(true);
  });
});

describe('scoreTimeMarks — channels', () => {
  const targets = [T('spike', 4, { channels: ['F8', 'T8'] })];

  it('ignores channels unless requireChannel is set', () => {
    expect(scoreTimeMarks([{ t: 4, channel: 'O1-AVG' }], targets, 0.5).hits).toBe(1);
  });

  it('requires a channel involving a target electrode', () => {
    const ok = scoreTimeMarks([{ t: 4, channel: 'F8-T8' }], targets, 0.5, { requireChannel: true });
    expect(ok.hits).toBe(1);
    const avg = scoreTimeMarks([{ t: 4, channel: 'T8-AVG' }], targets, 0.5, { requireChannel: true });
    expect(avg.hits).toBe(1);
    const wrong = scoreTimeMarks([{ t: 4, channel: 'Fp1-F7' }], targets, 0.5, { requireChannel: true });
    expect(wrong.hits).toBe(0);
    expect(wrong.marks[0].reason).toBe('wrongChannel');
    const none = scoreTimeMarks([{ t: 4 }], targets, 0.5, { requireChannel: true });
    expect(none.marks[0].reason).toBe('wrongChannel');
  });

  it('accepts targets without channels on any channel and custom matchers', () => {
    expect(scoreTimeMarks([{ t: 1, channel: 'Fp1-F7' }], [T('a', 1)], 0.5, { requireChannel: true }).hits).toBe(1);
    const strict = scoreTimeMarks([{ t: 4, channel: 'F8-T8' }], targets, 0.5, {
      requireChannel: true,
      channelMatches: (c, ts) => ts.includes(c),
    });
    expect(strict.hits).toBe(0);
  });

  it('matches labels by shared electrodes, old names included', () => {
    expect(electrodesOfLabel('T7-AVG')).toEqual(['T7']);
    expect(electrodesOfLabel('T3-T5')).toEqual(['T7', 'P7']);
    expect(electrodesOfLabel('Cz-A1A2')).toEqual(['Cz']);
    expect(channelMatchesTarget('F7-T7', ['T3'])).toBe(true);
    expect(channelMatchesTarget('fp2-f8', ['Fp2-F8'])).toBe(true);
    expect(channelMatchesTarget('Fp1-F3', ['T7'])).toBe(false);
    expect(channelMatchesTarget('ECG', ['T7'])).toBe(false);
  });
});

describe('figure geometry', () => {
  it('computes IoU, centres and point-in-rect', () => {
    const a = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(rectIoU(a, a)).toBe(1);
    expect(rectIoU(a, { x: 0.6, y: 0.6, w: 0.1, h: 0.1 })).toBe(0);
    expect(rectIoU(a, { x: 0.25, y: 0, w: 0.5, h: 0.5 })).toBeCloseTo(1 / 3, 9);
    expect(rectIoU({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 })).toBe(0);
    expect(rectCenter(a)).toEqual({ x: 0.25, y: 0.25 });
    expect(pointInRect({ x: 0.5, y: 0.5 }, a)).toBe(true); // border inclusive
    expect(pointInRect({ x: 0.52, y: 0.2 }, a)).toBe(false);
    expect(pointInRect({ x: 0.52, y: 0.2 }, a, 0.03)).toBe(true);
  });

  it('builds and clamps rectangles from drags', () => {
    expect(rectFromPoints({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, w: 0.6000000000000001, h: 0.8 });
    expect(rectFromPoints({ x: -0.2, y: 0.5 }, { x: 1.4, y: 0.6 })).toMatchObject({ x: 0, w: 1 });
    expect(clampRect({ x: 0.9, y: -0.1, w: 0.3, h: 0.2 })).toEqual({ x: 0.7, y: 0, w: 0.3, h: 0.2 });
  });
});

describe('scoreFigureMarks', () => {
  const targets = [
    { id: 's1', rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.2 }, label: 'spike 1' },
    { id: 's2', rect: { x: 0.5, y: 0.1, w: 0.1, h: 0.2 }, label: 'spike 2' },
  ];
  const distractors = [{ rect: { x: 0.8, y: 0.0, w: 0.15, h: 0.3 }, note: 'Eye blink, not a spike' }];
  const P = (x: number, y: number): FigureMarkShape => ({ kind: 'point', x, y });
  const B = (x: number, y: number, w: number, h: number): FigureMarkShape => ({ kind: 'box', x, y, w, h });

  it('scores points: hits, misses, distractor feedback', () => {
    const r = scoreFigureMarks([P(0.15, 0.2), P(0.85, 0.1), P(0.4, 0.9)], targets, { mode: 'point', distractors });
    expect(r.targets.map((t) => t.hit)).toEqual([true, false]);
    expect(r.distractorHits).toEqual([{ markIndex: 1, distractorIndex: 0, note: 'Eye blink, not a spike' }]);
    expect(r.marks.map((m) => m.reason)).toEqual(['matched', 'distractor', 'noTarget']);
    expect(r.falseMarks).toEqual([1, 2]);
    expect(r.precision).toBeCloseTo(1 / 3, 9);
    expect(r.recall).toBe(0.5);
  });

  it('counts duplicates once, even if the duplicate also lies in a distractor', () => {
    const overlapping = [{ rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, note: 'overlaps target' }];
    const r = scoreFigureMarks([P(0.12, 0.15), P(0.15, 0.2)], targets, { mode: 'point', distractors: overlapping });
    expect(r.hits).toBe(1);
    expect(r.targets[0].markIndex).toBe(1); // closer to the centre
    expect(r.marks[0].reason).toBe('duplicate');
    expect(r.distractorHits).toEqual([]);
  });

  it('resolves overlapping targets one-to-one by distance to centre', () => {
    const over = [
      { id: 'a', rect: { x: 0, y: 0, w: 0.4, h: 0.4 } },
      { id: 'b', rect: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 } },
    ];
    const one = scoreFigureMarks([P(0.35, 0.35)], over, { mode: 'point' });
    expect(one.targets.map((t) => t.hit)).toEqual([false, true]);
    const two = scoreFigureMarks([P(0.35, 0.35), P(0.3, 0.3)], over, { mode: 'point' });
    expect(two.hits).toBe(2);
  });

  it('applies the point tolerance', () => {
    expect(scoreFigureMarks([P(0.21, 0.2)], targets, { mode: 'point' }).hits).toBe(0);
    expect(scoreFigureMarks([P(0.21, 0.2)], targets, { mode: 'point', pointTolerance: 0.02 }).hits).toBe(1);
  });

  it('scores boxes by IoU or centre-in-rect', () => {
    const exact = scoreFigureMarks([B(0.1, 0.1, 0.1, 0.2)], targets, { mode: 'box' });
    expect(exact.hits).toBe(1);
    // Large box: IoU < 0.3 but centre inside the target.
    const big = B(0.0, 0.0, 0.3, 0.4);
    expect(rectIoU(big as never, targets[0].rect)).toBeLessThan(0.3);
    expect(scoreFigureMarks([big], targets, { mode: 'box' }).hits).toBe(1);
    expect(scoreFigureMarks([big], targets, { mode: 'box', centerInRect: false }).hits).toBe(0);
    // Offset box with IoU ≥ 0.3 but centre outside (equal boxes: IoU < 1/3).
    const shifted = B(0.152, 0.1, 0.1, 0.2);
    expect(rectIoU(shifted as never, targets[0].rect)).toBeGreaterThanOrEqual(0.3);
    expect(scoreFigureMarks([shifted], targets, { mode: 'box', centerInRect: false }).hits).toBe(1);
    expect(scoreFigureMarks([shifted], targets, { mode: 'box', centerInRect: false, boxIoU: 0.9 }).hits).toBe(0);
  });

  it('reduces shapes to the mode (box→centre in point mode, point→centre-in-rect in box mode)', () => {
    expect(scoreFigureMarks([B(0.12, 0.15, 0.04, 0.04)], targets, { mode: 'point' }).hits).toBe(1);
    expect(scoreFigureMarks([P(0.55, 0.2)], targets, { mode: 'box' }).targets[1].hit).toBe(true);
  });

  it('handles empty inputs and optional targets', () => {
    expect(scoreFigureMarks([], [], { mode: 'point' })).toMatchObject({ precision: 1, recall: 1, allRequiredHit: true });
    const opt = scoreFigureMarks([P(0.15, 0.2)], [targets[0], { ...targets[1], required: false }], { mode: 'point' });
    expect(opt.allRequiredHit).toBe(true);
  });
});
