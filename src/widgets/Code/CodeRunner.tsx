'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { tags as t } from '@lezer/highlight';
import { Play, RotateCcw } from 'lucide-react';

import { usePyodide, type RunResult } from '@/lib/pyodide/client';

export interface CodeRunnerProgressKey {
  courseSlug: string;
  lessonSlug: string;
  sectionId: string;
}

export type CodeRunnerPrimaryActionVariant = 'primary' | 'secondary' | 'ghost';

export interface CodeRunnerPrimaryAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  variant?: CodeRunnerPrimaryActionVariant;
  ariaLabel?: string;
  testId?: string;
}

export interface CodeRunnerProps {
  starterCode: string;
  initialCode?: string;
  progressKey?: CodeRunnerProgressKey;
  /** Slot rendered between the output panel and the footer (e.g. tests panel). */
  extraPanel?: ReactNode;
  /** Replace the default ▶ Run primary button. Pass `null` to hide it. */
  primaryAction?: CodeRunnerPrimaryAction | null;
  /** Notified whenever the editor doc changes. */
  onCodeChange?: (code: string) => void;
  /** Notified after Reset has cleared the editor. */
  onReset?: () => void;
  /** Override the output panel placeholder text (default: "Press ▶ Run to execute."). */
  outputPlaceholder?: string;
}

const FONT_SIZE = '13px';
const LINE_HEIGHT = 1.55;
const SAVE_DEBOUNCE_MS = 800;

export const codeRunnerEditorTheme = EditorView.theme({
  '&': {
    background: 'var(--code-bg)',
    color: 'var(--code-text)',
    fontFamily: 'var(--font-mono)',
    fontSize: FONT_SIZE,
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    fontSize: FONT_SIZE,
    lineHeight: String(LINE_HEIGHT),
    padding: 'var(--space-3) 0',
    caretColor: 'var(--accent)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: String(LINE_HEIGHT),
  },
  '.cm-gutters': {
    background: 'var(--code-bg)',
    color: 'var(--text-quaternary)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    color: 'var(--text-quaternary)',
    minWidth: '2ch',
    padding: '0 var(--space-3)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(127, 127, 127, 0.06)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--text-tertiary)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
  },
  '.cm-selectionBackground, & .cm-content ::selection': {
    background: 'var(--accent-subtle) !important',
  },
});

export const codeRunnerHighlightStyle = HighlightStyle.define([
  {
    tag: [
      t.keyword,
      t.controlKeyword,
      t.modifier,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.self,
    ],
    color: 'var(--code-keyword)',
    fontWeight: '500',
  },
  { tag: [t.string, t.special(t.string)], color: 'var(--code-string)' },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: 'var(--code-comment)',
    fontStyle: 'italic',
  },
  { tag: t.number, color: 'var(--code-number)' },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.function(t.definition(t.variableName)),
    ],
    color: 'var(--code-fn)',
  },
  { tag: [t.bool, t.null], color: 'var(--code-keyword)' },
]);

const LOADING_KEYFRAMES = `@keyframes coderunner-dot-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
  40% { transform: translateY(-4px); opacity: 1; }
}`;

const outputPanelStyle: CSSProperties = {
  background: 'var(--bg-subtle)',
  padding: 'var(--space-4) var(--space-5)',
  minHeight: 64,
  borderTop: '1px solid var(--border)',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-5)',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};

export const codeRunnerButtonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 var(--space-4)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background-color 120ms, border-color 120ms, color 120ms',
};

const ghostButtonStyle: CSSProperties = {
  ...codeRunnerButtonBase,
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid transparent',
};

function secondaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...codeRunnerButtonBase,
    background: disabled ? 'var(--bg-active)' : 'var(--bg-elevated)',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text)',
    border: '1px solid var(--border-strong)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  };
}

function primaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...codeRunnerButtonBase,
    background: disabled ? 'var(--bg-active)' : 'var(--accent)',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text-on-accent)',
    border: '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  };
}

function actionStyleFor(
  variant: CodeRunnerPrimaryActionVariant | undefined,
  disabled: boolean,
): CSSProperties {
  if (variant === 'primary') return primaryButtonStyle(disabled);
  if (variant === 'ghost') {
    return {
      ...ghostButtonStyle,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.7 : 1,
    };
  }
  return secondaryButtonStyle(disabled);
}

function LoadingIndicator() {
  const dotBase: CSSProperties = {
    width: 4,
    height: 4,
    borderRadius: '50%',
    background: 'var(--text-tertiary)',
    animation: 'coderunner-dot-bounce 1.2s ease-in-out infinite',
  };
  return (
    <div
      data-coderunner-loading
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        color: 'var(--text-tertiary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-sm)',
      }}
    >
      <span>Loading Python runtime…</span>
      <span style={{ display: 'inline-flex', gap: 4 }}>
        <span style={{ ...dotBase, animationDelay: '0s' }} />
        <span style={{ ...dotBase, animationDelay: '0.15s' }} />
        <span style={{ ...dotBase, animationDelay: '0.3s' }} />
        <span style={{ ...dotBase, animationDelay: '0.45s' }} />
      </span>
    </div>
  );
}

