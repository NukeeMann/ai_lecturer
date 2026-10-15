import { describe, expect, it } from 'vitest';

import { EegFigureMarkDataSchema, EegFigureMarkStateSchema, describeFigureMarkState, eegFigureMarkAssetPaths } from './schema';
import { eegFigureMarkSample } from './sample';

describe('EegFigureMarkDataSchema', () => {
  it('parses the sample and reports the figure as an asset', () => {
    const d = EegFigureMarkDataSchema.parse(eegFigureMarkSample);
    expect(d.revealKey).toBe(true);
    expect(eegFigureMarkAssetPaths(d)).toEqual(['/api/courses/eeg-widgets-test/assets/figures/aes-fig84.png']);
  });
  it('requires attribution, targets inside the image and unique ids', () => {
    const noAttr = { ...eegFigureMarkSample, figure: { ...eegFigureMarkSample.figure, attribution: undefined } };
    expect(EegFigureMarkDataSchema.safeParse(noAttr).success).toBe(false);
    const outside = { ...eegFigureMarkSample, targets: [{ id: 'a', rect: { x: 0.9, y: 0.1, w: 0.2, h: 0.1 }, label: 'x' }] };
    expect(EegFigureMarkDataSchema.safeParse(outside).success).toBe(false);
    const dup = { ...eegFigureMarkSample, targets: [eegFigureMarkSample.targets[0], eegFigureMarkSample.targets[0]] };
    expect(EegFigureMarkDataSchema.safeParse(dup).success).toBe(false);
    expect(EegFigureMarkDataSchema.safeParse({ ...eegFigureMarkSample, targets: [] }).success).toBe(false);
  });
  it('validates persisted state', () => {
    expect(EegFigureMarkStateSchema.safeParse({ v: 1, marks: [{ kind: 'point', x: 0.3, y: 0.4 }], checked: false }).success).toBe(true);
    expect(EegFigureMarkStateSchema.safeParse({ marks: [], checked: false }).success).toBe(false);
  });
  it('describes the state without leaking the key before Check', () => {
    const before = describeFigureMarkState({ prompt: 'p', figureAlt: 'a', attribution: 'AES', marks: 2, checked: false });
    expect(before).toMatch(/do not reveal/);
    const after = describeFigureMarkState({
      prompt: 'p',
      figureAlt: 'a',
      attribution: 'AES',
      marks: 2,
      checked: true,
      feedback: { found: ['blink'], missed: [], falseCount: 1, distractorNotes: ['eye flutter'] },
    });
    expect(after).toMatch(/found: blink/);
    expect(after).toMatch(/Fell for: eye flutter/);
  });
});
