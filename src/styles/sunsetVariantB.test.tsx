// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// jsdom needs the raw tokens.css injected via <style> for getComputedStyle to
// see the variant-scoped custom properties. Same pattern as scrollbars.test.tsx.
beforeAll(() => {
  const css = readFileSync(
    path.resolve(process.cwd(), 'src/styles/tokens.css'),
    'utf-8',
  );
  const style = document.createElement('style');
  style.dataset.testid = 'tokens-css';
  style.textContent = css;
  document.head.appendChild(style);
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-sunset-variant');
});

function relativeLuminance(hex: string): number {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) throw new Error(`bad hex: ${hex}`);
  const [r, g, b] = m.map((h) => parseInt(h, 16) / 255);
  const tx = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * tx(r) + 0.7152 * tx(g) + 0.0722 * tx(b);
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lo, hi] = la < lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe('US-188 — Sunset variant B "Alpine Glow" tokens', () => {
  it('uses a cool blue-violet --bg and a warm peach --accent (Alpine Glow, not magenta dusk)', () => {
    document.documentElement.setAttribute('data-theme', 'sunset');
    document.documentElement.setAttribute('data-sunset-variant', 'B');

    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue('--bg').trim();
    const accent = styles.getPropertyValue('--accent').trim();
    const text = styles.getPropertyValue('--text').trim();

    // Pin to the literal hex values written into tokens.css so this test guards
    // against future regressions (e.g. someone reverts to the old magenta-on-violet).
    expect(bg).toBe('#1a1f3a');
    expect(accent).toBe('#ff9a76');
    expect(text).toBe('#f5e8dc');
  });

  it('--bg is cool (R < G < B) and --accent is warm (R > B), as Alpine Glow demands', () => {
    document.documentElement.setAttribute('data-theme', 'sunset');
    document.documentElement.setAttribute('data-sunset-variant', 'B');
    const styles = getComputedStyle(document.documentElement);

    const parse = (hex: string) => {
      const m = hex.replace('#', '').match(/.{2}/g)!;
      const [r, g, b] = m.map((h) => parseInt(h, 16));
      return { r, g, b };
    };

    const bg = parse(styles.getPropertyValue('--bg').trim());
    expect(bg.r).toBeLessThan(bg.g);
    expect(bg.g).toBeLessThan(bg.b);

    const accent = parse(styles.getPropertyValue('--accent').trim());
    expect(accent.r).toBeGreaterThan(accent.b);
  });

  it('body text meets WCAG AA (≥ 4.5:1) on both --bg and --bg-elevated', () => {
    document.documentElement.setAttribute('data-theme', 'sunset');
    document.documentElement.setAttribute('data-sunset-variant', 'B');
    const styles = getComputedStyle(document.documentElement);

    const text = styles.getPropertyValue('--text').trim();
    const bg = styles.getPropertyValue('--bg').trim();
    const bgElevated = styles.getPropertyValue('--bg-elevated').trim();

    expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(text, bgElevated)).toBeGreaterThanOrEqual(4.5);
  });

  it('preserves every token previously defined in the variant B block', () => {
    document.documentElement.setAttribute('data-theme', 'sunset');
    document.documentElement.setAttribute('data-sunset-variant', 'B');
    const styles = getComputedStyle(document.documentElement);

    // Baseline list captured from `git show HEAD:src/styles/tokens.css` —
    // every property defined in the pre-US-188 variant B block must still
    // resolve to a non-empty value so consumers don't fall through to the
    // default-theme values.
    const required = [
      '--bg', '--bg-elevated', '--bg-subtle', '--bg-hover', '--bg-active', '--bg-inverse',
      '--border', '--border-strong', '--border-focus',
      '--text', '--text-secondary', '--text-tertiary', '--text-quaternary', '--text-inverse', '--text-on-accent',
      '--accent', '--accent-hover', '--accent-active', '--accent-subtle', '--accent-subtle-hover', '--accent-border', '--accent-text',
      '--success', '--success-subtle', '--success-border',
      '--warning', '--warning-subtle', '--warning-border',
      '--danger', '--danger-subtle', '--danger-border',
      '--insight', '--insight-subtle', '--insight-border',
      '--widget-theory', '--widget-demo', '--widget-quiz', '--widget-code', '--widget-code-cloze',
      '--widget-sandbox', '--widget-histogram', '--widget-plot-image', '--widget-parametric-explorer',
      '--widget-drag-match', '--widget-data-table', '--widget-video', '--widget-audio-player',
      '--widget-transcript-cloze', '--widget-stt-demo', '--widget-tts-demo',
      '--code-bg', '--code-text', '--code-keyword', '--code-string', '--code-comment', '--code-fn', '--code-number',
      '--shadow-xs', '--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-focus',
    ];

    for (const tok of required) {
      expect(styles.getPropertyValue(tok).trim(), `${tok} should be defined`).not.toBe('');
    }
  });
});
