'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Check, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { Callout } from '@/components/Callout';
import {
  PyodideStopError,
  usePyodide,
  type RunWithTestsResult,
  type TestResult,
} from '@/lib/pyodide/client';

import {
  CodeClozeDataSchema,
  validateSlotValue,
  type CodeClozeData,
  type CodeClozeSlot,
} from './schema';
import {
  commentPrefix,
  formatFeedbackComment,
  groupSegmentsIntoLines,
  lineHasExistingComment,
} from './feedbackComment';

export interface CodeClozeProgressKey {
  courseSlug: string;
  lessonSlug: string;
  sectionId: string;
}

export interface CodeClozeWidgetProps {
  data: CodeClozeData;
  progressKey?: CodeClozeProgressKey;
  onComplete?: () => void;
}

type SlotState = 'idle' | 'correct' | 'incorrect';

type TemplateSegment =
  | { kind: 'text'; content: string }
  | { kind: 'slot'; slotId: string };

const SLOT_PATTERN = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

function parseTemplate(template: string): TemplateSegment[] {
  const out: TemplateSegment[] = [];
  let lastIndex = 0;
  SLOT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SLOT_PATTERN.exec(template)) !== null) {
    if (match.index > lastIndex) {
      out.push({ kind: 'text', content: template.slice(lastIndex, match.index) });
    }
    out.push({ kind: 'slot', slotId: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < template.length) {
    out.push({ kind: 'text', content: template.slice(lastIndex) });
  }
  return out;
}

const PY_KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
  'self',
]);

const PY_BUILTINS = new Set([
  'abs',
  'all',
  'any',
  'bool',
  'dict',
  'enumerate',
  'filter',
  'float',
  'int',
  'len',
  'list',
  'map',
  'max',
  'min',
  'print',
  'range',
  'round',
  'set',
  'sorted',
  'str',
  'sum',
  'tuple',
  'type',
  'zip',
]);

type TokenKind = 'kw' | 'str' | 'num' | 'cm' | 'fn' | 'plain' | 'builtin';

interface Token {
  kind: TokenKind;
  text: string;
}

function tokenizePython(src: string): Token[] {
  const tokens: Token[] = [];
  const len = src.length;
  let i = 0;
  while (i < len) {
    const c = src[i];

    if (c === '#') {
      const j = src.indexOf('\n', i);
      const end = j === -1 ? len : j;
      tokens.push({ kind: 'cm', text: src.slice(i, end) });
      i = end;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < len && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < len) j += 2;
        else j++;
      }
      if (j < len) j++;
      tokens.push({ kind: 'str', text: src.slice(i, j) });
      i = j;
      continue;
    }

    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < len && /[0-9._]/.test(src[j])) j++;
      tokens.push({ kind: 'num', text: src.slice(i, j) });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < len && /[A-Za-z_0-9]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (PY_KEYWORDS.has(word)) {
        tokens.push({ kind: 'kw', text: word });
      } else if (PY_BUILTINS.has(word) && src[j] === '(') {
        tokens.push({ kind: 'builtin', text: word });
      } else if (src[j] === '(') {
        tokens.push({ kind: 'fn', text: word });
      } else {
        tokens.push({ kind: 'plain', text: word });
      }
      i = j;
      continue;
    }

    tokens.push({ kind: 'plain', text: c });
    i++;
  }
  return tokens;
}

function tokenStyle(kind: TokenKind): CSSProperties | undefined {
  switch (kind) {
    case 'kw':
      return { color: 'var(--code-keyword)', fontWeight: 500 };
    case 'str':
      return { color: 'var(--code-string)' };
    case 'cm':
      return { color: 'var(--code-comment)', fontStyle: 'italic' };
    case 'num':
      return { color: 'var(--code-number)' };
    case 'fn':
    case 'builtin':
      return { color: 'var(--code-fn)' };
    default:
      return undefined;
  }
}

function renderHighlighted(text: string, keyPrefix: string): ReactNode[] {
  const tokens = tokenizePython(text);
  return tokens.map((tok, i) => {
    const style = tokenStyle(tok.kind);
    if (!style) return <span key={`${keyPrefix}-${i}`}>{tok.text}</span>;
    return (
      <span key={`${keyPrefix}-${i}`} style={style}>
        {tok.text}
      </span>
    );
  });
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const taskStyle: CSSProperties = {
  padding: 'var(--space-4) var(--space-5)',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  lineHeight: 1.6,
};

const codeBlockStyle: CSSProperties = {
  background: 'var(--code-bg)',
  color: 'var(--code-text)',
  fontFamily: 'var(--font-mono)',
  fontSize: '13px',
  lineHeight: 1.55,
  padding: 'var(--space-4) var(--space-5)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0,
  overflowX: 'auto',
};

const slotInputBase: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '13px',
  lineHeight: 1.55,
  padding: '0 6px',
  margin: '0 1px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-elevated)',
  outline: 'none',
  verticalAlign: 'baseline',
  boxSizing: 'border-box',
  height: '1.55em',
};

