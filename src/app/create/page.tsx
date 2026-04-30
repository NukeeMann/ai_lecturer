'use client';

import { Fragment, useEffect, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Copy, Sparkles } from 'lucide-react';
import Stage3Cascade, {
  type Draft,
  type Level,
  type DurationTarget,
  type StructureDraft,
} from './Stage3Cascade';

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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedSlug, setSubmittedSlug] = useState<string | null>(null);

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

  const handleGenerate = async () => {
    if (submitting) return;
    if (!draft.structure || !draft.level || !draft.durationTarget) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      let title = draft.structure.courseTitle;
      // Retry loop for 409 collisions: prompt for a new title and try again.
      while (true) {
        const spec = buildCourseSpec(draft, { ...draft.structure, courseTitle: title });
        const res = await fetch('/api/courses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(spec),
        });
        if (res.status === 201) {
          const body = (await res.json()) as { slug: string };
          // Persist the (possibly renamed) title back into the draft.
          if (title !== draft.structure.courseTitle) {
            setDraft((d) =>
              d.structure ? { ...d, structure: { ...d.structure, courseTitle: title } } : d,
            );
          }
          setSubmittedSlug(body.slug);
          setStage(5);
          return;
        }
        if (res.status === 409) {
          const next = window.prompt(
            `A course with that name already exists. Pick a different title:`,
            title,
          );
          if (next === null) return; // User cancelled — stay on Stage 4.
          const trimmed = next.trim();
          if (trimmed.length === 0) {
            setSubmitError('Course title cannot be empty.');
            return;
          }
          title = trimmed;
          continue;
        }
        // Any other status — surface a clear inline error and bail out.
        let message = `Server returned ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body && typeof body.error === 'string') message = body.error;
        } catch {
          /* non-JSON body */
        }
        setSubmitError(message);
        return;
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
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
          <Stage4Approval
            draft={draft}
            onBack={() => setStage(3)}
            onGenerate={handleGenerate}
            submitting={submitting}
            submitError={submitError}
          />
        )}
        {stage === 5 && submittedSlug && <Stage5Export slug={submittedSlug} />}
      </main>
    </div>
  );
}

// Strip client-side ids and serialize draft into a CourseSpec payload.
function buildCourseSpec(draft: Draft, structure: StructureDraft) {
  return {
    topic: draft.topic.trim(),
    level: draft.level,
    durationTarget: draft.durationTarget,
    theoryPracticeRatio: clampRatio(draft.theoryPracticeRatio / 100),
    draftStructure: {
      courseTitle: structure.courseTitle.trim(),
      courseDescription: structure.courseDescription.trim(),
      modules: structure.modules.map((m) => ({
        title: m.title.trim(),
        lessons: m.lessons.map((l) => ({
          title: l.title.trim(),
          summary: l.summary.trim(),
          estimatedMinutes: l.estimatedMinutes,
        })),
      })),
    },
    createdAt: new Date().toISOString(),
  };
}

function clampRatio(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
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

// ─── Stage 4 — Approval ──────────────────────────────────────────────────────

function Stage4Approval({
  draft,
  onBack,
  onGenerate,
  submitting,
  submitError,
}: {
  draft: Draft;
  onBack: () => void;
  onGenerate: () => void;
  submitting: boolean;
  submitError: string | null;
}) {
  const s = draft.structure;
  const lessonCount = s ? s.modules.reduce((sum, m) => sum + m.lessons.length, 0) : 0;
  const totalMinutes = s
    ? s.modules.reduce(
        (sum, m) => sum + m.lessons.reduce((ms, l) => ms + l.estimatedMinutes, 0),
        0,
      )
    : 0;
  const generationMinutes = lessonCount * 3;

  return (
    <div style={stageWrapStyle}>
      <div
        data-testid="stage4-approval"
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
                data-testid="stage4-totals"
                style={{
                  marginTop: 'var(--space-3)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {s.modules.length} modules · {lessonCount} lessons · ~{totalMinutes} min total
              </div>
              <div
                style={{
                  marginTop: 'var(--space-5)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-4)',
                }}
              >
                {s.modules.map((m, idx) => {
                  const moduleMinutes = m.lessons.reduce((ms, l) => ms + l.estimatedMinutes, 0);
                  return (
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
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          gap: 'var(--space-3)',
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
                        <span
                          style={{
                            fontSize: 'var(--fs-xs)',
                            color: 'var(--text-tertiary)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {m.lessons.length} lessons · ~{moduleMinutes} min
                        </span>
                      </div>
                      <ul
                        style={{
                          margin: '10px 0 0',
                          padding: 0,
                          listStyle: 'none',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        {m.lessons.map((l) => (
                          <li
                            key={l.id}
                            data-testid={`stage4-lesson-${l.id}`}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              padding: '8px 10px',
                              borderRadius: 'var(--radius-sm)',
                              background: 'var(--bg)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'baseline',
                                justifyContent: 'space-between',
                                gap: 'var(--space-3)',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 'var(--fs-sm)',
                                  fontWeight: 500,
                                  color: 'var(--text)',
                                }}
                              >
                                {l.title}
                              </span>
                              <span
                                style={{
                                  flexShrink: 0,
                                  fontSize: 'var(--fs-xs)',
                                  color: 'var(--text-tertiary)',
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                {l.estimatedMinutes} min
                              </span>
                            </div>
                            {l.summary && (
                              <span
                                style={{
                                  marginTop: 2,
                                  fontSize: 'var(--fs-xs)',
                                  color: 'var(--text-secondary)',
                                  lineHeight: 1.45,
                                }}
                              >
                                {l.summary}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {idx < s.modules.length - 1 ? null : null}
                    </div>
                  );
                })}
              </div>

              <div
                data-testid="stage4-cost-estimate"
                style={{
                  marginTop: 'var(--space-6)',
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--accent-subtle)',
                  color: 'var(--accent-text)',
                  fontSize: 'var(--fs-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Sparkles size={14} strokeWidth={2} />
                <span>
                  ≈ {generationMinutes} minutes to generate, {lessonCount} lessons
                </span>
              </div>

              {submitError && (
                <div
                  data-testid="stage4-error"
                  role="alert"
                  style={{
                    marginTop: 'var(--space-4)',
                    padding: 'var(--space-3) var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--danger-subtle, rgba(220, 38, 38, 0.08))',
                    color: 'var(--danger, #b91c1c)',
                    fontSize: 'var(--fs-sm)',
                    border: '1px solid var(--danger, #fca5a5)',
                  }}
                >
                  {submitError}
                </div>
              )}
            </>
          ) : (
            <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-sm)' }}>
              No structure yet. Go back and build one.
            </p>
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
        }}
      >
        <button
          type="button"
          data-testid="wizard-back"
          onClick={onBack}
          disabled={submitting}
          style={ghostBtnStyle}
        >
          <ArrowLeft size={14} strokeWidth={2} />
          Back
        </button>
        <button
          type="button"
          data-testid="stage4-generate"
          onClick={onGenerate}
          disabled={!s || submitting}
          style={primaryBtnStyle(!s || submitting)}
        >
          <Sparkles size={14} strokeWidth={2} />
          {submitting ? 'Saving…' : 'Generate course'}
        </button>
      </div>
    </div>
  );
}

// ─── Stage 5 — Export ────────────────────────────────────────────────────────

function Stage5Export({ slug }: { slug: string }) {
  const specPath = `/courses/${slug}/course-spec.json`;
  const claudeCmd = `claude`;
  const skillCmd = `/init_course ${slug}`;
  const ralphCmd = `./scripts/ralph/ralph.sh`;

  return (
    <div style={stageWrapStyle}>
      <div
        data-testid="stage5-export"
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
            Stage 5 of 5 · Saved
          </div>

          <div
            style={{
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-lg, 12px)',
              padding: 'var(--space-6)',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'var(--success, #10b981)',
                color: 'white',
                marginBottom: 'var(--space-4)',
              }}
            >
              <Check size={18} strokeWidth={3} />
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
              Course spec saved
            </h1>
            <p
              data-testid="stage5-confirm"
              style={{
                marginTop: 6,
                color: 'var(--text-secondary)',
                fontSize: 'var(--fs-sm)',
                lineHeight: 1.55,
              }}
            >
              Course spec saved to{' '}
              <code
                data-testid="stage5-spec-path"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-xs)',
                  background: 'var(--bg)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                }}
              >
                {specPath}
              </code>
            </p>

            <div
              style={{
                marginTop: 'var(--space-5)',
                fontSize: 'var(--fs-sm)',
                color: 'var(--text)',
                fontWeight: 500,
              }}
            >
              Run these commands to generate the lessons:
            </div>
            <ol
              style={{
                marginTop: 'var(--space-3)',
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <CommandRow step={1} command={claudeCmd} testId="stage5-cmd-claude" hint="Open Claude Code in this repo." />
              <CommandRow step={2} command={skillCmd} testId="stage5-cmd-init" hint={`Invoke the init_course skill with slug ${slug}.`} />
              <CommandRow step={3} command={ralphCmd} testId="stage5-cmd-ralph" hint="Run the agent loop until all lessons are generated." />
            </ol>

            <p
              data-testid="stage5-note"
              style={{
                marginTop: 'var(--space-5)',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--fs-sm)',
                lineHeight: 1.5,
              }}
            >
              The course will appear on your dashboard once generation completes.
            </p>

            <div style={{ marginTop: 'var(--space-5)' }}>
              <Link
                href="/"
                data-testid="stage5-back-to-dashboard"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 'var(--fs-sm)',
                  color: 'var(--accent-text)',
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                <ArrowLeft size={14} strokeWidth={2} />
                Back to dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommandRow({
  step,
  command,
  testId,
  hint,
}: {
  step: number;
  command: string;
  testId: string;
  hint: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(command);
      } else if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea');
        ta.value = command;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } finally {
          document.body.removeChild(ta);
        }
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore — non-secure contexts may block clipboard */
    }
  };

  return (
    <li
      data-testid={testId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 8,
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '8px 10px',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--bg-elevated)',
            color: 'var(--text-tertiary)',
            fontSize: 'var(--fs-xs)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {step}
        </span>
        <code
          data-testid={`${testId}-text`}
          style={{
            flex: 1,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text)',
            background: 'transparent',
            whiteSpace: 'pre',
            overflow: 'auto',
            alignSelf: 'center',
          }}
        >
          {command}
        </code>
        <button
          type="button"
          data-testid={`${testId}-copy`}
          onClick={handleCopy}
          aria-label={`Copy command: ${command}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            color: copied ? 'var(--success, #10b981)' : 'var(--text-secondary)',
            fontSize: 'var(--fs-xs)',
            fontFamily: 'inherit',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {copied ? <Check size={12} strokeWidth={3} /> : <Copy size={12} strokeWidth={2} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <span
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-tertiary)',
          marginLeft: 30,
        }}
      >
        {hint}
      </span>
    </li>
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
