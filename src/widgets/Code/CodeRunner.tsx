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
import { ChevronDown, ChevronRight, Play, RotateCcw, Square } from 'lucide-react';

import { Callout } from '@/components/Callout';
import {
  PyodideStopError,
  subscribePyodideRestart,
  usePyodide,
  type PyodideInputFile,
  type PyodideStopReason,
  type RunResult,
} from '@/lib/pyodide/client';

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
  /**
   * When true, treat the parent-provided `primaryAction` as in-flight:
   * morph it to a Stop button (US-039). Used by widgets whose primary action
   * runs Python via `runWithTests` (e.g. Code).
   */
  actionRunning?: boolean;
  /**
   * Optional content rendered inside the output panel alongside any text/log
   * output (US-114). Used by Code widget to surface inline image/video output.
   */
  outputMediaSlot?: ReactNode;
  /**
   * Pyodide packages to ensure before the inline ▶ Run executes user code.
   * Mirrors the parent widget's `data.requiresPackages` so plain Run picks
   * up the same `cv2` shim / other preloads as Submit.
   */
  runRequiresPackages?: string[];
  /**
   * Lesson-provided files to mount into the Pyodide VFS at
   * `/inputs/<filename>` before the inline ▶ Run executes user code, so
   * plain Run sees the same files as Submit.
   */
  runInputs?: PyodideInputFile[];
}

const FONT_SIZE = 'calc(13px * var(--text-scale, 1))';
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

const stopButtonStyle: CSSProperties = {
  ...codeRunnerButtonBase,
  background: 'var(--danger)',
  color: 'var(--text-on-accent)',
  border: '1px solid transparent',
  cursor: 'pointer',
};

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

const outputHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  marginBottom: 'var(--space-3)',
};

const outputHeaderLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'transparent',
  border: 'none',
  padding: 0,
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
};

const stdoutStreamStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  whiteSpace: 'pre-wrap',
};

const stderrStreamStyle: CSSProperties = {
  margin: 0,
  padding: 'var(--space-2) var(--space-3)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--warning, #b45309)',
  background: 'var(--warning-subtle, rgba(180, 115, 30, 0.08))',
  borderLeft: '3px solid var(--warning, #b45309)',
  borderRadius: 'var(--radius-sm)',
  whiteSpace: 'pre-wrap',
};

const stderrLabelStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--warning, #b45309)',
  marginBottom: 4,
  display: 'block',
};

const exceptionBlockStyle: CSSProperties = {
  borderRadius: 'var(--radius-sm)',
  borderLeft: '3px solid var(--danger)',
  background: 'var(--danger-subtle)',
  padding: 'var(--space-2) var(--space-3)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const exceptionHeadlineStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
  color: 'var(--danger)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const exceptionToggleStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  border: 'none',
  padding: 0,
  marginTop: 2,
  fontSize: 'var(--fs-xs)',
  color: 'var(--danger)',
  cursor: 'pointer',
  alignSelf: 'flex-start',
};

const tracebackPreStyle: CSSProperties = {
  margin: 0,
  marginTop: 4,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
  color: 'var(--danger)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  opacity: 0.85,
};

function hasAnyOutput(output: RunResult | null): boolean {
  if (!output) return false;
  return Boolean(output.stdout || output.stderr || output.traceback);
}

interface OutputBodyProps {
  output: RunResult | null;
  running: boolean;
  placeholder: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  tracebackOpen: boolean;
  onToggleTraceback: () => void;
}