function slotBorder(state: SlotState): string {
  if (state === 'correct') return '1px solid var(--success-border)';
  if (state === 'incorrect') return '1px solid var(--danger-border)';
  return '1px solid var(--border-strong)';
}

function slotBackground(state: SlotState): string {
  if (state === 'correct') return 'var(--success-subtle)';
  if (state === 'incorrect') return 'var(--danger-subtle)';
  return 'var(--bg-elevated)';
}

const slotIconStyle: CSSProperties = {
  display: 'inline-block',
  marginLeft: 4,
  verticalAlign: 'middle',
};

const feedbackCommentStyle: CSSProperties = {
  color: 'var(--code-comment)',
  fontStyle: 'italic',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-5)',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};

const statusLabelStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
};

const submitButtonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 var(--space-4)',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  cursor: 'pointer',
};

const hintsBlockStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-subtle)',
  padding: 'var(--space-3) var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
};

const hintLabelStyle: CSSProperties = {
  ...statusLabelStyle,
  marginBottom: 4,
};

const hintBodyStyle: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  lineHeight: 1.55,
};

const finalTestsBlockStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-subtle)',
  padding: 'var(--space-3) var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
};

const testRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  color: 'var(--text)',
};

function widthForValue(value: string): string {
  const ch = Math.max(value.length, 4);
  return `calc(${ch}ch + 16px)`;
}

interface SlotInputProps {
  slot: CodeClozeSlot;
  value: string;
  state: SlotState;
  disabled: boolean;
  onChange: (slotId: string, value: string) => void;
  onBlur: (slotId: string) => void;
}

function SlotInput({
  slot,
  value,
  state,
  disabled,
  onChange,
  onBlur,
}: SlotInputProps) {
  const inputStyle: CSSProperties = {
    ...slotInputBase,
    width: widthForValue(value),
    minWidth: 60,
    border: slotBorder(state),
    background: slotBackground(state),
    color: 'var(--code-text)',
  };

  return (
    <span
      style={{
        display: 'inline-block',
        verticalAlign: 'baseline',
        whiteSpace: 'nowrap',
      }}
    >
      <input
        type="text"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        data-testid={`cloze-slot-${slot.id}`}
        data-slot-id={slot.id}
        data-slot-state={state}
        aria-label={`Slot ${slot.id}`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(slot.id, e.target.value)}
        onBlur={() => onBlur(slot.id)}
        style={inputStyle}
      />
      {state === 'correct' && (
        <Check
          size={12}
          aria-hidden
          strokeWidth={2.5}
          data-testid={`cloze-slot-icon-${slot.id}`}
          data-icon="correct"
          style={{ ...slotIconStyle, color: 'var(--success)' }}
        />
      )}
      {state === 'incorrect' && (
        <X
          size={12}
          aria-hidden
          strokeWidth={2.5}
          data-testid={`cloze-slot-icon-${slot.id}`}
          data-icon="incorrect"
          style={{ ...slotIconStyle, color: 'var(--danger)' }}
        />
      )}
    </span>
  );
}

