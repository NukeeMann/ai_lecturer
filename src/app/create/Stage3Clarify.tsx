'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { ArrowLeft, ArrowRight, RefreshCw, SkipForward, Sparkles } from 'lucide-react';
import type { Draft } from './Stage3Cascade';

export interface ClarificationQuestion {
  id: string;
  text: string;
}

interface Stage3ClarifyProps {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  onNext: () => void;
  onBack: () => void;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; questions: ClarificationQuestion[] }
  | { kind: 'error'; message: string };

export default function Stage3Clarify({
  draft,
  setDraft,
  onNext,
  onBack,
  fetchImpl,
}: Stage3ClarifyProps) {
  const [state, setState] = useState<LoadState>(
    draft.clarificationQuestions && draft.clarificationQuestions.length > 0
      ? { kind: 'ready', questions: draft.clarificationQuestions }
      : { kind: 'idle' },
  );
  const requestSeq = useRef(0);
  const f = fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);

  const loadQuestions = useCallback(async () => {
    if (!f) {
      setState({ kind: 'error', message: 'fetch is unavailable in this environment' });
      return;
    }
    const seq = ++requestSeq.current;
    setState({ kind: 'loading' });
    try {
      const res = await f('/api/wizard/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: draft.topic,
          refine: {
            level: draft.level,
            durationTarget: draft.durationTarget,
            theoryPracticeRatio: draft.theoryPracticeRatio,
          },
        }),
      });
      if (seq !== requestSeq.current) return;
      if (!res.ok) {
        let message = `Server returned ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body && typeof body.error === 'string') message = body.error;
        } catch {
          /* non-JSON body */
        }
        setState({ kind: 'error', message });
        return;
      }
      const body = (await res.json()) as { questions?: ClarificationQuestion[] };
      const questions = Array.isArray(body.questions) ? body.questions : [];
      if (questions.length === 0) {
        setState({
          kind: 'error',
          message: 'Claude returned no questions. Try again or skip.',
        });
        return;
      }
      setDraft((d) => ({
        ...d,
        clarificationQuestions: questions,
        // Preserve any answers the user has already typed during back-nav,
        // but seed with empty strings for any newly returned ids.
        clarification: {
          ...Object.fromEntries(questions.map((q) => [q.id, ''])),
          ...(d.clarification ?? {}),
        },
      }));
      setState({ kind: 'ready', questions });
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setState({ kind: 'error', message: (err as Error).message });
    }
  }, [draft.topic, draft.level, draft.durationTarget, draft.theoryPracticeRatio, f, setDraft]);

  // First-time entry: kick off a load if we don't already have questions.
  const initialLoadRef = useRef(false);
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    if (state.kind === 'idle') {
      void loadQuestions();
    }
  }, [state.kind, loadQuestions]);

  const handleAnswerChange = useCallback(
    (id: string, value: string) => {
      setDraft((d) => ({
        ...d,
        clarification: { ...(d.clarification ?? {}), [id]: value },
      }));
    },
    [setDraft],
  );

  const skipAll = useCallback(() => {
    // Persist empty answers for any questions we have, then advance.
    if (state.kind === 'ready') {
      setDraft((d) => {
        const next = { ...(d.clarification ?? {}) };
        for (const q of state.questions) {
          if (next[q.id] === undefined) next[q.id] = '';
        }
        return { ...d, clarification: next };
      });
    }
    onNext();
  }, [onNext, setDraft, state]);

  const proceed = useCallback(() => {
    onNext();
  }, [onNext]);

  const questions = state.kind === 'ready' ? state.questions : [];
  const answers = draft.clarification ?? {};

  const filledCount = useMemo(
    () => questions.filter((q) => (answers[q.id] ?? '').trim().length > 0).length,
    [questions, answers],
  );

  return (
    <div style={stageWrapStyle} data-testid="stage-clarify">
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--space-7) var(--space-6)',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 720,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-6)',
          }}
        >
          <header>
            <div
              data-testid="stage-clarify-eyebrow"
              style={{
                fontSize: 10.5,
                color: 'var(--accent-text)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Stage 3 of 6 · Clarification
            </div>
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-2xl)',
                fontWeight: 600,
                letterSpacing: '-0.02em',
              }}
            >
              A few questions before we draft
            </h1>
            <p
              style={{
                marginTop: 6,
                color: 'var(--text-secondary)',
                fontSize: 'var(--fs-sm)',
                lineHeight: 1.55,
              }}
            >
              Answer what you can — every question is optional. Your answers are
              forwarded to the structure stage so the outline matches your goals.
            </p>
          </header>

          {state.kind === 'loading' && (
            <div
              data-testid="stage-clarify-loading"
              style={{
                padding: 'var(--space-5)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-secondary)',
                fontSize: 'var(--fs-sm)',
              }}
            >
              <Sparkles size={14} strokeWidth={2} />
              Thinking up clarifying questions…
            </div>
          )}

          {state.kind === 'error' && (
            <div
              data-testid="stage-clarify-error"
              role="alert"
              style={errorBubbleStyle}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Couldn&apos;t generate questions
              </div>
              <div
                data-testid="stage-clarify-error-message"
                style={{ fontSize: 'var(--fs-xs)', lineHeight: 1.45 }}
              >
                {state.message}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  data-testid="stage-clarify-retry"
                  onClick={() => void loadQuestions()}
                  style={errorButtonStyle}
                >
                  <RefreshCw size={12} strokeWidth={2} />
                  Retry
                </button>
                <button
                  type="button"
                  data-testid="stage-clarify-skip-from-error"
                  onClick={skipAll}
                  style={errorButtonStyle}
                >
                  <SkipForward size={12} strokeWidth={2} />
                  Skip and continue
                </button>
              </div>
            </div>
          )}

          {state.kind === 'ready' && questions.length > 0 && (
            <ol
              data-testid="stage-clarify-questions"
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
              }}
            >
              {questions.map((q, i) => {
                const value = answers[q.id] ?? '';
                return (
                  <li
                    key={q.id}
                    data-testid={`stage-clarify-question-${q.id}`}
                    data-question-index={i + 1}
                  >
                    <label
                      htmlFor={`clarify-input-${q.id}`}
                      style={{
                        display: 'block',
                        fontSize: 'var(--fs-sm)',
                        fontWeight: 500,
                        color: 'var(--text)',
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: 'var(--text-tertiary)',
                          marginRight: 8,
                        }}
                      >
                        Q{String(i + 1).padStart(2, '0')}
                      </span>
                      {q.text}
                    </label>
                    <textarea
                      id={`clarify-input-${q.id}`}
                      data-testid={`stage-clarify-input-${q.id}`}
                      value={value}
                      onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                      rows={2}
                      placeholder="Your answer (optional)…"
                      style={textareaStyle}
                    />
                  </li>
                );
              })}
            </ol>
          )}

          {state.kind === 'ready' && (
            <div
              data-testid="stage-clarify-progress"
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {filledCount} of {questions.length} answered · all optional
            </div>
          )}
        </div>
      </div>

      {/* Sticky bottom bar */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          padding: 'var(--space-4) var(--space-6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
        }}
      >
        <button
          type="button"
          data-testid="wizard-back"
          onClick={onBack}
          style={ghostBtnStyle}
        >
          <ArrowLeft size={14} strokeWidth={2} />
          Back
        </button>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button
            type="button"
            data-testid="stage-clarify-skip"
            onClick={skipAll}
            style={ghostBtnStyle}
          >
            <SkipForward size={14} strokeWidth={2} />
            Skip all
          </button>
          <button
            type="button"
            data-testid="wizard-next"
            onClick={proceed}
            disabled={state.kind === 'loading'}
            style={primaryBtnStyle(state.kind === 'loading')}
          >
            Next
            <ArrowRight size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const stageWrapStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 64,
  padding: '10px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-elevated)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.5,
  resize: 'vertical',
  outline: 'none',
  boxSizing: 'border-box',
};

const errorBubbleStyle: CSSProperties = {
  padding: 'var(--space-4)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--danger-subtle, rgba(220, 38, 38, 0.08))',
  color: 'var(--danger, #b91c1c)',
  fontSize: 'var(--fs-sm)',
  border: '1px solid var(--danger, #fca5a5)',
};

const errorButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 30,
  padding: '0 12px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-xs)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const ghostBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 36,
  padding: '0 14px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  fontFamily: 'inherit',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

function primaryBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 36,
    padding: '0 18px',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    background: disabled ? 'var(--bg-active)' : 'var(--accent)',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text-on-accent)',
    fontSize: 'var(--fs-sm)',
    fontWeight: 500,
    fontFamily: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
    transition: 'background var(--t-fast), opacity var(--t-fast)',
  };
}
