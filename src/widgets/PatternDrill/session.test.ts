import { describe, expect, it } from 'vitest';

import { PatternDrillDataSchema, describeDrillState, mergeLearned, patternDrillAssetPaths } from './schema';
import { patternDrillSample } from './sample';
import { answerCurrent, hashSeed, interleave, isFinished, seededShuffle, startSession, summarize, topConfusions } from './session';

const items = [
  { id: 'a1', answer: 'A' },
  { id: 'a2', answer: 'A' },
  { id: 'a3', answer: 'A' },
  { id: 'a4', answer: 'A' },
  { id: 'b1', answer: 'B' },
  { id: 'b2', answer: 'B' },
  { id: 'c1', answer: 'C' },
];

describe('ordering', () => {
  it('is deterministic per seed and a permutation', () => {
    const x = seededShuffle(items, 7).map((i) => i.id);
    expect(seededShuffle(items, 7).map((i) => i.id)).toEqual(x);
    expect([...x].sort()).toEqual(items.map((i) => i.id).sort());
    expect(hashSeed('sec-1')).toBe(hashSeed('sec-1'));
    expect(hashSeed('sec-1')).not.toBe(hashSeed('sec-2'));
  });
  it('interleaves so no category runs more than twice when avoidable', () => {
    const out = interleave(items);
    let run = 1;
    for (let i = 1; i < out.length; i++) {
      run = out[i].answer === out[i - 1].answer ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(2);
    }
  });
  it('respects length and onlyIds', () => {
    expect(startSession(items, { seed: 1, length: 3 }).queue).toHaveLength(3);
    expect(startSession(items, { seed: 1, onlyIds: ['b1', 'c1'] }).queue.sort()).toEqual(['b1', 'c1']);
  });
});

describe('answering', () => {
  it('re-queues a miss 3–5 cards later and finishes after correct answers', () => {
    let s = startSession(items, { seed: 3, interleave: false });
    const first = s.queue[0];
    const wrong = items.find((i) => i.id === first)!.answer === 'A' ? 'B' : 'A';
    s = answerCurrent(s, items, wrong, 900);
    const pos = s.queue.indexOf(first);
    expect(pos).toBeGreaterThanOrEqual(2);
    expect(pos).toBeLessThanOrEqual(4);
    expect(s.pendingRequeue).toEqual([first]);
    let guard = 0;
    while (!isFinished(s) && guard++ < 50) {
      const id = s.queue[0];
      s = answerCurrent(s, items, items.find((i) => i.id === id)!.answer, 500);
    }
    expect(isFinished(s)).toBe(true);
    const sum = summarize(s, items);
    expect(sum.total).toBe(items.length);
    expect(sum.firstAttemptCorrect).toBe(items.length - 1);
    expect(sum.missedIds).toEqual([first]);
    expect(sum.confusion[items.find((i) => i.id === first)!.answer][wrong]).toBe(1);
    expect(sum.medianRtMs).toBe(500);
    expect(topConfusions(sum)[0]).toMatchObject({ chosen: wrong, count: 1 });
  });
  it('does not re-queue when disabled', () => {
    const s0 = startSession(items, { seed: 3 });
    const s1 = answerCurrent(s0, items, 'Z', 100, false);
    expect(s1.queue).toHaveLength(items.length - 1);
  });
});

describe('PatternDrillDataSchema', () => {
  it('parses the sample', () => {
    const d = PatternDrillDataSchema.parse(patternDrillSample);
    expect(d.session).toEqual({ interleave: true, requeueMissed: true, showCriteriaChecklist: true });
    expect(d.passThreshold).toBe(0.8);
    expect(patternDrillAssetPaths(d)).toHaveLength(2);
  });
  it('rejects unknown answer categories, bad contrasts and duplicate ids', () => {
    const bad = (patch: object) => PatternDrillDataSchema.safeParse({ ...patternDrillSample, ...patch }).success;
    const it0 = patternDrillSample.items[0];
    expect(bad({ items: [{ ...it0, answer: 'nope' }] })).toBe(false);
    expect(bad({ items: [{ ...it0, contrastItemId: 'ghost' }] })).toBe(false);
    expect(bad({ items: [{ ...it0, contrastItemId: undefined }, { ...it0, contrastItemId: undefined }] })).toBe(false);
    expect(bad({ categories: [{ id: 'x', label: 'x' }] })).toBe(false);
    expect(bad({ criteriaLabels: ['a'] })).toBe(false);
  });
  it('merges learned ids and describes state without leaking the answer', () => {
    expect(mergeLearned(['a'], ['a', 'b'])).toEqual(['a', 'b']);
    const t = describeDrillState({ cardIndex: 1, remaining: 3, figureAlt: 'x', attribution: 'AES', answered: null, learned: 0, total: 2 });
    expect(t).toMatch(/do not reveal/);
  });
});
