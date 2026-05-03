'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import {
  bracketMatching,
  syntaxHighlighting,
} from '@codemirror/language';
import { python } from '@codemirror/lang-python';

import {
  codeRunnerEditorTheme,
  codeRunnerHighlightStyle,
} from '../Code/CodeRunner';

import type { PlotImageData } from './schema';

export interface PlotImageWidgetProps {
  data: PlotImageData;
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const figureStyle: CSSProperties = {
  margin: 0,
  padding: 'var(--space-4) var(--space-5)',
  background: 'var(--bg-subtle)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--space-3)',
};

const imgStyle: CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  height: 'auto',
  objectFit: 'contain',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};

const captionStyle: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  textAlign: 'center',
  lineHeight: 1.5,
};

const sourceWrapStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};

const toggleButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  width: '100%',
  textAlign: 'left',
};

const codeContainerStyle: CSSProperties = {
  background: 'var(--code-bg)',
  borderTop: '1px solid var(--border)',
  overflow: 'hidden',
};

export function PlotImageWidget({ data }: PlotImageWidgetProps) {
  const { src, alt, caption, sourceCode, sourceLanguage } = data;
  const reactId = useId();
  const panelId = `plotimage-source-${reactId}`;
  const [open, setOpen] = useState(false);

  return (
    <div data-plotimage-widget style={wrapStyle}>
      <figure data-plotimage-figure style={figureStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          data-plotimage-img
          src={src}
          alt={alt}
          style={imgStyle}
        />
        {caption && (
          <figcaption data-plotimage-caption style={captionStyle}>
            {caption}
          </figcaption>
        )}
      </figure>
      {sourceCode && (
        <div style={sourceWrapStyle}>
          <button
            type="button"
            data-testid="plotimage-toggle-source"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            style={toggleButtonStyle}
          >
            {open ? (
              <ChevronDown size={14} aria-hidden />
            ) : (
              <ChevronRight size={14} aria-hidden />
            )}
            {open ? 'Hide source' : 'Show source'}
          </button>
          {open && (
            <div
              id={panelId}
              data-testid="plotimage-source-panel"
              style={codeContainerStyle}
            >
              <ReadOnlyCodeView
                code={sourceCode}
                language={sourceLanguage ?? 'python'}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ReadOnlyCodeViewProps {
  code: string;
  language: 'python' | 'r';
}

function ReadOnlyCodeView({ code, language }: ReadOnlyCodeViewProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!parentRef.current) return;
    const langExtensions = language === 'python' ? [python()] : [];
    const view = new EditorView({
      parent: parentRef.current,
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(),
          bracketMatching(),
          ...langExtensions,
          syntaxHighlighting(codeRunnerHighlightStyle),
          codeRunnerEditorTheme,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      }),
    });
    return () => {
      view.destroy();
    };
    // Mount once with the given code/language; parent re-mounts via key when these change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(code);
    }
  }, [code]);

  return (
    <div data-plotimage-source-lang={language}>
      <div ref={parentRef} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '6px 10px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <button
          type="button"
          onClick={handleCopy}
          data-testid="plotimage-copy-source"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 10px',
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          Copy
        </button>
      </div>
    </div>
  );
}
