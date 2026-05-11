import { describe, expect, it } from 'vitest';

import { TtsDemoDataSchema } from './schema';

describe('TtsDemoDataSchema', () => {
  it('parses an empty object (both fields optional)', () => {
    const parsed = TtsDemoDataSchema.parse({});
    expect(parsed.defaultText).toBeUndefined();
    expect(parsed.placeholderText).toBeUndefined();
  });

  it('parses with defaultText only', () => {
    const parsed = TtsDemoDataSchema.parse({ defaultText: 'Hello world.' });
    expect(parsed.defaultText).toBe('Hello world.');
    expect(parsed.placeholderText).toBeUndefined();
  });

  it('parses with placeholderText only', () => {
    const parsed = TtsDemoDataSchema.parse({ placeholderText: 'Type here…' });
    expect(parsed.placeholderText).toBe('Type here…');
    expect(parsed.defaultText).toBeUndefined();
  });

  it('parses with both fields', () => {
    const parsed = TtsDemoDataSchema.parse({
      defaultText: 'Hi.',
      placeholderText: 'Try a phrase',
    });
    expect(parsed.defaultText).toBe('Hi.');
    expect(parsed.placeholderText).toBe('Try a phrase');
  });

  it('rejects defaultText longer than 2000 chars', () => {
    const long = 'a'.repeat(2001);
    expect(() => TtsDemoDataSchema.parse({ defaultText: long })).toThrow();
  });

  it('accepts defaultText at the 2000-char boundary', () => {
    const long = 'a'.repeat(2000);
    expect(() => TtsDemoDataSchema.parse({ defaultText: long })).not.toThrow();
  });

  it('does not impose a length cap on placeholderText', () => {
    const long = 'p'.repeat(3000);
    expect(() => TtsDemoDataSchema.parse({ placeholderText: long })).not.toThrow();
  });
});