export function CodeClozeWidget({
  data: rawData,
  progressKey,
  onComplete,
}: CodeClozeWidgetProps) {
  const data = useMemo(() => CodeClozeDataSchema.parse(rawData), [rawData]);
  const segments = useMemo(() => parseTemplate(data.template), [data.template]);
  const lines = useMemo(() => groupSegmentsIntoLines(segments), [segments]);
  const langPrefix = useMemo(() => commentPrefix(data.language), [data.language]);

  const slotById = useMemo(() => {
    const m = new Map<string, CodeClozeSlot>();
    for (const s of data.slots) m.set(s.id, s);
    return m;
  }, [data.slots]);

  const initialValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of data.slots) out[s.id] = '';
    return out;
  }, [data.slots]);

  const initialStates = useMemo(() => {
    const out: Record<string, SlotState> = {};
    for (const s of data.slots) out[s.id] = 'idle';
    return out;
  }, [data.slots]);

  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [slotStates, setSlotStates] =
    useState<Record<string, SlotState>>(initialStates);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [submission, setSubmission] = useState<
    'idle' | 'running' | 'pass' | 'fail'
  >('idle');
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);
  const [traceback, setTraceback] = useState<string | null>(null);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const { status, runWithTests } = usePyodide();

  const finalTests = useMemo(() => data.finalTests ?? [], [data.finalTests]);
  const hints = useMemo(() => data.hints ?? [], [data.hints]);

  const allSlotsCorrect =
    data.slots.length > 0 &&
    data.slots.every((s) => slotStates[s.id] === 'correct');

  const revealedHints = useMemo(() => {
    return hints.filter((h) => failedAttempts >= h.revealAfterAttempts);
  }, [hints, failedAttempts]);

  const handleChange = useCallback((slotId: string, next: string) => {
    setValues((prev) => ({ ...prev, [slotId]: next }));
    setSlotStates((prev) => {
      if (prev[slotId] === 'idle') return prev;
      return { ...prev, [slotId]: 'idle' };
    });
  }, []);

  const handleBlur = useCallback(
    (slotId: string) => {
      const slot = slotById.get(slotId);
      if (!slot) return;
      const value = values[slotId] ?? '';
      if (value.length === 0) {
        setSlotStates((prev) =>
          prev[slotId] === 'idle' ? prev : { ...prev, [slotId]: 'idle' },
        );
        return;
      }
      const ok = validateSlotValue(slot.validation, value);
      setSlotStates((prev) => ({
        ...prev,
        [slotId]: ok ? 'correct' : 'incorrect',
      }));
      if (!ok) {
        setFailedAttempts((n) => n + 1);
      }
    },
    [slotById, values],
  );

  const assembleCode = useCallback((): string => {
    return data.template.replace(SLOT_PATTERN, (_match, slotId: string) => {
      return values[slotId] ?? '';
    });
  }, [data.template, values]);

  const runFinalTests = useCallback(async () => {
    if (status !== 'ready') return;
    if (finalTests.length === 0) {
      setSubmission('pass');
      if (progressKey) void patchSectionDone(progressKey);
      onCompleteRef.current?.();
      return;
    }
    setSubmission('running');
    setTraceback(null);
    setTestResults(null);
    try {
      const result: RunWithTestsResult = await runWithTests(
        assembleCode(),
        finalTests.map((t) => ({ name: t.name, body: t.body })),
      );
      const tr = result.testResults ?? [];
      setTestResults(tr);
      setTraceback(result.traceback ?? null);
      const passed = tr.length > 0 && tr.every((r) => r.passed);
      if (passed) {
        setSubmission('pass');
        if (progressKey) void patchSectionDone(progressKey);
        onCompleteRef.current?.();
      } else {
        setSubmission('fail');
      }
    } catch (err) {
      if (err instanceof PyodideStopError) {
        setSubmission('idle');
        return;
      }
      setTraceback(err instanceof Error ? err.message : String(err));
      setSubmission('fail');
    }
  }, [assembleCode, finalTests, progressKey, runWithTests, status]);

  const submitDisabled =
    !allSlotsCorrect ||
    submission === 'running' ||
    submission === 'pass' ||
    (finalTests.length > 0 && status !== 'ready');

  const submitButtonStyle: CSSProperties = useMemo(() => {
    if (submission === 'pass') {
      return {
        ...submitButtonBase,
        background: 'transparent',
        border: '1px solid var(--success-border)',
        color: 'var(--success)',
        cursor: 'default',
      };
    }
    return {
      ...submitButtonBase,
      background: submitDisabled ? 'var(--bg-active)' : 'var(--accent)',
      color: submitDisabled ? 'var(--text-tertiary)' : 'var(--text-on-accent)',
      cursor: submitDisabled ? 'not-allowed' : 'pointer',
      opacity: submitDisabled ? 0.7 : 1,
    };
  }, [submission, submitDisabled]);

  const slotsCorrectCount = useMemo(
    () => data.slots.filter((s) => slotStates[s.id] === 'correct').length,
    [data.slots, slotStates],
  );

  return (
    <div data-cloze-body style={wrapStyle}>
      {data.taskMarkdown && (
        <div data-cloze-task style={taskStyle}>
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {data.taskMarkdown}
          </ReactMarkdown>
        </div>
      )}

      <pre data-cloze-template style={codeBlockStyle}>
        {lines.map((lineSegs, lineIdx) => {
          const errorHints: string[] = [];
          for (const seg of lineSegs) {
            if (seg.kind !== 'slot') continue;
            const slot = slotById.get(seg.slotId);
            if (!slot) continue;
            if ((slotStates[seg.slotId] ?? 'idle') !== 'incorrect') continue;
            if (!slot.hint) continue;
            errorHints.push(slot.hint);
          }
          const hasComment = lineHasExistingComment(lineSegs, langPrefix);
          const feedback = formatFeedbackComment(
            errorHints,
            langPrefix,
            hasComment,
          );
          const isLastLine = lineIdx === lines.length - 1;
          return (
            <span key={`line-${lineIdx}`} data-cloze-line data-line-index={lineIdx}>
              {lineSegs.map((seg, idx) => {
                if (seg.kind === 'text') {
                  return (
                    <span key={`l-${lineIdx}-t-${idx}`} data-cloze-text>
                      {renderHighlighted(seg.content, `l-${lineIdx}-t-${idx}`)}
                    </span>
                  );
                }
                const slot = slotById.get(seg.slotId);
                if (!slot) {
                  return (
                    <span
                      key={`l-${lineIdx}-s-${idx}`}
                      data-cloze-missing-slot
                      style={{ color: 'var(--danger)', fontStyle: 'italic' }}
                    >
                      {`{{${seg.slotId}}}`}
                    </span>
                  );
                }
                return (
                  <SlotInput
                    key={`l-${lineIdx}-s-${idx}-${slot.id}`}
                    slot={slot}
                    value={values[slot.id] ?? ''}
                    state={slotStates[slot.id] ?? 'idle'}
                    disabled={submission === 'pass'}
                    onChange={handleChange}
                    onBlur={handleBlur}
                  />
                );
              })}
              {feedback && (
                <span
                  data-testid={`cloze-line-feedback-${lineIdx}`}
                  data-cloze-feedback
                  style={feedbackCommentStyle}
                >
                  {feedback}
                </span>
              )}
              {!isLastLine && '\n'}
            </span>
          );
        })}
      </pre>

      {revealedHints.length > 0 && (
        <div data-cloze-hints style={hintsBlockStyle}>
          <div style={hintLabelStyle}>Progressive hints</div>
          {revealedHints.map((h, i) => (
            <div
              key={i}
              data-testid={`cloze-progressive-hint-${i}`}
              style={hintBodyStyle}
            >
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {h.markdown}
              </ReactMarkdown>
            </div>
          ))}
        </div>
      )}

      {submission === 'fail' && testResults && (
        <div data-cloze-final-tests style={finalTestsBlockStyle}>
          <div style={statusLabelStyle}>Final tests</div>
          {testResults.map((r, i) => (
            <div
              key={i}
              data-testid={`cloze-final-test-${i}`}
              data-state={r.passed ? 'pass' : 'fail'}
              style={testRowStyle}
            >
              {r.passed ? (
                <Check size={12} aria-hidden style={{ color: 'var(--success)' }} />
              ) : (
                <X size={12} aria-hidden style={{ color: 'var(--danger)' }} />
              )}
              <span>{r.name}</span>
              {!r.passed && r.assertionDetail && (
                <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>
                  — {r.assertionDetail}
                </span>
              )}
            </div>
          ))}
          {traceback && (
            <pre
              data-testid="cloze-final-traceback"
              style={{
                margin: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-sm)',
                color: 'var(--danger)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {traceback}
            </pre>
          )}
        </div>
      )}

      {submission === 'fail' && !testResults && traceback && (
        <div data-cloze-final-tests style={finalTestsBlockStyle}>
          <Callout tone="danger" title="Execution error">
            <pre
              style={{
                margin: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-sm)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {traceback}
            </pre>
          </Callout>
        </div>
      )}

      <div style={footerStyle}>
        <span style={statusLabelStyle} data-testid="cloze-status">
          {submission === 'pass'
            ? 'Solved'
            : `${slotsCorrectCount}/${data.slots.length} slot${data.slots.length === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          data-testid="cloze-submit"
          onClick={() => void runFinalTests()}
          disabled={submitDisabled}
          aria-label={
            submission === 'pass' ? 'Tests passed' : 'Run final tests'
          }
          style={submitButtonStyle}
        >
          {submission === 'pass' ? (
            <>
              <Check size={14} aria-hidden /> Solved
            </>
          ) : submission === 'running' ? (
            'Running…'
          ) : (
            'Submit'
          )}
        </button>
      </div>
    </div>
  );
}

async function patchSectionDone(key: CodeClozeProgressKey): Promise<void> {
  try {
    await fetch('/api/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseSlug: key.courseSlug,
        lessonSlug: key.lessonSlug,
        sectionState: { [key.sectionId]: { done: true } },
      }),
    });
  } catch {
    // Persistence is non-fatal.
  }
}
