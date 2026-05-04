import { describe, expect, test } from 'vitest';

import {
  commentPrefix,
  findExistingCommentStart,
  formatFeedbackComment,
  groupSegmentsIntoLines,
  lineHasExistingComment,
  type LineSegment,
} from './feedbackComment';

describe('commentPrefix', () => {
  test('python uses #', () => {
    expect(commentPrefix('python')).toBe('#');
    expect(commentPrefix('py')).toBe('#');
  });

  test('javascript / typescript use //', () => {
    expect(commentPrefix('javascript')).toBe('//');
    expect(commentPrefix('typescript')).toBe('//');
    expect(commentPrefix('js')).toBe('//');
    expect(commentPrefix('ts')).toBe('//');
  });

  test('default (undefined / unknown) is # for python-first MVP', () => {
    expect(commentPrefix(undefined)).toBe('#');
    expect(commentPrefix('unknown-lang')).toBe('#');
  });
});

describe('findExistingCommentStart', () => {
  test('finds # at end of plain line', () => {
    expect(findExistingCommentStart('total = 1  # given', '#')).toBe(11);
  });

  test('finds // at end of plain JS line', () => {
    expect(findExistingCommentStart('const x = 1; // given', '//')).toBe(13);
  });

  test('returns null when there is no comment', () => {
    expect(findExistingCommentStart('total = 1', '#')).toBeNull();
    expect(findExistingCommentStart('const x = 1;', '//')).toBeNull();
  });

  test('ignores # inside double-quoted string', () => {
    expect(findExistingCommentStart('print("# not a comment")', '#')).toBeNull();
  });

  test('ignores // inside single-quoted JS string', () => {
    expect(findExistingCommentStart("const u = 'http://example.com';", '//')).toBeNull();
  });

  test('finds # after a string ends', () => {
    expect(
      findExistingCommentStart('print("hello")  # trailing', '#'),
    ).toBe(16);
  });

  test('handles escaped quote inside string', () => {
    expect(
      findExistingCommentStart("print('it\\'s ok')  # done", '#'),
    ).toBe(19);
  });
});

describe('formatFeedbackComment', () => {
  // Bug repro for US-058: error message must render as an inline comment, NOT
  // as a block element below the input. The fix is the helper returning a
  // single-line "  # hint" string that the widget renders inline.
  test('python: formats single hint as "  # hint" when no existing comment', () => {
    expect(formatFeedbackComment(['Use sum'], '#', false)).toBe('  # Use sum');
  });

  test('javascript: formats with // prefix', () => {
    expect(formatFeedbackComment(['Use sum'], '//', false)).toBe('  // Use sum');
  });

  test('appends to existing comment with "; hint" (no extra prefix, preserves syntax)', () => {
    // AC: "When the line already has a comment, the feedback comment is
    // appended after it without breaking syntax highlighting"
    expect(formatFeedbackComment(['Use sum'], '#', true)).toBe('; Use sum');
  });

  test('joins multiple hints with "; "', () => {
    expect(
      formatFeedbackComment(['Hint A', 'Hint B'], '#', false),
    ).toBe('  # Hint A; Hint B');
  });

  test('returns empty string when no hints', () => {
    expect(formatFeedbackComment([], '#', false)).toBe('');
    expect(formatFeedbackComment([], '#', true)).toBe('');
  });

  test('skips empty / whitespace-only hints', () => {
    expect(
      formatFeedbackComment(['', '   ', 'real'], '#', false),
    ).toBe('  # real');
  });

  test('trims whitespace around each hint', () => {
    expect(
      formatFeedbackComment(['  Use sum  '], '#', false),
    ).toBe('  # Use sum');
  });
});

describe('groupSegmentsIntoLines', () => {
  test('splits text segments on newlines, keeping slots on their containing line', () => {
    const segments: LineSegment[] = [
      { kind: 'text', content: 'def f():\n    return ' },
      { kind: 'slot', slotId: 'value' },
      { kind: 'text', content: '\n' },
    ];
    const lines = groupSegmentsIntoLines(segments);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual([{ kind: 'text', content: 'def f():' }]);
    expect(lines[1]).toEqual([
      { kind: 'text', content: '    return ' },
      { kind: 'slot', slotId: 'value' },
    ]);
    expect(lines[2]).toEqual([]);
  });

  test('multiple slots on one line stay together', () => {
    const segments: LineSegment[] = [
      { kind: 'text', content: 'x = ' },
      { kind: 'slot', slotId: 'a' },
      { kind: 'text', content: ' + ' },
      { kind: 'slot', slotId: 'b' },
    ];
    const lines = groupSegmentsIntoLines(segments);
    expect(lines).toHaveLength(1);
    expect(lines[0].filter((s) => s.kind === 'slot')).toHaveLength(2);
  });

  test('empty template returns single empty line', () => {
    expect(groupSegmentsIntoLines([])).toEqual([[]]);
  });
});

describe('lineHasExistingComment', () => {
  test('detects # in line text', () => {
    const segments: LineSegment[] = [
      { kind: 'text', content: 'total = ' },
      { kind: 'slot', slotId: 'aggregator' },
      { kind: 'text', content: '(values)  # given' },
    ];
    expect(lineHasExistingComment(segments, '#')).toBe(true);
  });

  test('returns false when no comment in line', () => {
    const segments: LineSegment[] = [
      { kind: 'text', content: 'total = ' },
      { kind: 'slot', slotId: 'aggregator' },
      { kind: 'text', content: '(values)' },
    ];
    expect(lineHasExistingComment(segments, '#')).toBe(false);
  });

  test('ignores # inside string literal', () => {
    const segments: LineSegment[] = [
      { kind: 'text', content: 'print("# not a comment")' },
    ];
    expect(lineHasExistingComment(segments, '#')).toBe(false);
  });
});
