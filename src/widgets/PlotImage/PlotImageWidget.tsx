'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Play,
  RotateCcw,
} from 'lucide-react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { python } from '@codemirror/lang-python';

import { ZoomableImage } from '@/components/ZoomableImage';
import { MarkdownInline } from '@/components/MarkdownInline';
import { usePyodide } from '@/lib/pyodide/client';

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
  width: '100%',
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

const buttonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 30,
  padding: '0 var(--space-4)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background-color 120ms, border-color 120ms, color 120ms',
};

function runButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...buttonBase,
    background: disabled ? 'var(--bg-active)' : 'var(--bg-elevated)',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text)',
    border: '1px solid var(--border-strong)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  };
}

const ghostButtonStyle: CSSProperties = {
  ...buttonBase,
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid transparent',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-5)',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};

const errorStyle: CSSProperties = {
  background: 'var(--danger-subtle)',
  color: 'var(--danger)',
  padding: 'var(--space-3) var(--space-5)',
  borderTop: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const errorHeadlineStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
  color: 'var(--danger)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const errorToggleStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  border: 'none',
  padding: 0,
  fontSize: 'var(--fs-xs)',
  color: 'var(--danger)',
  cursor: 'pointer',
  alignSelf: 'flex-start',
};

const errorTracebackStyle: CSSProperties = {
  margin: 0,
  marginTop: 4,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
  color: 'var(--danger)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  opacity: 0.85,
};

const statusLineStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-tertiary)',
};

