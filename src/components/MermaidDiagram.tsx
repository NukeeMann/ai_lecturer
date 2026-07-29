'use client';

// US-216: client-side Mermaid diagram renderer for Theory markdown.
//
// A ```mermaid fenced block in Theory markdown is rendered to SVG here. The
// `mermaid` library is heavy (~1MB) and is therefore imported LAZILY — the
// dynamic import only fires when a MermaidDiagram actually mounts, so lessons
// without diagrams never pay for it.
//
// Diagram colours are bound to the active theme tokens (light/dark/sunset) by
// reading the CSS custom properties off <html> at render time and feeding them
// into mermaid's `themeVariables`. A MutationObserver on `data-theme` re-renders
// the diagram when the user switches themes.
//
// On a parse / render error the widget degrades to a plain fenced code block
// plus a discreet error note — it never throws past its own boundary.

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from 'react';

type MermaidModule = typeof import('mermaid')['default'];

let mermaidPromise: Promise<MermaidModule> | null = null;

// Single shared lazy import — the library is only fetched once per page even
// when several diagrams are present.
function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default);
  }
  return mermaidPromise;
}

// Map the project's design tokens onto mermaid's `base` theme variables so the
// diagram is legible in every theme. We read the *computed* values (resolving
// var() chains) off the document root.
function readThemeVariables(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const cs = window.getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => {
    const raw = cs.getPropertyValue(name).trim();
    return raw.length > 0 ? raw : fallback;
  };
  const text = v('--text', '#18171a');
  const accentSubtle = v('--accent-subtle', '#eaf0fd');
  const accentBorder = v('--accent-border', '#c2d2f8');
  const bgElevated = v('--bg-elevated', '#ffffff');
  const bgSubtle = v('--bg-subtle', '#f6f4f0');
  const line = v('--text-secondary', '#56524a');
  return {
    background: bgElevated,
    primaryColor: accentSubtle,
    primaryTextColor: text,
    primaryBorderColor: accentBorder,
    secondaryColor: bgSubtle,
    secondaryTextColor: text,
    tertiaryColor: bgSubtle,
    tertiaryTextColor: text,
    mainBkg: accentSubtle,
    nodeBorder: accentBorder,
    nodeTextColor: text,
    lineColor: line,
    textColor: text,
    titleColor: text,
    edgeLabelBackground: bgElevated,
    clusterBkg: bgSubtle,
    clusterBorder: accentBorder,
    labelTextColor: text,
    fontFamily: v('--font-sans', 'inherit'),
  };
}

export interface MermaidDiagramProps {
  code: string;
}

export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const reactId = useId();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);
  const renderSeq = useRef(0);

  // Re-render on theme switch (data-theme flips on <html>).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const observer = new MutationObserver(() => {
      setThemeVersion((n) => n + 1);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const seq = ++renderSeq.current;

    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: readThemeVariables(),
        });
        // mermaid.render needs a DOM-id-safe, unique id per invocation.
        const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}-${seq}`;
        const { svg: rendered } = await mermaid.render(renderId, code);
        if (!cancelled && seq === renderSeq.current) {
          setError(null);
          setSvg(rendered);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled && seq === renderSeq.current) {
          setSvg(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, reactId, themeVersion]);

  if (error) {
    // Fallback: render the source as a plain code block + a discreet note.
    return (
      <div data-mermaid data-mermaid-state="error">
        <pre
          data-mermaid-fallback
          style={{
            background: 'var(--code-bg)',
            color: 'var(--code-text)',
            padding: '12px 14px',
            borderRadius: 'var(--radius-md, 8px)',
            overflowX: 'auto',
          }}
        >
          <code>{code}</code>
        </pre>
        <p
          role="status"
          data-mermaid-error
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 'var(--fs-xs, 12px)',
            fontStyle: 'italic',
            margin: '4px 0 0',
          }}
        >
          Nie udało się zrenderować diagramu Mermaid (błąd składni).
        </p>
      </div>
    );
  }

  if (svg) {
    return (
      <div
        data-mermaid
        data-mermaid-state="done"
        className="mermaid-diagram"
        style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  return (
    <div
      data-mermaid
      data-mermaid-state="pending"
      style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-sm, 13px)', margin: '12px 0' }}
    >
      Rendering diagram…
    </div>
  );
}

// Extract the raw text content of a fenced code block's <code> child.
function extractCodeText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractCodeText).join('');
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractCodeText(props.children);
  }
  return '';
}

const MERMAID_CLASS_RE = /(?:^|\s)language-mermaid(?:\s|$)/;

// react-markdown `pre` component override: when the fenced block is a mermaid
// block, render it as a diagram; otherwise fall back to a normal <pre>.
export function MermaidPre({ children, ...rest }: ComponentProps<'pre'>) {
  const childArray = Children.toArray(children);
  const codeChild = childArray.find((c) => isValidElement(c));
  if (isValidElement(codeChild)) {
    const props = codeChild.props as { className?: string; children?: ReactNode };
    if (typeof props.className === 'string' && MERMAID_CLASS_RE.test(props.className)) {
      const code = extractCodeText(props.children).replace(/\n$/, '');
      return <MermaidDiagram code={code} />;
    }
  }
  return <pre {...rest}>{children}</pre>;
}
