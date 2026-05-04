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
import {
  computeStageInputHash,
  hasUserEdits,
  isStageStale,
  snapshotUpstreamHashes,
} from '@/lib/wizard/dependencies';

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
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
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
      setDraft((d) => {
        // Regeneration: the question set is fresh, so wipe stale answers
        // tied to no-longer-existent question ids.
        const next = {
          ...d,
          clarificationQuestions: questions,
          clarification: Object.fromEntries(questions.map((q) => [q.id, ''])),
        };
        const generatedHash = computeStageInputHash('clarification', next);
        return {
          ...next,
          caches: {
            ...(d.caches ?? {}),
            clarification: {
              upstreamHashes: snapshotUpstreamHashes('clarification', next),
              generatedHash,
            },
          },
        };
      });
      setState({ kind: 'ready', questions });
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setState({ kind: 'error', message: (err as Error).message });
    }
  }, [draft.topic, draft.level, draft.durationTarget, draft.theoryPracticeRatio, f, setDraft]);

  // First-time entry / stale-reopen: kick off a load (or surface a confirm
  // dialog if the user has typed answers we'd otherwise discard). The
  // ref-gate makes this a one-shot subscription pattern; eslint's
  // set-state-in-effect rule doesn't follow async/ref boundaries.
  const initialLoadRef = useRef(false);
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    if (state.kind === 'idle') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadQuestions();
      return;
    }
    const cache = draft.caches?.clarification;
    if (isStageStale('clarification', draft, cache)) {
      if (hasUserEdits('clarification', draft, cache)) {
        setConfirmRegenerate(true);
      } else {
        void loadQuestions();
      }
    }
  }, [state.kind, loadQuestions, draft]);

  const handleConfirmRegenerate = useCallback(() => {
    setConfirmRegenerate(false);
    void loadQuestions();
  }, [loadQuestions]);

  const handleKeepCurrent = useCallback(() => {
    setConfirmRegenerate(false);
    // Refresh the cache's upstreamHashes so we don't keep re-prompting on
    // every reopen, but keep the user's questions and answers intact.
    setDraft((d) => {
      const generatedHash = computeStageInputHash('clarification', d);
      return {
        ...d,
        caches: {
          ...(d.caches ?? {}),
          clarification: {
            upstreamHashes: snapshotUpstreamHashes('clarification', d),
            generatedHash,
          },
        },
      };
    });
  }, [setDraft]);

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
      {confirmRegenerate && (
        <ClarifyRegenerateDialog
          onConfirm={handleConfirmRegenerate}
          onCancel={handleKeepCurrent}
        />
      )}
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

// ─── Confirm-regenerate dialog ───────────────────────────────────────────────

function ClarifyRegenerateDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="wizard-regenerate-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-clarify-regenerate-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg, 12px)',
          padding: 'var(--space-5)',
          maxWidth: 440,
          margin: '0 var(--space-4)',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
        }}
      >
        <div
          id="wizard-clarify-regenerate-title"
          style={{
            fontSize: 'var(--fs-md)',
            fontWeight: 600,
            color: 'var(--text)',
            marginBottom: 8,
          }}
        >
          Upstream changed — regenerate Clarification?
        </div>
        <p
          data-testid="wizard-regenerate-body"
          style={{
            margin: 0,
            color: 'var(--text-secondary)',
            fontSize: 'var(--fs-sm)',
            lineHeight: 1.5,
          }}
        >
          Your edits will be lost.
        </p>
        <div
          style={{
            marginTop: 'var(--space-4)',
            display: 'flex',
            gap: 'var(--space-3)',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            data-testid="wizard-regenerate-cancel"
            onClick={onCancel}
            style={ghostBtnStyle}
          >
            Keep my edits
          </button>
          <button
            type="button"
            data-testid="wizard-regenerate-confirm"
            onClick={onConfirm}
            style={primaryBtnStyle(false)}
          >
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
