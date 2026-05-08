import { describe, expect, it } from 'vitest';
import diffWords, { type DiffPart } from './sectionDiff';

function reconstructOld(parts: DiffPart[]): string {
  return parts
    .filter((p) => p.type === 'same' || p.type === 'removed')
    .map((p) => p.text)
    .join('');
}

function reconstructNew(parts: DiffPart[]): string {
  return parts
    .filter((p) => p.type === 'same' || p.type === 'added')
    .map((p) => p.text)
    .join('');
}

describe('diffWords', () => {
  it('returns empty array for two empty strings', () => {
    expect(diffWords('', '')).toEqual([]);
  });

  it('returns a single same part for identical strings', () => {
    const out = diffWords('hello world', 'hello world');
    expect(out).toEqual([{ type: 'same', text: 'hello world' }]);
  });

  it('marks the entire new string added when old is empty', () => {
    const out = diffWords('', 'brand new content');
    expect(out).toEqual([{ type: 'added', text: 'brand new content' }]);
  });

  it('marks the entire old string removed when new is empty', () => {
    const out = diffWords('old content here', '');
    expect(out).toEqual([{ type: 'removed', text: 'old content here' }]);
  });

  it('detects a pure addition appended to existing text', () => {
    const out = diffWords('alpha beta', 'alpha beta gamma delta');
    expect(reconstructOld(out)).toBe('alpha beta');
    expect(reconstructNew(out)).toBe('alpha beta gamma delta');
    expect(out.some((p) => p.type === 'added' && p.text.includes('gamma'))).toBe(
      true,
    );
    expect(out.every((p) => p.type !== 'removed')).toBe(true);
  });

  it('detects a pure removal', () => {
    const out = diffWords('one two three four', 'one four');
    expect(reconstructOld(out)).toBe('one two three four');
    expect(reconstructNew(out)).toBe('one four');
    expect(out.some((p) => p.type === 'removed')).toBe(true);
    expect(out.every((p) => p.type !== 'added')).toBe(true);
  });

  it('detects mixed additions and removals', () => {
    const out = diffWords(
      'the quick brown fox jumps',
      'the lazy brown dog jumps',
    );
    expect(reconstructOld(out)).toBe('the quick brown fox jumps');
    expect(reconstructNew(out)).toBe('the lazy brown dog jumps');
    expect(out.some((p) => p.type === 'added' && p.text.includes('lazy'))).toBe(
      true,
    );
    expect(out.some((p) => p.type === 'added' && p.text.includes('dog'))).toBe(
      true,
    );
    expect(out.some((p) => p.type === 'removed' && p.text.includes('quick'))).toBe(
      true,
    );
    expect(out.some((p) => p.type === 'removed' && p.text.includes('fox'))).toBe(
      true,
    );
  });

  it('preserves multi-line whitespace in same parts', () => {
    const oldText = 'line one\nline two\nline three';
    const newText = 'line one\nline two\nline three\nline four';
    const out = diffWords(oldText, newText);
    expect(reconstructOld(out)).toBe(oldText);
    expect(reconstructNew(out)).toBe(newText);
    const addedText = out
      .filter((p) => p.type === 'added')
      .map((p) => p.text)
      .join('');
    expect(addedText).toContain('line four');
  });

  it('coalesces consecutive same-type parts into a single entry', () => {
    const out = diffWords('a b c d', 'a b c d');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ type: 'same', text: 'a b c d' });
  });

  it('handles a sentence-level addition by marking the new sentence as added', () => {
    const oldText = 'First sentence. Second sentence.';
    const newText =
      'First sentence. New sentence inserted. Second sentence.';
    const out = diffWords(oldText, newText);
    expect(reconstructOld(out)).toBe(oldText);
    expect(reconstructNew(out)).toBe(newText);
    const addedText = out
      .filter((p) => p.type === 'added')
      .map((p) => p.text)
      .join('');
    expect(addedText).toContain('New sentence inserted');
  });
});
