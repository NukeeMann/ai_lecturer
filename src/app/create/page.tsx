'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import Stage3Cascade, {
  type Draft,
  type Level,
  type DurationTarget,
  type StructureDraft,
} from './Stage3Cascade';
import Stage3Clarify from './Stage3Clarify';
import {
  computeStageInputHash,
  isStageStale,
  snapshotUpstreamHashes,
  staleStages,
} from '@/lib/wizard/dependencies';

const DEFAULT_DRAFT: Draft = {
  topic: '',
  level: null,
  durationTarget: null,
  theoryPracticeRatio: 50,
  clarificationQuestions: undefined,
  clarification: undefined,
  structure: null,
};

const STAGES = [
  { id: 1, label: 'Topic' },
  { id: 2, label: 'Refine' },
  { id: 3, label: 'Clarify' },
  { id: 4, label: 'Structure' },
  { id: 5, label: 'Approve' },
  { id: 6, label: 'Generate' },
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
  { value: 'short', label: 'Short (3–5 lessons)' },
  { value: 'standard', label: 'Standard (8–12)' },
  { value: 'extensive', label: 'Extensive (20–30)' },
  { value: 'comprehensive', label: 'Comprehensive (40+)' },
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
    const t = params.get('idea') ?? params.get('topic');
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
          setStage(6);
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

  const handleCancelGeneration = useCallback(() => {
    setSubmittedSlug(null);
    setStage(5);
  }, []);

  const staleStageIds = useMemo(() => {
    const stale = staleStages(draft, draft.caches);
    const ids = new Set<number>();
    if (stale.has('clarification')) ids.add(3);
    if (stale.has('structure')) ids.add(4);
    if (stale.has('approval')) ids.add(5);
    return ids;
  }, [draft]);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Stepper current={stage} onJump={handleStepperJump} staleStageIds={staleStageIds} />
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
          <Stage3Clarify
            draft={draft}
            setDraft={setDraft}
            onNext={() => setStage(4)}
            onBack={() => setStage(2)}
          />
        )}
        {stage === 4 && (
          <Stage3Cascade
            draft={draft}
            setDraft={setDraft}
            onNext={() => setStage(5)}
            onBack={() => setStage(3)}
          />
        )}
        {stage === 5 && (
          <Stage4Approval
            draft={draft}
            setDraft={setDraft}
            onBack={() => setStage(4)}
            onGenerate={handleGenerate}
            submitting={submitting}
            submitError={submitError}
          />
        )}
        {stage === 6 && submittedSlug && (
          <Stage5Generate
            slug={submittedSlug}
            onCancelled={handleCancelGeneration}
          />
        )}
      </main>
    </div>
  );
}

