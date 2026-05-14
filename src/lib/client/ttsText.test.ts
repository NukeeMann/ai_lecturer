import { describe, expect, it } from 'vitest';

import { stripForTts } from './ttsText';

describe('stripForTts', () => {
  it('removes code, image, math; preserves link text and header content', () => {
    const md = [
      '# Heading',
      '',
      'Here is a paragraph with `inline code` and a link to [claude](https://x).',
      '',
      'Inline math like $x^2$ should drop, leaving prose grammatical.',
      '',
      '![alt text](image.png)',
      '',
      '```python',
      'print("ignored")',
      '```',
      '',
      'Bold **survives** and italics _too_.',
    ].join('\n');

    const out = stripForTts(md);
    expect(out).toMatchInlineSnapshot(`
      "Heading

      Here is a paragraph with and a link to claude.

      Inline math like should drop, leaving prose grammatical.

      Bold survives and italics too."
    `);
  });
});
