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
import { Check, ChevronDown, ChevronRight, Circle, Eye, EyeOff, X } from 'lucide-react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { python } from '@codemirror/lang-python';

import { Callout } from '@/components/Callout';
import { Confetti } from '@/components/Confetti';
import {
  PyodideStopError,
  usePyodide,
  type RunWithTestsResult,
  type TestResult,
} from '@/lib/pyodide/client';

import {
  CodeRunner,
  codeRunnerEditorTheme,
  codeRunnerHighlightStyle,
  type CodeRunnerProgressKey,
} from './CodeRunner';
import type { CodeData, CodeTest } from './schema';

export interface CodeWidgetProps {
  data: CodeData;
  initialCode?: string;
  progressKey?: CodeRunnerProgressKey;
  onComplete?: () => void;
  /**
   * When true, this widget was already passed before this mount (re-entering a
   * completed lesson). Suppresses the success confetti on subsequent passes so
   * animations only fire on the first-time win.
   */
  alreadyCompleted?: boolean;
}

type SubmissionState = 'idle' | 'submitting' | 'submitted-pass' | 'submitted-fail';

interface ParsedAssertion {
  expected?: string;
  actual?: string;
  raw: string;
}

function parseAssertionDetail(detail: string | null | undefined): ParsedAssertion | null {
  if (!detail) return null;
  const raw = detail.trim();
  if (!raw) return null;

  // Pattern: "expected X, got Y" / "expected X but got Y" (case-insensitive)
  const expectedGot = raw.match(/expected\s+([\s\S]+?)(?:,|\s+but)\s+got\s+([\s\S]+)/i);
  if (expectedGot) {
    return { expected: expectedGot[1].trim(), actual: expectedGot[2].trim(), raw };
  }

  // Pattern: "X != Y" (single-line)
  const neq = raw.match(/^([^\n]+?)\s*!=\s*([^\n]+)$/);
  if (neq) {
    return { expected: neq[2].trim(), actual: neq[1].trim(), raw };
  }

  // Pattern: "actual: X\nexpected: Y" (any order)
  const labelLines = raw.split(/\r?\n/);
  let exp: string | undefined;
  let act: string | undefined;
  for (const line of labelLines) {
    const e = line.match(/^\s*expected\s*[:=]\s*(.+)$/i);
    if (e) exp = e[1].trim();
    const a = line.match(/^\s*actual\s*[:=]\s*(.+)$/i);
    if (a) act = a[1].trim();
  }
  if (exp || act) {
    return { expected: exp, actual: act, raw };
  }

  return { raw };
}

function lastTracebackLines(traceback: string | null | undefined, limit: number): string {
  if (!traceback) return '';
  const lines = traceback.split(/\r?\n/).filter((l) => l.length > 0);
  return lines.slice(Math.max(0, lines.length - limit)).join('\n');
}

const panelWrapStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  borderTop: '1px solid var(--border)',
  padding: 'var(--space-4) var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
};

const sectionLabelStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
};

const stdoutStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  whiteSpace: 'pre-wrap',
};

const tracebackStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--danger)',
  whiteSpace: 'pre-wrap',
};

const outputToggleButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  border: 'none',
  padding: 0,
  marginBottom: 6,
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
};

const outputContentStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const stderrBlockStyle: CSSProperties = {
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

const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
};

const toggleAllButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-xs)',
  fontWeight: 500,
  cursor: 'pointer',
  padding: '2px 4px',
};

const testRowButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  width: '100%',
  background: 'transparent',
  border: 'none',
  padding: '6px 4px',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  color: 'var(--text)',
  borderRadius: 'var(--radius-sm)',
};

const testListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const expandedBlockStyle: CSSProperties = {
  marginLeft: 28,
  marginTop: 4,
  marginBottom: 'var(--space-2)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  overflow: 'hidden',
  background: 'var(--code-bg)',
};

const assertionBlockStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  background: 'var(--danger-subtle)',
  padding: 'var(--space-3) var(--space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const assertionTitleStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  color: 'var(--danger)',
  textTransform: 'uppercase',
};

const assertionLineStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  whiteSpace: 'pre-wrap',
  margin: 0,
};

const assertionLabelStyle: CSSProperties = {
  color: 'var(--text-tertiary)',
};

interface ReadOnlyTestEditorProps {
  body: string;
}