// Strip client-side ids and serialize draft into a CourseSpec payload.
function buildCourseSpec(draft: Draft, structure: StructureDraft) {
  const spec: Record<string, unknown> = {
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

  if (draft.clarificationQuestions && draft.clarificationQuestions.length > 0) {
    const answers = draft.clarification ?? {};
    const trimmed: Record<string, string> = {};
    for (const q of draft.clarificationQuestions) {
      const a = (answers[q.id] ?? '').trim();
      if (a.length > 0) trimmed[`${q.id}: ${q.text}`] = a;
    }
    if (Object.keys(trimmed).length > 0) {
      spec.clarification = trimmed;
    }
  }

  return spec;
}

function clampRatio(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

function Stepper({
  current,
  onJump,
  staleStageIds,
}: {
  current: number;
  onJump: (id: number) => void;
  staleStageIds?: Set<number>;
}) {
  return (
    <div data-testid="wizard-stepper" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {STAGES.map((s, i) => {
        const done = s.id < current;
        const active = s.id === current;
        const future = s.id > current;
        const canJump = done;
        const stale = staleStageIds?.has(s.id) ?? false;
        return (
          <Fragment key={s.id}>
            <button
              type="button"
              data-testid={`stepper-step-${s.id}`}
              data-step-state={done ? 'done' : active ? 'active' : 'future'}
              data-stale={stale ? 'true' : undefined}
              onClick={canJump ? () => onJump(s.id) : undefined}
              aria-current={active ? 'step' : undefined}
              disabled={future}
              title={stale ? 'Will regenerate when reopened — upstream changed' : undefined}
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
              {stale && (
                <span
                  data-testid={`stepper-step-${s.id}-stale`}
                  aria-label="stale"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    color: 'var(--warning, #d97706)',
                  }}
                >
                  <AlertTriangle size={11} strokeWidth={2.5} />
                </span>
              )}
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
  setDraft,
  onBack,
  onGenerate,
  submitting,
  submitError,
}: {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  onBack: () => void;
  onGenerate: () => void;
  submitting: boolean;
  submitError: string | null;
}) {
  // Approval has no Claude call — "regeneration" is just refreshing the
  // recorded upstream-hash snapshot so the stale indicator clears once the
  // user has actually viewed the new summary. (No confirm dialog: user can't
  // edit Approval, so there's nothing to lose.)
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (refreshedRef.current) return;
    refreshedRef.current = true;
    const cache = draft.caches?.approval;
    const stale = isStageStale('approval', draft, cache);
    if (!cache || stale) {
      setDraft((d) => {
        const generatedHash = computeStageInputHash('structure', d);
        return {
          ...d,
          caches: {
            ...(d.caches ?? {}),
            approval: {
              upstreamHashes: snapshotUpstreamHashes('approval', d),
              generatedHash,
            },
          },
        };
      });
    }
  }, [draft, setDraft]);

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
            Stage 5 of 6 · Final review
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

// ─── Stage 5 — Generate (live progress) ──────────────────────────────────────

interface GenerationLogLine {
  key: number;
  text: string;
}

interface ProgressState {
  current: number;
  total: number;
}

function Stage5Generate({ slug, onCancelled }: { slug: string; onCancelled: () => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<'starting' | 'running' | 'done' | 'error'>('starting');
  const [genId, setGenId] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<GenerationLogLine[]>([]);
  const [stages, setStages] = useState<{ name: string; status: 'started' | 'done' | 'error' }[]>([]);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showFullLog, setShowFullLog] = useState(false);

  const lineKeyRef = useRef(0);
  const logScrollRef = useRef<HTMLPreElement | null>(null);
  const phaseRef = useRef(phase);
  const genIdRef = useRef<string | null>(null);
  const cancelInFlightRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    genIdRef.current = genId;
  }, [genId]);

  // Auto-scroll the log to the bottom on new lines (best-effort).
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logLines]);

  // Kick off the run and subscribe to its SSE stream.
  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | null = null;

    const start = async () => {
      try {
        const res = await fetch('/api/courses/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug }),
        });
        if (cancelled) return;
        if (res.status === 503) {
          let message = 'Install Claude Code CLI or sign in to Claude Max';
          try {
            const body = (await res.json()) as { error?: string };
            if (body && typeof body.error === 'string') message = body.error;
          } catch {
            /* non-JSON body */
          }
          setErrorMessage(message);
          setPhase('error');
          return;
        }
        if (!res.ok) {
          let message = `Server returned ${res.status}`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body && typeof body.error === 'string') message = body.error;
          } catch {
            /* non-JSON body */
          }
          setErrorMessage(message);
          setPhase('error');
          return;
        }
        const body = (await res.json()) as { id: string };
        setGenId(body.id);
        genIdRef.current = body.id;
        setPhase('running');

        eventSource = new EventSource(`/api/courses/generate/stream/${body.id}`);

        eventSource.addEventListener('log', (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data) as { line: string };
            setLogLines((prev) => {
              const next = [...prev, { key: ++lineKeyRef.current, text: data.line }];
              // Keep buffer bounded so very long runs don't OOM the browser.
              return next.length > 5000 ? next.slice(next.length - 5000) : next;
            });
          } catch {
            /* malformed event */
          }
        });
        eventSource.addEventListener('stage', (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data) as { name: string; status: 'started' | 'done' | 'error' };
            setStages((prev) => [...prev, { name: data.name, status: data.status }]);
          } catch {
            /* malformed */
          }
        });
        eventSource.addEventListener('progress', (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data) as { current: number; total: number };
            setProgress({ current: data.current, total: data.total });
          } catch {
            /* malformed */
          }
        });
        eventSource.addEventListener('done', (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data) as { courseSlug: string };
            setPhase('done');
            eventSource?.close();
            // Tiny delay so the user sees the success state before the page swap.
            window.setTimeout(() => {
              router.push(`/courses/${data.courseSlug}`);
            }, 600);
          } catch {
            /* malformed */
          }
        });
        eventSource.addEventListener('error', (ev: MessageEvent) => {
          // SSE built-in onerror fires with no data; only treat as fatal if
          // the payload says so (i.e. our structured `error` event).
          if (typeof (ev as MessageEvent).data === 'string' && ev.data.length > 0) {
            try {
              const data = JSON.parse(ev.data) as { message: string };
              setErrorMessage(data.message);
              setPhase('error');
              eventSource?.close();
            } catch {
              /* network blip — let the browser auto-reconnect */
            }
          }
        });
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (eventSource) {
        try {
          eventSource.close();
        } catch {
          /* already closed */
        }
      }
      // If the user navigates away while still running, fire-and-forget a
      // cancel so the subprocess doesn't keep consuming the slot.
      const id = genIdRef.current;
      if (id && phaseRef.current === 'running' && !cancelInFlightRef.current) {
        cancelInFlightRef.current = true;
        try {
          if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
            navigator.sendBeacon(`/api/courses/generate?id=${encodeURIComponent(id)}`);
          }
          void fetch(`/api/courses/generate?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
        } catch {
          /* best-effort */
        }
      }
    };
  }, [slug, router]);

  const handleCancelClick = async () => {
    if (cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    const id = genIdRef.current;
    if (id) {
      try {
        await fetch(`/api/courses/generate?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch {
        /* ignore */
      }
    }
    onCancelled();
  };

  const progressPercent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : null;

  const tailLog = useMemo(() => logLines.slice(-200), [logLines]);

  return (
    <div style={stageWrapStyle}>
      <div
        data-testid="stage5-generate"
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--space-7) var(--space-6)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 820, margin: '0 auto' }}>
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
            Stage 6 of 6 · Generating
          </div>

          <h1
            data-testid="stage5-headline"
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-2xl)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            {phase === 'done'
              ? 'Course generated'
              : phase === 'error'
                ? 'Generation failed'
                : 'Generating your course…'}
          </h1>
          <p
            style={{
              marginTop: 6,
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.55,
            }}
          >
            {phase === 'done'
              ? 'Redirecting to your course…'
              : phase === 'error'
                ? 'See details below — or go back to fix the issue and try again.'
                : 'Hang tight — Claude is researching the topic, then ralph will write each lesson.'}
          </p>

          {progressPercent !== null && phase !== 'error' && (
            <div
              data-testid="stage5-progress"
              data-progress-current={progress?.current}
              data-progress-total={progress?.total}
              style={{ marginTop: 'var(--space-5)' }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <span>Lessons</span>
                <span>
                  {progress?.current} / {progress?.total}
                </span>
              </div>
              <div
                style={{
                  width: '100%',
                  height: 8,
                  background: 'var(--bg-active)',
                  borderRadius: 'var(--radius-full)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${progressPercent}%`,
                    height: '100%',
                    background: 'var(--accent)',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          )}

          {stages.length > 0 && (
            <div
              data-testid="stage5-stages"
              style={{
                marginTop: 'var(--space-5)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              {stages.map((s, i) => (
                <span
                  key={i}
                  data-stage-name={s.name}
                  data-stage-status={s.status}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 'var(--fs-xs)',
                    fontFamily: 'var(--font-mono)',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    background:
                      s.status === 'done'
                        ? 'var(--success, #10b981)'
                        : s.status === 'error'
                          ? 'var(--danger-subtle, rgba(220, 38, 38, 0.10))'
                          : 'var(--accent-subtle)',
                    color:
                      s.status === 'done'
                        ? 'white'
                        : s.status === 'error'
                          ? 'var(--danger, #b91c1c)'
                          : 'var(--accent-text)',
                    border:
                      s.status === 'error'
                        ? '1px solid var(--danger, #fca5a5)'
                        : 'none',
                  }}
                >
                  {s.name} · {s.status}
                </span>
              ))}
            </div>
          )}

          {phase === 'error' && errorMessage && (
            <div
              data-testid="stage5-error"
              role="alert"
              style={{
                marginTop: 'var(--space-5)',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--danger-subtle, rgba(220, 38, 38, 0.08))',
                color: 'var(--danger, #b91c1c)',
                border: '1px solid var(--danger, #fca5a5)',
                fontSize: 'var(--fs-sm)',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{errorMessage}</div>
              <button
                type="button"
                data-testid="stage5-toggle-full-log"
                onClick={() => setShowFullLog((v) => !v)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--danger, #b91c1c)',
                  fontSize: 'var(--fs-xs)',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                {showFullLog ? 'Hide full log' : 'Show full log'}
              </button>
            </div>
          )}

          <div
            style={{
              marginTop: 'var(--space-5)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--code-bg, #0f172a)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                fontSize: 'var(--fs-xs)',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-tertiary)',
                background: 'var(--bg-elevated)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              Generation log {logLines.length > 0 && `(${logLines.length} lines)`}
            </div>
            <pre
              ref={logScrollRef}
              data-testid="stage5-log"
              style={{
                margin: 0,
                padding: '10px 12px',
                maxHeight: showFullLog ? '60vh' : '320px',
                overflow: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                color: 'var(--code-text, #e2e8f0)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {(showFullLog ? logLines : tailLog)
                .map((line) => line.text)
                .join('\n')}
              {logLines.length === 0 && phase !== 'error' && (
                <span style={{ color: 'var(--text-tertiary)' }}>Waiting for output…</span>
              )}
            </pre>
          </div>

          <div
            style={{
              marginTop: 'var(--space-5)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
            }}
          >
            {phase === 'running' && (
              <button
                type="button"
                data-testid="stage5-cancel"
                onClick={handleCancelClick}
                style={ghostBtnStyle}
              >
                Cancel
              </button>
            )}
            {phase === 'error' && (
              <button
                type="button"
                data-testid="stage5-back"
                onClick={onCancelled}
                style={ghostBtnStyle}
              >
                <ArrowLeft size={14} strokeWidth={2} />
                Back to approval
              </button>
            )}
          </div>
        </div>
      </div>
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
