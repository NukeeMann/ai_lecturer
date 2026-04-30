'use client';

import { Fragment, useEffect, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import Stage3Cascade, { type Draft, type Level, type DurationTarget } from './Stage3Cascade';

const DEFAULT_DRAFT: Draft = {
  topic: '',
  level: null,
  durationTarget: null,
  theoryPracticeRatio: 50,
  structure: null,
};

const STAGES = [
  { id: 1, label: 'Topic' },
  { id: 2, label: 'Refine' },
  { id: 3, label: 'Structure' },
  { id: 4, label: 'Approve' },
  { id: 5, label: 'Generate' },
] as const;

const PLACEHOLDER_TOPICS = [
  'How neural networks learn from data',
  'Bayesian inference for engineers',
  'Linear algebra for machine learning',
  'How transformers work, end to end',
];

const SUGGESTION_TOPICS = [
  'Backpropagation',
  'Linear algebra for ML',
  'How GPT works',
  'Bayesian statistics',
];

const LEVEL_OPTIONS: { value: Level; label: string; description: string }[] = [
  { value: 'beginner', label: 'Beginner', description: 'Brand new to this topic' },
  { value: 'intermediate', label: 'Some experience', description: 'I dabbled but not deeply' },
  { value: 'advanced', label: 'I know the basics', description: 'Comfortable with the surface' },
];

const DURATION_OPTIONS: { value: DurationTarget; label: string }[] = [
  { value: '30min', label: '30 min' },
  { value: '1h', label: 'An hour' },
  { value: 'weekend', label: 'A weekend deep dive' },
];

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function ratioLabel(ratio: number): string {
  if (ratio < 34) return 'Mostly theory';
  if (ratio > 66) return 'Mostly practice';
  return 'Balanced';
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CreatePage() {
  const router = useRouter();
  const [stage, setStage] = useState<number>(1);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('topic');
    if (t && t.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft((d) => ({ ...d, topic: t }));
    }
  }, []);

  const goToDashboard = () => {
    if (draft.topic.trim().length > 0) {
      const ok = window.confirm('Discard this draft and return to the dashboard?');
      if (!ok) return;
    }
    router.push('/');
  };

  const handleStepperJump = (id: number) => {
    if (id < stage) setStage(id);
  };

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Stepper current={stage} onJump={handleStepperJump} />
      </header>
      <main style={mainStyle}>
        {stage === 1 && (
          <Stage1
            draft={draft}
            setDraft={setDraft}
            onNext={() => setStage(2)}
            onBack={goToDashboard}
          />
        )}
        {stage === 2 && (
          <Stage2
            draft={draft}
            setDraft={setDraft}
            onNext={() => setStage(3)}
            onBack={() => setStage(1)}
          />
        )}
        {stage === 3 && (
          <Stage3Cascade
            draft={draft}
            setDraft={setDraft}
            onNext={() => setStage(4)}
            onBack={() => setStage(2)}
          />
        )}
        {stage === 4 && (
          <Stage4Preview draft={draft} onBack={() => setStage(3)} />
        )}
        {stage === 5 && (
          <Stage5Placeholder onBack={() => setStage(4)} />
        )}
      </main>
    </div>
  );
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

