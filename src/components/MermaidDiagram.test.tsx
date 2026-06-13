// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

// Mock the heavy `mermaid` dependency so tests never load the real library.
const renderMock = vi.fn(async (_id: string, code: string) => {
  if (code.includes('BROKEN')) {
    throw new Error('Parse error on line 1');
  }
  return { svg: `<svg role="img"><text>${code.length}</text></svg>` };
});
const initializeMock = vi.fn();

vi.mock('mermaid', () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
  },
}));

import { MermaidDiagram, MermaidPre } from './MermaidDiagram';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('US-216 — MermaidDiagram', () => {
  it('renders the SVG returned by mermaid on success', async () => {
    const { container } = render(<MermaidDiagram code="flowchart TD\n A-->B" />);
    await waitFor(() => {
      const node = container.querySelector('[data-mermaid]');
      expect(node?.getAttribute('data-mermaid-state')).toBe('done');
    });
    expect(container.querySelector('svg')).not.toBeNull();
    expect(initializeMock).toHaveBeenCalled();
  });

  it('falls back to a code block + discreet error note on invalid syntax', async () => {
    const { container } = render(<MermaidDiagram code="BROKEN diagram" />);
    await waitFor(() => {
      const node = container.querySelector('[data-mermaid]');
      expect(node?.getAttribute('data-mermaid-state')).toBe('error');
    });
    expect(container.querySelector('[data-mermaid-fallback]')?.textContent).toContain(
      'BROKEN diagram',
    );
    expect(container.querySelector('[data-mermaid-error]')).not.toBeNull();
    // never throws past its own boundary
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('US-216 — MermaidPre (markdown pre override)', () => {
  it('renders a MermaidDiagram for a language-mermaid fenced block', async () => {
    const { container } = render(
      <MermaidPre>
        <code className="language-mermaid">{'flowchart TD\n A-->B\n'}</code>
      </MermaidPre>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-mermaid]')).not.toBeNull();
    });
    // no raw <pre><code> wrapper for mermaid blocks
    expect(container.querySelector('pre > code.language-mermaid')).toBeNull();
  });

  it('renders a plain <pre> for non-mermaid fenced blocks', () => {
    const { container } = render(
      <MermaidPre>
        <code className="language-python">print(1)</code>
      </MermaidPre>,
    );
    expect(container.querySelector('[data-mermaid]')).toBeNull();
    expect(container.querySelector('pre > code.language-python')).not.toBeNull();
  });
});
