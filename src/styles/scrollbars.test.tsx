// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// jsdom doesn't process @import or @tailwind directives, so we inject the
// raw stylesheet content directly via a <style> tag. This lets
// getComputedStyle see the global `* { scrollbar-width: thin }` rule even
// though jsdom never paints scrollbars.
beforeAll(() => {
  const css = readFileSync(
    path.resolve(process.cwd(), 'src/app/globals.css'),
    'utf-8',
  );
  const style = document.createElement('style');
  style.dataset.testid = 'scrollbar-styles';
  style.textContent = css;
  document.head.appendChild(style);
});

afterEach(() => {
  cleanup();
});

describe('US-185 — global themed scrollbar', () => {
  it('applies `scrollbar-width: thin` globally so any overflow container inherits it', () => {
    render(
      <div style={{ height: 50, overflow: 'auto' }}>
        <div style={{ height: 500 }} />
      </div>,
    );

    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue('scrollbar-width')
        .trim(),
    ).toBe('thin');
  });

  it('declares the AC-mandated WebKit + Firefox rules in globals.css', () => {
    const css = readFileSync(
      path.resolve(process.cwd(), 'src/app/globals.css'),
      'utf-8',
    );
    expect(css).toMatch(/\*\s*\{[^}]*scrollbar-width:\s*thin/);
    expect(css).toMatch(/scrollbar-color:\s*var\(--border-strong\)\s*transparent/);
    expect(css).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*10px/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--border-strong\)/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb:hover\s*\{[^}]*background:\s*var\(--text-quaternary\)/);
    expect(css).toMatch(/::-webkit-scrollbar-corner\s*\{[^}]*background:\s*transparent/);
  });
});