function Stepper({ current, onJump }: { current: number; onJump: (id: number) => void }) {
  return (
    <div data-testid="wizard-stepper" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {STAGES.map((s, i) => {
        const done = s.id < current;
        const active = s.id === current;
        const future = s.id > current;
        const canJump = done;
        return (
          <Fragment key={s.id}>
            <button
              type="button"
              data-testid={`stepper-step-${s.id}`}
              data-step-state={done ? 'done' : active ? 'active' : 'future'}
              onClick={canJump ? () => onJump(s.id) : undefined}
              aria-current={active ? 'step' : undefined}
              disabled={future}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 10px 4px 4px',
                background: active ? 'var(--accent-subtle)' : 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-full)',
                cursor: canJump ? 'pointer' : 'default',
                color: active
                  ? 'var(--accent-text)'
                  : done
                    ? 'var(--text-secondary)'
                    : 'var(--text-tertiary)',
                fontSize: 'var(--fs-xs)',
                fontWeight: 500,
                fontFamily: 'inherit',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: done ? 'var(--success)' : active ? 'var(--accent)' : 'transparent',
                  border: future ? '1.5px solid var(--border-strong)' : 'none',
                  color: done || active ? 'white' : 'var(--text-tertiary)',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {done ? <Check size={12} strokeWidth={3} /> : s.id}
              </span>
              <span>{s.label}</span>
            </button>
            {i < STAGES.length - 1 && (
              <span
                aria-hidden
                style={{
                  width: 14,
                  height: 1,
                  background: done ? 'var(--success)' : 'var(--border-strong)',
                }}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// ─── Stage 1 — Topic ─────────────────────────────────────────────────────────

interface StageProps {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  onNext: () => void;
  onBack: () => void;
}

function Stage1({ draft, setDraft, onNext, onBack }: StageProps) {
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_TOPICS.length);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const wc = wordCount(draft.topic);
  const canNext = wc >= 3;

  return (
    <div style={stageWrapStyle}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 'var(--space-7) var(--space-6)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 640 }}>
          <div
            data-testid="stage1-eyebrow"
            style={{
              fontSize: 'var(--fs-sm)',
              color: 'var(--text-tertiary)',
              marginBottom: 14,
            }}
          >
            What do you want to learn?
          </div>
          <input
            type="text"
            data-testid="stage1-topic-input"
            value={draft.topic}
            onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
            placeholder={PLACEHOLDER_TOPICS[placeholderIdx]}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canNext) {
                e.preventDefault();
                onNext();
              }
            }}
            style={{
              width: '100%',
              padding: '12px 0',
              border: 'none',
              borderBottom: '1px solid var(--border-strong)',
              background: 'transparent',
              color: 'var(--text)',
              fontSize: 'var(--fs-2xl)',
              fontWeight: 500,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <div
            style={{
              marginTop: 'var(--space-5)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            {SUGGESTION_TOPICS.map((s) => (
              <button
                key={s}
                type="button"
                data-testid="stage1-suggestion-chip"
                onClick={() => setDraft((d) => ({ ...d, topic: s }))}
                style={chipStyle(false)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
      <Footer onBack={onBack} onNext={onNext} canNext={canNext} backLabel="Back" />
    </div>
  );
}

// ─── Stage 2 — Refinement ────────────────────────────────────────────────────

function Stage2({ draft, setDraft, onNext, onBack }: StageProps) {
  const canNext = draft.level !== null && draft.durationTarget !== null;

  return (
    <div style={stageWrapStyle}>
      <div
        style={{
          flex: 1,
          padding: 'var(--space-7) var(--space-6)',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 720,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-7)',
          }}
        >
          {/* Level */}
          <section>
            <h2 style={sectionHeadingStyle}>What&apos;s your level?</h2>
            <div
              data-testid="stage2-level-group"
              role="radiogroup"
              aria-label="Your level"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'var(--space-3)',
              }}
            >
              {LEVEL_OPTIONS.map((opt) => {
                const selected = draft.level === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`stage2-level-${opt.value}`}
                    data-selected={selected}
                    onClick={() => setDraft((d) => ({ ...d, level: opt.value }))}
                    style={radioCardStyle(selected)}
                  >
                    <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>{opt.label}</span>
                    <span
                      style={{
                        fontSize: 'var(--fs-xs)',
                        color: selected ? 'var(--accent-text)' : 'var(--text-tertiary)',
                        marginTop: 4,
                      }}
                    >
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Duration */}
          <section>
            <h2 style={sectionHeadingStyle}>How long should this take?</h2>
            <div
              data-testid="stage2-duration-group"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
            >
              {DURATION_OPTIONS.map((opt) => {
                const selected = draft.durationTarget === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`stage2-duration-${opt.value}`}
                    data-selected={selected}
                    onClick={() => setDraft((d) => ({ ...d, durationTarget: opt.value }))}
                    style={chipStyle(selected)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Theory or practice slider */}
          <section>
            <h2 style={sectionHeadingStyle}>Theory or practice?</h2>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: '8px 0',
              }}
            >
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={draft.theoryPracticeRatio}
                data-testid="stage2-ratio-slider"
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    theoryPracticeRatio: Number(e.target.value),
                  }))
                }
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-tertiary)',
                }}
              >
                <span>Theory</span>
                <span
                  data-testid="stage2-ratio-label"
                  style={{
                    color: 'var(--accent-text)',
                    fontWeight: 600,
                    fontSize: 'var(--fs-sm)',
                  }}
                >
                  {ratioLabel(draft.theoryPracticeRatio)}
                </span>
                <span>Practice</span>
              </div>
            </div>
          </section>
        </div>
      </div>
      <Footer onBack={onBack} onNext={onNext} canNext={canNext} backLabel="Back" />
    </div>
  );
}

// ─── Stage 4 preview (minimal read-only summary) ─────────────────────────────