function ErrorCallout() {
  return (
    <div
      data-coderunner-error
      style={{
        background: 'var(--danger-subtle)',
        border: '1px solid var(--danger-border)',
        color: 'var(--danger)',
        padding: 'var(--space-3) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--fs-sm)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      Python runtime unavailable. Refresh to retry.
    </div>
  );
}

function OutputBody({
  output,
  running,
  placeholder,
}: {
  output: RunResult | null;
  running: boolean;
  placeholder: string;
}) {
  if (running) {
    return (
      <span
        style={{
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-sm)',
          fontStyle: 'italic',
        }}
      >
        Running…
      </span>
    );
  }
  if (!output) {
    return (
      <span
        data-coderunner-output-empty
        style={{
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-sm)',
          fontStyle: 'italic',
        }}
      >
        {placeholder}
      </span>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {output.stdout && (
        <pre
          data-coderunner-stdout
          style={{
            margin: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {output.stdout}
        </pre>
      )}
      {output.traceback && (
        <pre
          data-coderunner-traceback
          style={{
            margin: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--danger)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {output.traceback}
        </pre>
      )}
      {!output.stdout && !output.traceback && (
        <span
          style={{
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-sm)',
            fontStyle: 'italic',
          }}
        >
          (no output)
        </span>
      )}
    </div>
  );
}

async function patchProgress(
  key: CodeRunnerProgressKey,
  sectionStateForKey: Record<string, string | undefined>,
): Promise<void> {
  try {
    await fetch('/api/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseSlug: key.courseSlug,
        lessonSlug: key.lessonSlug,
        sectionState: { [key.sectionId]: sectionStateForKey },
      }),
    });
  } catch {
    // Persistence failures are non-fatal — the editor still works in-session.
  }
}

export function CodeRunner({
  starterCode,
  initialCode,
  progressKey,
  extraPanel,
  primaryAction,
  onCodeChange,
  onReset,
  outputPlaceholder = 'Press ▶ Run to execute.',
}: CodeRunnerProps) {
  const { status, run } = usePyodide();
  const [code, setCode] = useState<string>(initialCode ?? starterCode);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<RunResult | null>(null);

  const onCodeChangeRef = useRef(onCodeChange);
  useEffect(() => {
    onCodeChangeRef.current = onCodeChange;
  }, [onCodeChange]);

  const editorParentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codeRef = useRef(code);
  // The pyodide hook returns a fresh `run` reference each render; capture it
  // so the keymap (set once on mount) can always invoke the latest one.
  const runRef = useRef(run);
  const statusRef = useRef(status);

  useEffect(() => {
    codeRef.current = code;
  }, [code]);
  useEffect(() => {
    runRef.current = run;
  }, [run]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const handleRun = useCallback(async () => {
    if (statusRef.current !== 'ready' || running) return;
    setRunning(true);
    try {
      const result = await runRef.current(codeRef.current);
      setOutput(result);
    } catch (err) {
      setOutput({
        stdout: '',
        stderr: '',
        traceback: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  }, [running]);

  const handleRunRef = useRef(handleRun);
  useEffect(() => {
    handleRunRef.current = handleRun;
  }, [handleRun]);

  // Track the "pristine" code so we can suppress the initial save and the
  // re-save that fires immediately after Reset.
  const pristineRef = useRef<string>(initialCode ?? starterCode);
  const skipNextSaveRef = useRef(true);

  const handleReset = useCallback(() => {
    if (viewRef.current) {
      const view = viewRef.current;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: starterCode,
        },
      });
    }
    setCode(starterCode);
    setOutput(null);
    pristineRef.current = starterCode;
    skipNextSaveRef.current = true;
    if (progressKey) {
      void patchProgress(progressKey, {});
    }
    onReset?.();
  }, [starterCode, progressKey, onReset]);

  useEffect(() => {
    if (!editorParentRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const next = update.state.doc.toString();
        setCode(next);
        onCodeChangeRef.current?.(next);
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
        doc: codeRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
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
    // Editor is created once; subsequent updates flow through dispatch().
  }, []);

  // Debounced persistence of userCode to /api/progress.
  useEffect(() => {
    if (!progressKey) return;
    if (skipNextSaveRef.current && code === pristineRef.current) {
      return;
    }
    skipNextSaveRef.current = false;
    const handle = window.setTimeout(() => {
      void patchProgress(progressKey, { userCode: code });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [code, progressKey]);

  const runDisabled = status !== 'ready' || running;

  const showDefaultRun = primaryAction === undefined;
  const customAction = primaryAction ?? null;
  const customDisabled = customAction?.disabled ?? false;

  return (
    <div data-coderunner>
      <style>{LOADING_KEYFRAMES}</style>
      <div
        ref={editorParentRef}
        data-coderunner-editor
        style={{
          background: 'var(--code-bg)',
        }}
      />
      <div data-coderunner-output style={outputPanelStyle}>
        {status === 'loading' || status === 'idle' ? (
          <LoadingIndicator />
        ) : status === 'error' ? (
          <ErrorCallout />
        ) : (
          <OutputBody
            output={output}
            running={running}
            placeholder={outputPlaceholder}
          />
        )}
      </div>
      {extraPanel !== undefined && (
        <div data-coderunner-extra>{extraPanel}</div>
      )}
      <div style={footerStyle}>
        <button
          type="button"
          data-coderunner-reset
          onClick={handleReset}
          style={ghostButtonStyle}
          aria-label="Reset code to starter"
        >
          <RotateCcw size={14} aria-hidden />
          Reset
        </button>
        {showDefaultRun ? (
          <button
            type="button"
            data-coderunner-run
            onClick={() => void handleRun()}
            disabled={runDisabled}
            style={secondaryButtonStyle(runDisabled)}
            aria-label="Run code"
          >
            <Play size={14} aria-hidden />
            Run
          </button>
        ) : customAction !== null ? (
          <button
            type="button"
            data-coderunner-action
            data-testid={customAction.testId}
            onClick={() => void customAction.onClick()}
            disabled={customDisabled}
            style={actionStyleFor(customAction.variant, customDisabled)}
            aria-label={customAction.ariaLabel ?? customAction.label}
          >
            {customAction.icon}
            {customAction.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
