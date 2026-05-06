import { describe, it, expect } from 'vitest';
import { reverseLogLines, reverseLiveLogLines } from './genLog';

describe('reverseLogLines (US-111)', () => {
  it('returns empty string for empty input', () => {
    expect(reverseLogLines('')).toBe('');
  });

  it('reverses a multi-line string so the last line is first', () => {
    const text = 'first\nsecond\nthird';
    expect(reverseLogLines(text)).toBe('third\nsecond\nfirst');
  });

  it('drops a single trailing newline so the output has no leading blank', () => {
    const text = 'one\ntwo\nthree\n';
    expect(reverseLogLines(text)).toBe('three\ntwo\none');
  });

  it('preserves a single line unchanged', () => {
    expect(reverseLogLines('only-line')).toBe('only-line');
  });

  it('preserves blank lines internal to the log', () => {
    const text = 'a\n\nb\nc';
    expect(reverseLogLines(text)).toBe('c\nb\n\na');
  });
});

describe('reverseLiveLogLines (US-111)', () => {
  it('returns a new array reversed (newest first)', () => {
    const lines = ['l1', 'l2', 'l3'];
    expect(reverseLiveLogLines(lines)).toEqual(['l3', 'l2', 'l1']);
  });

  it('does not mutate the input array', () => {
    const lines = ['a', 'b', 'c'];
    reverseLiveLogLines(lines);
    expect(lines).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for an empty input', () => {
    expect(reverseLiveLogLines([])).toEqual([]);
  });
});
