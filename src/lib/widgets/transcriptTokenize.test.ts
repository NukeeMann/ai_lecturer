import { describe, expect, it } from 'vitest';

import { answersMatch, tokenize } from './transcriptTokenize';

describe('tokenize', () => {
  it('splits a simple sentence into indexed tokens', () => {
    const t = tokenize('The quick brown fox');
    expect(t).toHaveLength(4);
    expect(t.map((x) => x.text)).toEqual(['The', 'quick', 'brown', 'fox']);
    expect(t.map((x) => x.index)).toEqual([0, 1, 2, 3]);
    expect(t.every((x) => !x.isPunctuation)).toBe(true);
  });

  it('strips trailing punctuation but keeps the original raw form', () => {
    const t = tokenize('Hello, world!');
    expect(t).toHaveLength(2);
    expect(t[0].raw).toBe('Hello,');
    expect(t[0].text).toBe('Hello');
    expect(t[1].raw).toBe('world!');
    expect(t[1].text).toBe('world');
  });

  it('treats contractions like "don\'t" as a single token', () => {
    const t = tokenize("I don't know");
    expect(t).toHaveLength(3);
    expect(t[1].text).toBe("don't");
    expect(t[1].isPunctuation).toBe(false);
  });

  it('marks all-punctuation tokens as isPunctuation=true', () => {
    const t = tokenize('hi -- there');
    expect(t).toHaveLength(3);
    expect(t[1].text).toBe('');
    expect(t[1].isPunctuation).toBe(true);
  });

  it('handles multiple whitespace separators (tabs, newlines)', () => {
    const t = tokenize('a\tb\n  c');
    expect(t.map((x) => x.text)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array on empty / whitespace-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   \n\t  ')).toEqual([]);
  });

  it('strips both leading and trailing punctuation', () => {
    const t = tokenize('"hello," he said.');
    expect(t[0].text).toBe('hello');
    expect(t[0].raw).toBe('"hello,"');
    expect(t[2].text).toBe('said');
  });

  it('keeps interior punctuation/numbers (e.g. "U.S.A.", "3.14")', () => {
    const t = tokenize('U.S.A. and 3.14 are tokens');
    expect(t).toHaveLength(5);
    expect(t[0].text).toBe('U.S.A');
    expect(t[2].text).toBe('3.14');
  });
});

describe('answersMatch', () => {
  it('matches case-insensitively', () => {
    expect(answersMatch('Quick', 'quick')).toBe(true);
    expect(answersMatch('OVER', 'over')).toBe(true);
  });

  it('strips surrounding punctuation before comparing', () => {
    expect(answersMatch('quick,', 'quick')).toBe(true);
    expect(answersMatch('"hello,"', 'hello')).toBe(true);
  });

  it('returns false for genuine mismatches', () => {
    expect(answersMatch('quick', 'fast')).toBe(false);
    expect(answersMatch('over', 'under')).toBe(false);
  });

  it('preserves contraction apostrophes (interior is significant)', () => {
    expect(answersMatch("don't", 'dont')).toBe(false);
    expect(answersMatch("don't", "DON'T")).toBe(true);
  });
});