function OutputBody({
  output,
  running,
  placeholder,
  collapsed,
  onToggleCollapsed,
  tracebackOpen,
  onToggleTraceback,
}: OutputBodyProps) {
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

  // Empty result after a run — render nothing so the panel does not look like
  // an error state (US-061 AC: "no false 'error' state").
  if (!hasAnyOutput(output)) {
    return null;
  }

  const errorTypeLabel = output.errorType ?? (output.traceback ? 'Error' : null);
  const headline = errorTypeLabel
    ? output.errorMessage
      ? `${errorTypeLabel}: ${output.errorMessage}`
      : errorTypeLabel
    : null;

  return (
    <div data-coderunner-output-body>
      <div style={outputHeaderStyle}>
        <button
          type="button"
          data-coderunner-output-toggle
          data-testid="coderunner-output-toggle"
          aria-expanded={!collapsed}
          aria-controls="coderunner-output-content"
          onClick={onToggleCollapsed}
          style={outputHeaderLabelStyle}
        >
          {collapsed ? (
            <ChevronRight size={12} aria-hidden />
          ) : (
            <ChevronDown size={12} aria-hidden />
          )}
          Output
        </button>
      </div>
      {!collapsed && (
        <div
          id="coderunner-output-content"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          {output.stdout && (
            <pre data-coderunner-stdout style={stdoutStreamStyle}>
              {output.stdout}
            </pre>
          )}
          {output.stderr && (
            <div data-coderunner-stderr style={stderrStreamStyle}>
              <span style={stderrLabelStyle}>stderr</span>
              <pre style={{ margin: 0, fontFamily: 'inherit' }}>{output.stderr}</pre>
            </div>
          )}
          {output.traceback && (
            <div data-coderunner-exception style={exceptionBlockStyle}>
              {headline && (
                <p
                  data-coderunner-error-headline
                  data-testid="coderunner-error-headline"
                  data-error-type={output.errorType ?? ''}
                  style={exceptionHeadlineStyle}
                >
                  {headline}
                </p>
              )}
              <button
                type="button"
                data-coderunner-traceback-toggle
                data-testid="coderunner-traceback-toggle"
                aria-expanded={tracebackOpen}
                onClick={onToggleTraceback}
                style={exceptionToggleStyle}
              >
                {tracebackOpen ? (
                  <ChevronDown size={12} aria-hidden />
                ) : (
                  <ChevronRight size={12} aria-hidden />
                )}
                {tracebackOpen ? 'Hide traceback' : 'Show traceback'}
              </button>
              {tracebackOpen && (
                <pre
                  data-coderunner-traceback
                  data-testid="coderunner-traceback"
                  style={tracebackPreStyle}
                >
                  {output.traceback}
                </pre>
              )}
            </div>
          )}
        </div>
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
  actionRunning = false,
  outputMediaSlot,
  runRequiresPackages,
  runInputs,
}: CodeRunnerProps) {
  const { status, run, stop } = usePyodide();
  const [code, setCode] = useState<string>(initialCode ?? starterCode);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<RunResult | null>(null);
  const [restartReason, setRestartReason] = useState<PyodideStopReason | null>(
    null,
  );
  const [outputCollapsed, setOutputCollapsed] = useState(false);
  const [tracebackOpen, setTracebackOpen] = useState(false);

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
  const runRequiresPackagesRef = useRef(runRequiresPackages);
  const runInputsRef = useRef(runInputs);

  useEffect(() => {
    codeRef.current = code;
  }, [code]);
  useEffect(() => {
    runRef.current = run;
  }, [run]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    runRequiresPackagesRef.current = runRequiresPackages;
  }, [runRequiresPackages]);
  useEffect(() => {
    runInputsRef.current = runInputs;
  }, [runInputs]);

  const handleRun = useCallback(async () => {
    if (statusRef.current !== 'ready' || running) return;
    setRunning(true);
    setOutput(null);
    setRestartReason(null);
    setOutputCollapsed(false);
    setTracebackOpen(false);
    try {
      const inputs = runInputsRef.current;
      const result = await runRef.current(
        codeRef.current,
        runRequiresPackagesRef.current,
        inputs && inputs.length > 0 ? { inputs } : undefined,
      );
      setOutput(result);
    } catch (err) {
      if (err instanceof PyodideStopError) {
        setRestartReason(err.reason);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setOutput({
          stdout: '',
          stderr: '',
          traceback: msg,
          errorType: err instanceof Error ? err.name : undefined,
          errorMessage: msg,
        });
      }
    } finally {
      setRunning(false);
    }
  }, [running]);

  const handleStop = useCallback(() => {
    stop('user');
  }, [stop]);

  // Mirror the running flags into refs so the restart-event subscriber
  // (set up once on mount) reads the latest values.
  const runningRef = useRef(running);
  const actionRunningRef = useRef(actionRunning);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  useEffect(() => {
    actionRunningRef.current = actionRunning;
  }, [actionRunning]);

  // Subscribe to global restart events so the Callout shows even when the
  // in-flight call belongs to the parent (e.g. Code widget Submit).
  useEffect(() => {
    return subscribePyodideRestart((reason) => {
      if (runningRef.current || actionRunningRef.current) {
        setRestartReason(reason);
      }
    });
  }, []);

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
    setRestartReason(null);
    setTracebackOpen(false);
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

  // Stop button replaces the primary action whenever Pyodide is mid-execution
  // for THIS widget — either the default Run is running, or the parent's
  // custom action is running (US-039).
  const showStop = running || actionRunning;

  const actionsRow = (
    <div
      data-coderunner-actions
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        flexShrink: 0,
      }}
    >
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
      {showStop ? (
        <button
          type="button"
          data-coderunner-stop
          data-testid="coderunner-stop"
          onClick={handleStop}
          style={stopButtonStyle}
          aria-label="Stop running code"
        >
          <Square size={14} aria-hidden fill="currentColor" />
          Stop
        </button>
      ) : showDefaultRun ? (
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
  );

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
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {status === 'loading' || status === 'idle' ? (
              <LoadingIndicator />
            ) : status === 'error' ? (
              <ErrorCallout />
            ) : restartReason ? (
              <div data-coderunner-restart data-restart-reason={restartReason}>
                <Callout tone="warning">
                  {restartReason === 'timeout'
                    ? 'Execution timed out after 30s. Session restarted.'
                    : 'Session restarted — re-run previous cells if needed.'}
                </Callout>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                }}
              >
                <OutputBody
                  output={output}
                  running={running}
                  placeholder={outputPlaceholder}
                  collapsed={outputCollapsed}
                  onToggleCollapsed={() => setOutputCollapsed((v) => !v)}
                  tracebackOpen={tracebackOpen}
                  onToggleTraceback={() => setTracebackOpen((v) => !v)}
                />
                {outputMediaSlot}
              </div>
            )}
          </div>
          {actionsRow}
        </div>
      </div>
      {extraPanel !== undefined && (
        <div data-coderunner-extra>{extraPanel}</div>
      )}
    </div>
  );
}
