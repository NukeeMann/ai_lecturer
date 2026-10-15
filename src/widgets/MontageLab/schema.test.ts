import { describe, expect, it } from 'vitest';

import {
  DISPLAY_DEFAULTS,
  generateRecording,
  getMontage,
  peakSampleIndex,
  prepareDisplayChannels,
  type Montage,
  type SimulationSpec,
} from '@/lib/eeg';

import {
  LAB_EVENT_AT_SEC,
  MontageLabDataSchema,
  checkChallenge,
  channelsWithElectrode,
  describeLabState,
  editableSourceIndex,
  focusComponentIndex,
  labSpec,
  scenarioSpec,
  summarizeLocalization,
  withSourceEdit,
} from './schema';
import { montageLabSample } from './sample';

function analyze(spec: SimulationSpec, montageId: string) {
  const { spec: lab, eventSec } = labSpec(spec);
  const rec = generateRecording(lab);
  const montage = getMontage(montageId) as Montage;
  const channels = prepareDisplayChannels(rec, montage, { lffHz: DISPLAY_DEFAULTS.lffHz, hffHz: DISPLAY_DEFAULTS.hffHz, notchHz: null });
  const c = Math.round((eventSec ?? 1) * rec.sampleRate);
  const peak = peakSampleIndex(channels, c - 15, c + 15);
  return { montage, channels, summary: summarizeLocalization(montage, channels, peak) };
}

const preset = (p: string) => scenarioSpec(MontageLabDataSchema.parse({ scenario: { preset: p } }));

describe('MontageLabDataSchema', () => {
  it('parses the sample with defaults', () => {
    const d = MontageLabDataSchema.parse(montageLabSample);
    expect(d.montages).toContain('LB');
    expect(d.editable).toEqual({ moveSource: true, polarity: true, spread: true });
  });
  it('rejects unknown montages, initialMontage outside the list, unknown electrodes and duplicate ids', () => {
    expect(MontageLabDataSchema.safeParse({ scenario: { preset: 'blink' }, montages: ['XYZ'] }).success).toBe(false);
    expect(MontageLabDataSchema.safeParse({ scenario: { preset: 'blink' }, montages: ['LB'], initialMontage: 'AVG' }).success).toBe(false);
    const ch = (id: string, e: string) => ({ id, prompt: 'p', answer: { kind: 'electrode', electrodes: [e] }, explanation: 'e' });
    expect(MontageLabDataSchema.safeParse({ scenario: { preset: 'blink' }, challenges: [ch('a', 'Q9')] }).success).toBe(false);
    expect(MontageLabDataSchema.safeParse({ scenario: { preset: 'blink' }, challenges: [ch('a', 'F8'), ch('a', 'T8')] }).success).toBe(false);
    expect(MontageLabDataSchema.safeParse({ scenario: { preset: 'nope' } }).success).toBe(false);
  });
});

describe('lab epoch', () => {
  it('centres the focus event at 2 s in a 4 s spec', () => {
    const spec = preset('phaseReversalF8');
    const { spec: lab, eventSec } = labSpec(spec);
    expect(eventSec).toBe(LAB_EVENT_AT_SEC);
    expect(lab.durationSec).toBe(4);
    const d = lab.components[focusComponentIndex(lab)] as { times: number[] };
    expect(d.times[0]).toBeCloseTo(2, 6);
    expect(d.times.every((t) => t > 0 && t < 4)).toBe(true);
  });
  it('edits only the first discharge', () => {
    const spec = preset('phaseReversalF8');
    expect(editableSourceIndex(spec)).toBe(0);
    const edited = withSourceEdit(spec, { center: 'T7', polarity: 'positive', spreadDeg: 30 });
    expect(edited.components[0]).toMatchObject({ center: 'T7', polarity: 'positive', spreadDeg: 30 });
    expect(spec.components[0]).toMatchObject({ center: 'F8' });
    const blink = preset('blink');
    expect(editableSourceIndex(blink)).toBe(-1);
    expect(withSourceEdit(blink, { center: 'T7' })).toBe(blink);
  });
});

describe('summarizeLocalization (computed from data)', () => {
  it('finds the negative phase reversal at F8 in LB', () => {
    const { summary, montage } = analyze(preset('phaseReversalF8'), 'LB');
    expect(summary.electrodes).toContain('F8');
    expect(summary.lines.join(' ')).toMatch(/Ujemne odwrócenie fazy/);
    const labels = summary.highlight.map((i) => montage.channels[i].label);
    expect(labels).toEqual(expect.arrayContaining(['Fp2-F8', 'F8-T8']));
  });
  it('reports an end-of-chain maximum at Fp1 without reversal', () => {
    const { summary } = analyze(preset('endOfChainFp1'), 'LB');
    expect(summary.electrodes).toContain('Fp1');
    expect(summary.lines.join(' ')).toMatch(/end of chain/);
  });
  it('uses amplitude (not reversal) in referential montages', () => {
    const { summary } = analyze(preset('phaseReversalF8'), 'AVG');
    expect(summary.electrodes).toEqual(['F8']);
    expect(summary.lines[0]).toMatch(/referencyjny/);
  });
  it('moving the source moves the computed localisation', () => {
    const moved = withSourceEdit(preset('phaseReversalF8'), { center: 'T7' });
    const { summary } = analyze(moved, 'LB');
    expect(summary.electrodes).toContain('T7');
    expect(summary.electrodes).not.toContain('F8');
  });
});

describe('challenges + helpers', () => {
  const ch = MontageLabDataSchema.parse(montageLabSample).challenges[0];
  it('checks electrode answers with alias normalisation', () => {
    expect(checkChallenge(ch, { electrode: 'F8' })).toBe(true);
    expect(checkChallenge(ch, { electrode: 'T8' })).toBe(false);
    expect(checkChallenge(ch, { channel: 'F8-T8' })).toBe(false);
    const old = { ...ch, answer: { kind: 'electrode' as const, electrodes: ['T4'] } };
    expect(checkChallenge(old, { electrode: 'T8' })).toBe(true);
  });
  it('checks channel answers', () => {
    const c = { ...ch, answer: { kind: 'channel' as const, channels: ['F8-T8'] } };
    expect(checkChallenge(c, { channel: 'f8-t8' })).toBe(true);
    expect(checkChallenge(c, { electrode: 'F8' })).toBe(false);
  });
  it('lists channels containing an electrode', () => {
    const lb = getMontage('LB') as Montage;
    expect(channelsWithElectrode(lb, 'F8').map((i) => lb.channels[i].label)).toEqual(['Fp2-F8', 'F8-T8']);
  });
  it('describes the state for the tutor without leaking the key before answering', () => {
    const text = describeLabState({
      scenarioLabel: 'Phase reversal at F8',
      montageLabel: 'Longitudinal bipolar',
      source: { center: 'F8', polarity: 'negative', spreadDeg: 28 },
      summary: { lines: ['**x**'], highlight: [], electrodes: [] },
      challenge: { prompt: 'Where?', answered: false },
      challengesDone: 0,
      challengesTotal: 1,
    });
    expect(text).toMatch(/SYNTHETIC/);
    expect(text).toMatch(/do not reveal/);
    expect(text).not.toMatch(/\*\*/);
  });
});