function Stage4Preview({ draft, onBack }: { draft: Draft; onBack: () => void }) {
  const s = draft.structure;
  return (
    <div style={stageWrapStyle}>
      <div
        data-testid="stage4-preview"
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--space-7) var(--space-6)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}>
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--accent-text)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Stage 4 of 5 · Final review
          </div>
          {s ? (
            <>
              <h1
                data-testid="stage4-course-title"
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-2xl)',
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                }}
              >
                {s.courseTitle}
              </h1>
              <p
                data-testid="stage4-course-description"
                style={{
                  marginTop: 6,
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-sm)',
                  lineHeight: 1.55,
                }}
              >
                {s.courseDescription}
              </p>
              <div
                style={{
                  marginTop: 'var(--space-5)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-4)',
                }}
              >
                {s.modules.map((m) => (
                  <div
                    key={m.id}
                    data-testid={`stage4-module-${m.id}`}
                    style={{
                      border: '1px solid var(--border)',
                      background: 'var(--bg-elevated)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-4)',
                    }}
                  >
                    <div
                      data-testid={`stage4-module-title-${m.id}`}
                      style={{
                        fontSize: 'var(--fs-md)',
                        fontWeight: 600,
                        color: 'var(--text)',
                      }}
                    >
                      {m.title}
                    </div>
                    <ul
                      style={{
                        margin: '8px 0 0',
                        padding: '0 0 0 18px',
                        color: 'var(--text-secondary)',
                        fontSize: 'var(--fs-sm)',
                      }}
                    >
                      {m.lessons.map((l) => (
                        <li
                          key={l.id}
                          data-testid={`stage4-lesson-${l.id}`}
                          style={{ marginTop: 4 }}
                        >
                          {l.title}{' '}
                          <span
                            style={{
                              color: 'var(--text-tertiary)',
                              fontSize: 'var(--fs-xs)',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            · {l.estimatedMinutes} min
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-sm)' }}>
              No structure yet. Go back and build one.
            </p>
          )}
        </div>
      </div>
      <Footer onBack={onBack} backLabel="Back" hideNext />
    </div>
  );
}

function Stage5Placeholder({ onBack }: { onBack: () => void }) {
  return (
    <div style={stageWrapStyle}>
      <div
        data-testid="stage5-placeholder"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-7) var(--space-6)',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-2xl)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            Stage 5 — Generate
          </h1>
          <p
            style={{
              marginTop: 12,
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.55,
            }}
          >
            Agent-log view comes next.
          </p>
        </div>
      </div>
      <Footer onBack={onBack} backLabel="Back" hideNext />
    </div>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function Footer({
  onBack,
  onNext,
  canNext = false,
  backLabel,
  nextLabel = 'Next',
  hideNext = false,
}: {
  onBack: () => void;
  onNext?: () => void;
  canNext?: boolean;
  backLabel: string;
  nextLabel?: string;
  hideNext?: boolean;
}) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        padding: 'var(--space-4) var(--space-6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <button
        type="button"
        data-testid="wizard-back"
        onClick={onBack}
        style={ghostBtnStyle}
      >
        <ArrowLeft size={14} strokeWidth={2} />
        {backLabel}
      </button>
      {!hideNext && onNext ? (
        <button
          type="button"
          data-testid="wizard-next"
          onClick={onNext}
          disabled={!canNext}
          style={primaryBtnStyle(!canNext)}
        >
          {nextLabel}
          <ArrowRight size={14} strokeWidth={2} />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'var(--font-sans)',
};

const headerStyle: CSSProperties = {
  height: 64,
  flexShrink: 0,
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 var(--space-6)',
};

const mainStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const stageWrapStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const sectionHeadingStyle: CSSProperties = {
  margin: 0,
  marginBottom: 14,
  fontSize: 'var(--fs-md)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: 'var(--text)',
};

function chipStyle(selected: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    height: 32,
    padding: '0 14px',
    background: selected ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 'var(--radius-full)',
    fontSize: 'var(--fs-sm)',
    color: selected ? 'var(--accent-text)' : 'var(--text-secondary)',
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'border-color var(--t-fast), background var(--t-fast), color var(--t-fast)',
  };
}

function radioCardStyle(selected: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    textAlign: 'left',
    padding: 'var(--space-4)',
    background: selected ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
    borderRadius: 'var(--radius-md)',
    color: selected ? 'var(--accent-text)' : 'var(--text)',
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'border-color var(--t-fast), background var(--t-fast), color var(--t-fast)',
  };
}

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