export function PlotImageWidget({ data }: PlotImageWidgetProps) {
  const { src, alt, caption, sourceCode, sourceLanguage } = data;
  const reactId = useId();
  const panelId = `plotimage-source-${reactId}`;
  const [open, setOpen] = useState(false);
  const language = sourceLanguage ?? 'python';

  const [livePngUrl, setLivePngUrl] = useState<string | null>(null);
  const livePngUrlRef = useRef<string | null>(null);
  useEffect(() => {
    livePngUrlRef.current = livePngUrl;
  }, [livePngUrl]);
  useEffect(() => {
    return () => {
      if (livePngUrlRef.current) URL.revokeObjectURL(livePngUrlRef.current);
    };
  }, []);

  const setLivePng = useCallback((next: string | null) => {
    setLivePngUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next;
    });
  }, []);

  const displaySrc = livePngUrl ?? src;

  return (
    <div data-plotimage-widget style={wrapStyle}>
      <figure data-plotimage-figure style={figureStyle}>
        <ZoomableImage
          src={displaySrc}
          alt={alt}
          style={imgStyle}
          imgProps={{
            'data-plotimage-img': '',
            'data-plotimage-rendered': livePngUrl ? 'true' : 'false',
          }}
        />
        {caption && (
          <figcaption data-plotimage-caption style={captionStyle}>
            <MarkdownInline>{caption}</MarkdownInline>
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
          {open &&
            (language === 'python' ? (
              <EditableSourcePanel
                key={panelId}
                panelId={panelId}
                originalCode={sourceCode}
                onLivePngUrl={setLivePng}
              />
            ) : (
              <div
                id={panelId}
                data-testid="plotimage-source-panel"
                style={codeContainerStyle}
              >
                <ReadOnlyCodeView code={sourceCode} language={language} />
              </div>
            ))}
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

interface EditableSourcePanelProps {
  panelId: string;
  originalCode: string;
  onLivePngUrl: (next: string | null) => void;
}

function EditableSourcePanel({
  panelId,
  originalCode,
  onLivePngUrl,
}: EditableSourcePanelProps) {
  const { status, runWithPlotParam } = usePyodide();
  const editorParentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codeRef = useRef(originalCode);
  const [running, setRunning] = useState(false);
  const [errorTraceback, setErrorTraceback] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tracebackOpen, setTracebackOpen] = useState(false);

  const statusRef = useRef(status);
  const runRef = useRef(runWithPlotParam);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    runRef.current = runWithPlotParam;
  }, [runWithPlotParam]);

  const runningRef = useRef(running);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const handleRun = useCallback(async () => {
    if (statusRef.current !== 'ready' || runningRef.current) return;
    setRunning(true);
    setErrorTraceback(null);
    setErrorType(null);
    setErrorMessage(null);
    setTracebackOpen(false);
    try {
      const result = await runRef.current({
        setupCode: '',
        renderCode: codeRef.current,
        params: {},
        outputType: 'plot',
      });
      if (result.traceback) {
        setErrorTraceback(result.traceback);
        setErrorType(result.errorType ?? null);
        setErrorMessage(result.errorMessage ?? null);
        return;
      }
      if (result.png && result.png instanceof Uint8Array) {
        const blob = new Blob([result.png as BlobPart], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        onLivePngUrl(url);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorTraceback(msg);
      setErrorType(err instanceof Error ? err.name : null);
      setErrorMessage(msg);
    } finally {
      setRunning(false);
    }
  }, [onLivePngUrl]);

  const handleRunRef = useRef(handleRun);
  useEffect(() => {
    handleRunRef.current = handleRun;
  }, [handleRun]);

  const handleReset = useCallback(() => {
    if (viewRef.current) {
      const view = viewRef.current;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: originalCode,
        },
      });
    }
    codeRef.current = originalCode;
    setErrorTraceback(null);
    setErrorType(null);
    setErrorMessage(null);
    setTracebackOpen(false);
    onLivePngUrl(null);
  }, [originalCode, onLivePngUrl]);

  useEffect(() => {
    if (!editorParentRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        codeRef.current = update.state.doc.toString();
      }
    });

    const runKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        preventDefault: true,
        run: () => {
          void handleRunRef.current();
          return true;
        },
      },
    ]);

    const view = new EditorView({
      parent: editorParentRef.current,
      state: EditorState.create({
        doc: originalCode,
        extensions: [
          lineNumbers(),
          history(),
          indentOnInput(),
          bracketMatching(),
          python(),
          syntaxHighlighting(codeRunnerHighlightStyle),
          codeRunnerEditorTheme,
          runKeymap,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          updateListener,
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Editor is created once on mount. Reset uses dispatch() to swap doc back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runDisabled = status !== 'ready' || running;

  const headline = useMemo(() => {
    if (!errorTraceback) return null;
    const label = errorType ?? 'Error';
    return errorMessage ? `${label}: ${errorMessage}` : label;
  }, [errorTraceback, errorType, errorMessage]);

  const statusLine = useMemo(() => {
    if (status === 'idle' || status === 'loading') {
      return 'Loading Python runtime…';
    }
    if (running) {
      return 'Running…';
    }
    if (status === 'error') {
      return 'Python runtime unavailable.';
    }
    return null;
  }, [status, running]);

  return (
    <div
      id={panelId}
      data-testid="plotimage-source-panel"
      data-plotimage-source-lang="python"
      style={codeContainerStyle}
    >
      <div
        ref={editorParentRef}
        data-testid="plotimage-editable"
      />
      {errorTraceback && (
        <div data-testid="plotimage-error" style={errorStyle}>
          {headline && (
            <p
              data-testid="plotimage-error-headline"
              data-error-type={errorType ?? ''}
              style={errorHeadlineStyle}
            >
              {headline}
            </p>
          )}
          <button
            type="button"
            data-testid="plotimage-traceback-toggle"
            aria-expanded={tracebackOpen}
            onClick={() => setTracebackOpen((v) => !v)}
            style={errorToggleStyle}
          >
            {tracebackOpen ? (
              <ChevronDown size={12} aria-hidden />
            ) : (
              <ChevronRight size={12} aria-hidden />
            )}
            {tracebackOpen ? 'Hide traceback' : 'Show traceback'}
          </button>
          {tracebackOpen && (
            <pre data-testid="plotimage-traceback" style={errorTracebackStyle}>
              {errorTraceback}
            </pre>
          )}
        </div>
      )}
      <div style={footerStyle}>
        <span data-testid="plotimage-status" style={statusLineStyle}>
          {statusLine ?? ' '}
        </span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <button
            type="button"
            data-testid="plotimage-reset"
            onClick={handleReset}
            disabled={running}
            style={{
              ...ghostButtonStyle,
              cursor: running ? 'not-allowed' : 'pointer',
              opacity: running ? 0.6 : 1,
            }}
            aria-label="Reset code and restore original image"
          >
            <RotateCcw size={14} aria-hidden />
            Reset
          </button>
          <button
            type="button"
            data-testid="plotimage-run"
            onClick={() => void handleRun()}
            disabled={runDisabled}
            style={runButtonStyle(runDisabled)}
            aria-label="Run code"
          >
            <Play size={14} aria-hidden />
            Run
          </button>
        </div>
      </div>
    </div>
  );
}
