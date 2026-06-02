'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Check, ChevronDown, ChevronRight, Circle, Eye, EyeOff, Play, X } from 'lucide-react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { python } from '@codemirror/lang-python';

import { Callout } from '@/components/Callout';
import { Confetti } from '@/components/Confetti';
import {
  KernelStopError,
  useKernel,
  type KernelSessionKey,
  type PyodideInputFile,
  type RunWithTestsResult,
  type TestResult,
} from '@/lib/kernel/client';

import { IORow } from '../common/IOPanel';
import {
  CodeRunner,
  codeRunnerEditorTheme,
  codeRunnerHighlightStyle,
  type CodeRunnerProgressKey,
} from './CodeRunner';
import type { CodeData, CodeTest } from './schema';
import { inputMountName } from './schema';

/** Session used when the widget is rendered without a lesson `progressKey`
 *  (e.g. previews / the CodeRunner test shell). Mirrors CodeRunner's fallback. */
const SCRATCH_SESSION: KernelSessionKey = {
  courseSlug: 'scratch',
  lessonSlug: 'scratch',
  sectionId: 'scratch',
};

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

const containerToggleButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  cursor: 'pointer',
  color: 'var(--text-tertiary)',
  textAlign: 'left',
};

const containerBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
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
  fontSize: 'calc(12px * var(--text-scale, 1))',
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

const solutionWrapStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  borderTop: '1px solid var(--border)',
  padding: 'var(--space-3) var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

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
  // Submit + Run execute on the real per-lesson IPython kernel (US-202).
  // Session identity comes from `progressKey`; previews without one fall back
  // to a scratch session (parity with CodeRunner).
  const session = useMemo<KernelSessionKey>(
    () =>
      progressKey
        ? {
            courseSlug: progressKey.courseSlug,
            lessonSlug: progressKey.lessonSlug,
            sectionId: progressKey.sectionId,
          }
        : SCRATCH_SESSION,
    [progressKey],
  );
  const { status, runWithTests, checkPackages, stop } = useKernel(session);

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
  // Import names from `requiresPackages` that are NOT present in the runtime —
  // surfaced as an actionable "run setup" message (US-202 precondition check).
  const [missingPackages, setMissingPackages] = useState<string[]>([]);
  // Set when a kernel run is stopped by the user or hits the 30s timeout.
  const [stopReason, setStopReason] = useState<'user' | 'timeout' | null>(null);
  const [solutionOpen, setSolutionOpen] = useState(false);
  const [containerCollapsed, setContainerCollapsed] = useState(true);
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  const confettiOriginRef = useRef<HTMLDivElement | null>(null);
  const confettiFiredRef = useRef(false);
  const solutionPanelId = useId();
  const containerBodyId = useId();

  const liveCaptureEnabled =
    data.outputMedia?.kind === 'image' && data.outputMedia.live === true;
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

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const passedCount = useMemo(
    () => (results ? results.filter((r) => r.passed).length : 0),
    [results],
  );
  const total = data.tests.length;

  // Lesson-provided files that the Pyodide worker should mount into
  // `/inputs/<filename>` before user code runs. Skips `kind: 'text'` and any
  // input whose filename can't be resolved (no explicit filename + opaque
  // src). Used by both Submit and ▶ Run code paths.
  const workerInputs = useMemo<PyodideInputFile[]>(() => {
    if (!data.inputs?.length) return [];
    const out: PyodideInputFile[] = [];
    for (const input of data.inputs) {
      const filename = inputMountName(input);
      if (!filename) continue;
      if (input.kind === 'text') continue;
      out.push({ filename, src: input.src });
    }
    return out;
  }, [data.inputs]);

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

  // Precondition check (US-202): `requiresPackages` declares packages that must
  // already be installed in the runtime (via the US-196 setup). We verify they
  // are importable BEFORE running — we never pip-install during a run. Returns
  // true when it is safe to proceed.
  const ensurePackages = useCallback(async (): Promise<boolean> => {
    const pkgs = data.requiresPackages;
    if (!pkgs || pkgs.length === 0) {
      setMissingPackages([]);
      return true;
    }
    const missing = await checkPackages(pkgs);
    setMissingPackages(missing);
    return missing.length === 0;
  }, [data.requiresPackages, checkPackages]);

  const handleSubmit = useCallback(async () => {
    if (status !== 'ready' && status !== 'idle') return;
    if (submission === 'submitting') return;
    setSubmission('submitting');
    setStopReason(null);
    setOutputCollapsed(false);
    setTracebackOpen(false);
    try {
      // Precondition: bail out with an actionable message if a declared
      // package is missing — without ever installing it at run time.
      if (!(await ensurePackages())) {
        setSubmission('idle');
        return;
      }
      const result: RunWithTestsResult = await runWithTests(
        code,
        data.tests.map((t) => ({ name: t.name, body: t.body })),
        {
          captureLiveImage: liveCaptureEnabled || undefined,
          inputs: workerInputs.length > 0 ? workerInputs : undefined,
        },
      );
      setStdout(result.stdout ?? '');
      setStderr(result.stderr ?? '');
      setTraceback(result.traceback);
      setErrorType(result.errorType);
      setErrorMessage(result.errorMessage);
      const tr = result.testResults ?? [];
      setResults(tr);
      if (liveCaptureEnabled && result.png && result.png instanceof Uint8Array) {
        const blob = new Blob([result.png as BlobPart], { type: 'image/png' });
        setLivePng(URL.createObjectURL(blob));
      }
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
      if (err instanceof KernelStopError) {
        // User-stop or 30s timeout: the kernel stays alive. Surface the stop
        // banner and reset our local submission state so the user can retry.
        setStopReason(err.reason);
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
  }, [
    code,
    data.tests,
    ensurePackages,
    runWithTests,
    status,
    submission,
    progressKey,
    alreadyCompleted,
    liveCaptureEnabled,
    setLivePng,
    workerInputs,
  ]);

  // No-tests + live-capture path (US-174): clicking Run does not submit any
  // tests, just runs user code through the live-capture worker path so the
  // matplotlib figure swaps the placeholder image.
  const handleLiveRun = useCallback(async () => {
    if (status !== 'ready' && status !== 'idle') return;
    if (submission === 'submitting') return;
    setSubmission('submitting');
    setStopReason(null);
    setOutputCollapsed(false);
    setTracebackOpen(false);
    try {
      if (!(await ensurePackages())) {
        setSubmission('idle');
        return;
      }
      const result: RunWithTestsResult = await runWithTests(code, [], {
        captureLiveImage: true,
        inputs: workerInputs.length > 0 ? workerInputs : undefined,
      });
      setStdout(result.stdout ?? '');
      setStderr(result.stderr ?? '');
      setTraceback(result.traceback);
      setErrorType(result.errorType);
      setErrorMessage(result.errorMessage);
      if (result.png && result.png instanceof Uint8Array) {
        const blob = new Blob([result.png as BlobPart], { type: 'image/png' });
        setLivePng(URL.createObjectURL(blob));
      }
      setResults(null);
      setSubmission(result.traceback ? 'submitted-fail' : 'idle');
    } catch (err) {
      if (err instanceof KernelStopError) {
        setStopReason(err.reason);
        setSubmission('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setStdout('');
      setStderr('');
      setTraceback(msg);
      setErrorType(err instanceof Error ? err.name : undefined);
      setErrorMessage(msg);
      setSubmission('submitted-fail');
    }
  }, [
    code,
    ensurePackages,
    runWithTests,
    status,
    submission,
    setLivePng,
    workerInputs,
  ]);

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
    setMissingPackages([]);
    setStopReason(null);
    setLivePng(null);
  }, [setLivePng]);

  // The kernel is runnable from `idle` (first run lazily boots it) as well as
  // `ready`; only a mid-spawn `loading` / hard `error` blocks a fresh run.
  const runnable = status === 'ready' || status === 'idle';
  const submitDisabled = !runnable || submission === 'submitting';

  const primaryAction = useMemo(
    () => ({
      label: submission === 'submitting' ? 'Submitting…' : 'Submit',
      icon: <Check size={14} aria-hidden />,
      onClick: () => {
        void handleSubmit();
      },
      disabled: submitDisabled,
      variant: 'primary' as const,
      testId: 'codewidget-submit',
      ariaLabel: 'Submit code and run tests',
    }),
    [submission, handleSubmit, submitDisabled],
  );

  const liveRunDisabled = !runnable || submission === 'submitting';
  const liveRunAction = useMemo(
    () => ({
      label: submission === 'submitting' ? 'Running…' : 'Run',
      icon: <Play size={14} aria-hidden />,
      onClick: () => {
        void handleLiveRun();
      },
      disabled: liveRunDisabled,
      variant: 'secondary' as const,
      testId: 'codewidget-run',
      ariaLabel: 'Run code and capture matplotlib figure',
    }),
    [handleLiveRun, liveRunDisabled, submission],
  );

  const tests = data.tests;
  const showWarning = submission === 'submitted-fail' && results !== null;
  const placeholder =
    tests.length > 0
      ? 'Press ✓ Submit to run tests.'
      : 'Press ▶ Run to execute.';

  const containerSummary = results
    ? `${passedCount}/${total} passed`
    : `${total} test${total === 1 ? '' : 's'}`;
  const containerState: 'pass' | 'fail' | 'untested' = results
    ? passedCount === total
      ? 'pass'
      : 'fail'
    : 'untested';

  const handleToggleAll = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    toggleAll();
  };

  const extraPanel = (
    <>
      {missingPackages.length > 0 && (
        <div
          data-codewidget-missing-packages
          data-packages={missingPackages.join(',')}
          style={panelWrapStyle}
        >
          <Callout tone="warning">
            {missingPackages.length === 1
              ? `Missing package: ${missingPackages[0]} — run setup to install it before submitting.`
              : `Missing packages: ${missingPackages.join(', ')} — run setup to install them before submitting.`}
          </Callout>
        </div>
      )}
      {stopReason && (
        <div
          data-codewidget-stop
          data-stop-reason={stopReason}
          style={panelWrapStyle}
        >
          <Callout tone="warning">
            {stopReason === 'timeout'
              ? 'Execution timed out after 30s. The kernel was interrupted — try again.'
              : 'Execution stopped.'}
          </Callout>
        </div>
      )}
      <div
        data-codewidget-tests
        data-container-collapsed={containerCollapsed ? 'true' : 'false'}
        style={panelWrapStyle}
      >
        <div style={headerRowStyle}>
          <button
            type="button"
            data-codewidget-container-toggle
            data-testid="codewidget-tests-container-toggle"
            data-state={containerState}
            aria-expanded={!containerCollapsed}
            aria-controls={containerBodyId}
            onClick={() => setContainerCollapsed((v) => !v)}
            style={containerToggleButtonStyle}
          >
            {containerCollapsed ? (
              <ChevronRight size={12} aria-hidden style={{ flexShrink: 0 }} />
            ) : (
              <ChevronDown size={12} aria-hidden style={{ flexShrink: 0 }} />
            )}
            <span style={sectionLabelStyle}>Tests · {containerSummary}</span>
          </button>
          {!containerCollapsed && tests.length > 0 && (
            <button
              type="button"
              data-codewidget-toggle-all
              onClick={handleToggleAll}
              style={toggleAllButtonStyle}
              aria-label={allExpanded ? 'Hide all tests' : 'Show all tests'}
            >
              {allExpanded ? 'Hide all tests' : 'Show all tests'}
            </button>
          )}
        </div>

        {!containerCollapsed && (
          <div id={containerBodyId} data-codewidget-tests-body style={containerBodyStyle}>
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
          </div>
        )}
      </div>

      {data.solution && (
        <div data-codewidget-solution-wrap style={solutionWrapStyle}>
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
        </div>
      )}
    </>
  );

  const inputs = data.inputs ?? [];
  const outputMedia = data.outputMedia;
  // When tests are present, Submit handles execution. With no tests + live
  // capture, surface a Run button that drives runWithTests with no tests so
  // the figure capture path still fires.
  const resolvedPrimaryAction =
    tests.length > 0
      ? primaryAction
      : liveCaptureEnabled
        ? liveRunAction
        : undefined;

  return (
    <div ref={confettiOriginRef} data-codewidget-root>
      <Confetti trigger={confettiTrigger} originRef={confettiOriginRef} />
      <IORow
        inputs={inputs}
        outputMedia={outputMedia}
        outputDisplaySrc={liveCaptureEnabled ? livePngUrl ?? undefined : undefined}
        outputPlaceholderCaption={
          liveCaptureEnabled
            ? '# placeholder showing what your output should look like'
            : undefined
        }
      />
      <CodeRunner
        starterCode={data.starterCode}
        initialCode={initialCode}
        progressKey={progressKey}
        onCodeChange={setCode}
        onReset={handleReset}
        extraPanel={extraPanel}
        primaryAction={resolvedPrimaryAction}
        outputPlaceholder={placeholder}
        actionRunning={submission === 'submitting'}
        runRequiresPackages={data.requiresPackages}
        runInputs={workerInputs.length > 0 ? workerInputs : undefined}
        onStop={stop}
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
