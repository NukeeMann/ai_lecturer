import { describe, expect, it } from 'vitest';

import { SttDemoDataSchema } from './schema';

describe('SttDemoDataSchema', () => {
  it('parses an empty object and applies defaults (US-159)', () => {
    const parsed = SttDemoDataSchema.parse({});
    expect(parsed.maxDurationSeconds).toBe(10);
    expect(parsed.prompt).toBeUndefined();
  });

  it('parses with custom maxDurationSeconds and prompt', () => {
    const parsed = SttDemoDataSchema.parse({
      maxDurationSeconds: 30,
      prompt: 'Say something.',
    });
    expect(parsed.maxDurationSeconds).toBe(30);
    expect(parsed.prompt).toBe('Say something.');
  });

  it('rejects maxDurationSeconds < 1', () => {
    expect(() => SttDemoDataSchema.parse({ maxDurationSeconds: 0 })).toThrow();
  });

  it('rejects maxDurationSeconds > 60', () => {
    expect(() => SttDemoDataSchema.parse({ maxDurationSeconds: 61 })).toThrow();
  });

  it('rejects non-integer maxDurationSeconds', () => {
    expect(() =>
      SttDemoDataSchema.parse({ maxDurationSeconds: 5.5 }),
    ).toThrow();
  });

  it('rejects prompt longer than 500 chars', () => {
    expect(() =>
      SttDemoDataSchema.parse({ prompt: 'a'.repeat(501) }),
    ).toThrow();
  });
});
