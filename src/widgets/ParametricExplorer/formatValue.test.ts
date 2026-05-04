import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { formatValueOutput } from './formatValue';

describe('formatValueOutput', () => {
  test('returns null for null/empty input', () => {
    expect(formatValueOutput(null)).toBeNull();
    expect(formatValueOutput('')).toBeNull();
  });

  test('formats JSON-encoded numbers as their string representation', () => {
    expect(formatValueOutput('9')).toBe('9');
    expect(formatValueOutput('0')).toBe('0');
    expect(formatValueOutput('-3.14')).toBe('-3.14');
  });

  test('formats JSON-encoded booleans as their string representation', () => {
    expect(formatValueOutput('true')).toBe('true');
    expect(formatValueOutput('false')).toBe('false');
  });

  test('formats JSON-encoded strings as the raw string', () => {
    expect(formatValueOutput('"hello"')).toBe('hello');
  });

  test('renders an em-dash placeholder for JSON null', () => {
    expect(formatValueOutput('null')).toBe('—');
  });

  test('serialises objects/arrays back to JSON', () => {
    expect(formatValueOutput('[1,2,3]')).toBe('[1,2,3]');
    expect(formatValueOutput('{"a":1}')).toBe('{"a":1}');
  });

  test('falls through to the raw string when input is not valid JSON', () => {
    expect(formatValueOutput('not json')).toBe('not json');
  });
});

// Regression for US-086 — the lesson at /courses/pexp-test/lessons/value-mode
// is titled "Value output" but had `outputType: 'plot'`, which suppressed the
// value panel entirely. Lock the configuration in so we don't regress.
describe('pexp-test/value-mode lesson', () => {
  const lessonPath = path.resolve(
    __dirname,
    '../../../courses/pexp-test/lessons/value-mode.json',
  );
  const lesson = JSON.parse(readFileSync(lessonPath, 'utf-8')) as {
    sections: Array<{ type: string; data: { outputType: string; renderCode: string } }>;
  };
  const pexp = lesson.sections.find((s) => s.type === 'parametricExplorer');

  test('declares a parametricExplorer section', () => {
    expect(pexp).toBeDefined();
  });

  test('runs in value-output mode so the computed number renders', () => {
    expect(pexp?.data.outputType).toBe('value');
  });

  test('assigns a numeric expression to the `result` variable', () => {
    expect(pexp?.data.renderCode).toMatch(/result\s*=/);
  });
});