function ReadOnlyTestEditor({ body }: ReadOnlyTestEditorProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!parentRef.current) return;
    const view = new EditorView({
      parent: parentRef.current,
      state: EditorState.create({
        doc: body,
        extensions: [
          lineNumbers(),
          python(),
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
  }, [body]);

  return <div ref={parentRef} data-codewidget-test-body />;
}

const peekRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-start',
};

const peekButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 10px',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-xs)',
  fontWeight: 500,
  cursor: 'pointer',
};

const solutionPanelStyle: CSSProperties = {
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
};

const solutionLabelStyle: CSSProperties = {
  ...sectionLabelStyle,
  padding: 'var(--space-3) var(--space-4) 0',
};

interface ReadOnlySolutionEditorProps {
  source: string;
}

function ReadOnlySolutionEditor({ source }: ReadOnlySolutionEditorProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!parentRef.current) return;
    const view = new EditorView({
      parent: parentRef.current,
      state: EditorState.create({
        doc: source,
        extensions: [
          lineNumbers(),
          python(),
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
  }, [source]);

  return <div ref={parentRef} data-codewidget-solution-body />;
}

interface TestRowProps {
  index: number;
  test: CodeTest;
  result: TestResult | undefined;
  expanded: boolean;
  onToggle: () => void;
  submitted: boolean;
}

function StatusIcon({ result }: { result: TestResult | undefined }) {
  if (!result) {
    return (
      <Circle
        size={14}
        aria-hidden
        style={{ color: 'var(--text-quaternary)', flexShrink: 0 }}
      />
    );
  }
  if (result.passed) {
    return (
      <Check
        size={14}
        aria-hidden
        strokeWidth={2.5}
        style={{ color: 'var(--success)', flexShrink: 0 }}
      />
    );
  }
  return (
    <X
      size={14}
      aria-hidden
      strokeWidth={2.5}
      style={{ color: 'var(--danger)', flexShrink: 0 }}
    />
  );
}

function TestRow({ index, test, result, expanded, onToggle, submitted }: TestRowProps) {
  const failed = submitted && result && !result.passed;
  const parsed = failed ? parseAssertionDetail(result?.assertionDetail) : null;
  const tracebackExcerpt = failed ? lastTracebackLines(result?.traceback, 3) : '';

  return (
    <div data-codewidget-test data-test-index={index}>
      <button
        type="button"
        onClick={onToggle}
        style={testRowButtonStyle}
        data-test-row
        data-state={result ? (result.passed ? 'pass' : 'fail') : 'untested'}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown
            size={12}
            aria-hidden
            style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}
          />
        ) : (
          <ChevronRight
            size={12}
            aria-hidden
            style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}
          />
        )}
        <StatusIcon result={result} />
        <span style={{ flex: 1, minWidth: 0 }}>{test.name}</span>
      </button>
      {expanded && (
        <div style={expandedBlockStyle} data-test-body-wrap>
          <ReadOnlyTestEditor body={test.body} />
          {failed && (
            <div style={assertionBlockStyle} data-test-assertion>
              <div style={assertionTitleStyle}>Assertion mismatch</div>
              {parsed && (parsed.expected || parsed.actual) ? (
                <>
                  {parsed.expected !== undefined && (
                    <p style={assertionLineStyle}>
                      <span style={assertionLabelStyle}>expected: </span>
                      {parsed.expected}
                    </p>
                  )}
                  {parsed.actual !== undefined && (
                    <p style={assertionLineStyle}>
                      <span style={assertionLabelStyle}>actual: </span>
                      {parsed.actual}
                    </p>
                  )}
                </>
              ) : parsed?.raw ? (
                <p style={assertionLineStyle}>{parsed.raw}</p>
              ) : (
                <p style={{ ...assertionLineStyle, color: 'var(--text-tertiary)' }}>
                  (no assertion message)
                </p>
              )}
              {tracebackExcerpt && (
                <pre style={tracebackStyle} data-test-traceback>
                  {tracebackExcerpt}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CodeWidget({
  data,
  initialCode,
  progressKey,
  onComplete,
  alreadyCompleted,
}: CodeWidgetProps) {
  const { status, runWithTests } = usePyodide();

  const [code, setCode] = useState<string>(initialCode ?? data.starterCode);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [stdout, setStdout] = useState<string>('');
  const [stderr, setStderr] = useState<string>('');
  const [traceback, setTraceback] = useState<string | undefined>(undefined);
  const [errorType, setErrorType] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [outputCollapsed, setOutputCollapsed] = useState(false);
  const [tracebackOpen, setTracebackOpen] = useState(false);
  const [submission, setSubmission] = useState<SubmissionState>('idle');
  const [solutionOpen, setSolutionOpen] = useState(false);
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  const confettiOriginRef = useRef<HTMLDivElement | null>(null);
  const confettiFiredRef = useRef(false);
  const solutionPanelId = useId();

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const passedCount = useMemo(
    () => (results ? results.filter((r) => r.passed).length : 0),
    [results],
  );
  const total = data.tests.length;

  const allExpanded = useMemo(
    () => total > 0 && data.tests.every((_, i) => expanded[i]),
    [expanded, data.tests, total],
  );

  function toggleAll() {
    if (allExpanded) {
      setExpanded({});
    } else {
      const next: Record<number, boolean> = {};
      data.tests.forEach((_, i) => {
        next[i] = true;
      });
      setExpanded(next);
    }
  }

  function toggleOne(i: number) {
    setExpanded((prev) => ({ ...prev, [i]: !prev[i] }));
  }

  const handleSubmit = useCallback(async () => {
    if (status !== 'ready') return;
    if (submission === 'submitting' || submission === 'submitted-pass') return;
    setSubmission('submitting');
    setOutputCollapsed(false);
    setTracebackOpen(false);
    try {
      const result: RunWithTestsResult = await runWithTests(
        code,
        data.tests.map((t) => ({ name: t.name, body: t.body })),
      );
      setStdout(result.stdout ?? '');
      setStderr(result.stderr ?? '');
      setTraceback(result.traceback);
      setErrorType(result.errorType);
      setErrorMessage(result.errorMessage);
      const tr = result.testResults ?? [];
      setResults(tr);
      const passed = tr.length > 0 && tr.every((r) => r.passed);
      if (passed) {
        setSubmission('submitted-pass');
        if (progressKey) {
          void patchSectionDone(progressKey, code);
        }
        onCompleteRef.current?.();
        if (!alreadyCompleted && !confettiFiredRef.current) {
          confettiFiredRef.current = true;
          setConfettiTrigger((n) => n + 1);
        }
      } else {
        setSubmission('submitted-fail');
      }
    } catch (err) {
      if (err instanceof PyodideStopError) {
        // CodeRunner output panel surfaces the restart Callout. Reset our
        // local submission state so the user can press Submit again on the
        // fresh worker.
        setStdout('');
        setStderr('');
        setTraceback(undefined);
        setErrorType(undefined);
        setErrorMessage(undefined);
        setResults(null);
        setSubmission('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setStdout('');
      setStderr('');
      setTraceback(msg);
      setErrorType(err instanceof Error ? err.name : undefined);
      setErrorMessage(msg);
      setResults(
        data.tests.map((t) => ({
          name: t.name,
          passed: false,
          traceback: msg,
          assertionDetail: null,
        })),
      );
      setSubmission('submitted-fail');
    }
  }, [code, data.tests, runWithTests, status, submission, progressKey, alreadyCompleted]);

  const handleReset = useCallback(() => {
    setResults(null);
    setStdout('');
    setStderr('');
    setTraceback(undefined);
    setErrorType(undefined);
    setErrorMessage(undefined);
    setExpanded({});
    setSubmission('idle');
    setTracebackOpen(false);
  }, []);

  const submitDisabled =
    status !== 'ready' ||
    submission === 'submitting' ||
    submission === 'submitted-pass';

  const primaryAction = useMemo(() => {
    if (submission === 'submitted-pass') {
      return {
        label: 'Submitted ✓',
        onClick: () => {},
        disabled: true,
        variant: 'ghost' as const,
        testId: 'codewidget-submitted',
        ariaLabel: 'Tests submitted and passed',
      };
    }
    return {
      label: submission === 'submitting' ? 'Submitting…' : 'Submit',
      icon: <Check size={14} aria-hidden />,
      onClick: () => {
        void handleSubmit();
      },
      disabled: submitDisabled,
      variant: 'primary' as const,
      testId: 'codewidget-submit',
      ariaLabel: 'Submit code and run tests',
    };
  }, [submission, handleSubmit, submitDisabled]);

  const tests = data.tests;
  const showWarning = submission === 'submitted-fail' && results !== null;
  const placeholder =
    tests.length > 0
      ? 'Press ✓ Submit to run tests.'
      : 'Press ▶ Run to execute.';

  const extraPanel = (
    <div data-codewidget-tests style={panelWrapStyle}>
      <div style={headerRowStyle}>
        <span style={sectionLabelStyle}>
          Tests · {results ? `${passedCount}/${total} passed` : `${total} test${total === 1 ? '' : 's'}`}
        </span>
        {tests.length > 0 && (
          <button
            type="button"
            data-codewidget-toggle-all
            onClick={toggleAll}
            style={toggleAllButtonStyle}
            aria-label={allExpanded ? 'Hide all tests' : 'Show all tests'}
          >
            {allExpanded ? 'Hide all tests' : 'Show all tests'}
          </button>
        )}
      </div>

      {(stdout || stderr || traceback) && (
        <div data-codewidget-output>
          <button
            type="button"
            data-codewidget-output-toggle
            data-testid="codewidget-output-toggle"
            aria-expanded={!outputCollapsed}
            onClick={() => setOutputCollapsed((v) => !v)}
            style={outputToggleButtonStyle}
          >
            {outputCollapsed ? (
              <ChevronRight size={12} aria-hidden />
            ) : (
              <ChevronDown size={12} aria-hidden />
            )}
            Output
          </button>
          {!outputCollapsed && (
            <div style={outputContentStyle}>
              {stdout && (
                <pre data-codewidget-stdout style={stdoutStyle}>
                  {stdout}
                </pre>
              )}
              {stderr && (
                <div data-codewidget-stderr style={stderrBlockStyle}>
                  <span style={stderrLabelStyle}>stderr</span>
                  <pre style={{ margin: 0, fontFamily: 'inherit' }}>{stderr}</pre>
                </div>
              )}
              {traceback && (
                <div data-codewidget-exception style={exceptionBlockStyle}>
                  <p
                    data-testid="codewidget-error-headline"
                    data-error-type={errorType ?? ''}
                    style={exceptionHeadlineStyle}
                  >
                    {(errorType ?? 'Error') +
                      (errorMessage ? `: ${errorMessage}` : '')}
                  </p>
                  <button
                    type="button"
                    data-testid="codewidget-traceback-toggle"
                    aria-expanded={tracebackOpen}
                    onClick={() => setTracebackOpen((v) => !v)}
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
                    <pre data-testid="codewidget-traceback" style={tracebackPreStyle}>
                      {traceback}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={testListStyle}>
        {tests.map((test, i) => (
          <TestRow
            key={`${i}-${test.name}`}
            index={i}
            test={test}
            result={results?.[i]}
            expanded={Boolean(expanded[i])}
            onToggle={() => toggleOne(i)}
            submitted={submission !== 'idle' && submission !== 'submitting'}
          />
        ))}
      </div>

      {showWarning && (
        <div data-codewidget-warning>
          <Callout tone="warning">
            {passedCount} of {total} test{total === 1 ? '' : 's'} passed — keep going.
          </Callout>
        </div>
      )}

      {data.solution && (
        <>
          <div style={peekRowStyle}>
            <button
              type="button"
              data-testid="codewidget-peek-solution"
              data-codewidget-peek
              aria-expanded={solutionOpen}
              aria-controls={solutionPanelId}
              onClick={() => setSolutionOpen((v) => !v)}
              style={peekButtonStyle}
            >
              {solutionOpen ? (
                <EyeOff size={14} aria-hidden />
              ) : (
                <Eye size={14} aria-hidden />
              )}
              {solutionOpen ? 'Hide solution' : 'Peek solution'}
            </button>
          </div>
          {solutionOpen && (
            <div
              id={solutionPanelId}
              data-testid="codewidget-solution-panel"
              data-codewidget-solution
              style={solutionPanelStyle}
            >
              <div style={solutionLabelStyle}>Reference solution</div>
              <ReadOnlySolutionEditor source={data.solution} />
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div ref={confettiOriginRef} data-codewidget-root>
      <Confetti trigger={confettiTrigger} originRef={confettiOriginRef} />
      <CodeRunner
        starterCode={data.starterCode}
        initialCode={initialCode}
        progressKey={progressKey}
        onCodeChange={setCode}
        onReset={handleReset}
        extraPanel={extraPanel}
        primaryAction={tests.length > 0 ? primaryAction : undefined}
        outputPlaceholder={placeholder}
        actionRunning={submission === 'submitting'}
      />
    </div>
  );
}

async function patchSectionDone(
  key: CodeRunnerProgressKey,
  userCode: string,
): Promise<void> {
  try {
    await fetch('/api/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseSlug: key.courseSlug,
        lessonSlug: key.lessonSlug,
        sectionState: { [key.sectionId]: { userCode, done: true } },
      }),
    });
  } catch {
    // Persistence is non-fatal — UI still reflects success in-session.
  }
}
