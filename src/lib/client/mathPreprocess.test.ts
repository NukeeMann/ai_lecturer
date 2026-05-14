import { describe, expect, it } from 'vitest';

import { preprocessMath } from './mathPreprocess';

describe('preprocessMath', () => {
  it('converts \\(...\\) to inline $...$', () => {
    expect(preprocessMath('\\(x^2\\)')).toBe('$x^2$');
  });

  it('converts \\[...\\] to block $$\\n...\\n$$', () => {
    expect(preprocessMath('\\[\\sum_i x_i\\]')).toBe('$$\n\\sum_i x_i\n$$');
  });

  it('promotes single-line $$inline$$ to block form', () => {
    expect(preprocessMath('$$a+b$$')).toBe('$$\na+b\n$$');
  });

  it('leaves regular markdown untouched', () => {
    expect(preprocessMath('**hello** world')).toBe('**hello** world');
  });
});
