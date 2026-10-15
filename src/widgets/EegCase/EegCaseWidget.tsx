'use client';

// eegCase — staged case: vignette → systematic reading → expert report
// (spec §3.5). Steps unlock one by one; each wrong answer gets one more
// try before the answer is shown; the expert summary closes the case.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Eye, MessageCircleQuestion } from 'lucide-react';

import { MarkdownInline } from '@/components/MarkdownInline';
import { useTutorBridge } from '@/lib/lessonChat/tutorBridge';
import {
  DataErrorCard,
  parseWidgetState,
  useFigureMarks,
  useParsedData,
  useWidgetProgress,
  type EegWidgetProps,
  type FigureCalibration,
  type FigureRef,
} from '@/widgets/common/eeg';
import { FigureMarkBoard } from '@/widgets/common/eeg/FigureMarkBoard';
import { FeedbackPanel, ToolButton, eegMutedTextStyle, eegToolbarStyle, eegWidgetBodyStyle } from '@/widgets/common/eeg/ui';
import { EegViewerWidget } from '@/widgets/EegViewer/EegViewerWidget';

import {
  MAX_ATTEMPTS,
  MEASURE_UNITS,
  EegCaseDataSchema,
  EegCaseStateSchema,
  caseScore,
  currentStepIndex,
  describeCaseState,
  gradeChoice,
  gradeMeasure,
  parseNumber,
  type EegCaseData,
  type EegCaseState,
  type EegCaseStep,
  type StepAnswer,
} from './schema';

export type EegCaseWidgetProps = EegWidgetProps<EegCaseData>;

export function EegCaseWidget(props: EegCaseWidgetProps) {
  const parsed = useParsedData(EegCaseDataSchema, props.data);
  if (!parsed.ok) return <DataErrorCard title="This EEG case's data is invalid" error={parsed.error} />;
  return <EegCaseReady {...props} data={parsed.data} />;
}

type Answers = Record<string, StepAnswer>;

const stepCardStyle = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--bg-subtle)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-2)',
  minWidth: 0,
};

function EegCaseReady({ data, progressKey, onComplete, initialWidgetState, alreadyCompleted }: EegCaseWidgetProps & { data: EegCaseData }) {
  const [persisted] = useState<EegCaseState | null>(() => parseWidgetState(initialWidgetState, EegCaseStateSchema));
  const [answers, setAnswers] = useState<Answers>(() => persisted?.answers ?? {});
  const stepIdx = currentStepIndex(data.steps, answers);
  const step: EegCaseStep | null = data.steps[stepIdx] ?? null;
  const finished = stepIdx >= data.steps.length;
  const score = caseScore(data.steps, answers);

  const progress = useWidgetProgress(progressKey);
  const completedRef = useRef<boolean>(!!alreadyCompleted);
  // Called from event handlers only (never from a state updater): saves and
  // completion are side effects.
  const record = useCallback(
    (id: string, ans: StepAnswer) => {
      const next = { ...answers, [id]: ans };
      setAnswers(next);
      const state: EegCaseState = { v: 1, answers: next };
      if (currentStepIndex(data.steps, next) >= data.steps.length) {
        void progress.saveNow({ done: true, widgetState: state, score: caseScore(data.steps, next) });
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete?.();
        }
      } else {
        progress.saveDebounced({ widgetState: state });
      }
    },
    [answers, data.steps, progress, onComplete],
  );

  // ── Tutor ─────────────────────────────────────────────────────────────
  const tutor = useTutorBridge(progressKey?.sectionId);
  useEffect(() => {
    tutor?.publishState(
      describeCaseState({
        vignette: data.vignette,
        hasFigure: data.figure ? `${data.figure.alt} (${data.figure.attribution.text}; ${data.figure.attribution.license})` : null,
        stepIndex: stepIdx,
        total: data.steps.length,
        current: step,
        attempts: step ? answers[step.id]?.attempts ?? 0 : 0,
        score,
      }),
    );
  }, [tutor, data.vignette, data.figure, data.steps.length, stepIdx, step, answers, score]);

  const markStep = step?.kind === 'mark' ? step : null;

  return (
    <div style={eegWidgetBodyStyle} data-eeg-case="">
      <div style={{ ...stepCardStyle, background: 'var(--bg-elevated)' }}>
        <span style={{ ...eegMutedTextStyle, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Case</span>
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>
          <MarkdownInline>{data.vignette}</MarkdownInline>
        </div>
      </div>

      {data.figure ? (
        markStep ? (
          <MarkStepBoard key={markStep.id} step={markStep} figure={data.figure} calibration={data.calibration} answer={answers[markStep.id]} onDone={record} />
        ) : (
          <FigureMarkBoard figure={data.figure} calibration={data.calibration} />
        )
      ) : data.viewer ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
          <EegViewerWidget data={{ source: data.viewer.source, initial: data.viewer.initial ?? {} }} />
        </div>
      ) : null}

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }} aria-label="Case steps">
        {data.steps.map((s, i) => {
          if (i > stepIdx) return null;
          const a = answers[s.id];
          return (
            <li key={s.id} style={stepCardStyle}>
              <span style={eegMutedTextStyle}>
                Step {i + 1} of {data.steps.length}
                {a?.done && s.kind !== 'reveal' ? (a.firstCorrect ? ' · ✓ first try' : ' · ✗') : ''}
              </span>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>
                <MarkdownInline>{s.prompt}</MarkdownInline>
              </div>
              {s.kind === 'choice' || s.kind === 'multi' ? <ChoiceStep step={s} answer={a} onRecord={record} /> : null}
              {s.kind === 'measure' ? <MeasureStep step={s} answer={a} onRecord={record} hasCaliper={!!data.calibration || !!data.viewer} /> : null}
              {s.kind === 'reveal' ? <RevealStep step={s} answer={a} onRecord={record} /> : null}
              {s.kind === 'mark' ? (
                a?.done ? (
                  <FeedbackPanel tone={a.firstCorrect ? 'success' : 'warning'} title={a.firstCorrect ? 'All findings marked' : 'Compare with the expert key'}>
                    <MarkdownInline>{s.explanation}</MarkdownInline>
                  </FeedbackPanel>
                ) : (
                  <span style={eegMutedTextStyle}>Mark the findings on the figure above, then press Check under it.</span>
                )
              ) : null}
            </li>
          );
        })}
      </ol>

      {finished ? (
        <FeedbackPanel tone="neutral" title={`Expert summary · ${score.correct}/${score.total} steps right on the first try`}>
          <MarkdownInline>{data.summary}</MarkdownInline>
        </FeedbackPanel>
      ) : null}

      {tutor ? (
        <div>
          <ToolButton
            onClick={() =>
              void tutor
                .askAboutView({ prompt: step ? 'Mam problem z tym krokiem przypadku — naprowadź mnie, nie podając odpowiedzi.' : 'Omów ze mną ten przypadek EEG.' })
                .catch(() => {})
            }
          >
            <MessageCircleQuestion size={13} aria-hidden />
            Ask tutor
          </ToolButton>
        </div>
      ) : null}
    </div>
  );
}

// ── Steps ────────────────────────────────────────────────────────────────

interface StepProps<S> {
  step: S;
  answer: StepAnswer | undefined;
  onRecord: (id: string, a: StepAnswer) => void;
}

function nextAnswer(prev: StepAnswer | undefined, value: StepAnswer['value'], correct: boolean): StepAnswer {
  const attempts = (prev?.attempts ?? 0) + 1;
  return { value, attempts, firstCorrect: attempts === 1 && correct, done: correct || attempts >= MAX_ATTEMPTS };
}

function ChoiceStep({ step, answer, onRecord }: StepProps<Extract<EegCaseStep, { kind: 'choice' | 'multi' }>>) {
  const multi = step.kind === 'multi';
  const [selected, setSelected] = useState<number[]>(() => (Array.isArray(answer?.value) ? (answer!.value as number[]) : []));
  const done = !!answer?.done;
  const lastCorrect = answer ? gradeChoice(step, Array.isArray(answer.value) ? (answer.value as number[]) : []) : false;
  const toggle = (i: number) => {
    if (done) return;
    setSelected((s) => (multi ? (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]) : [i]));
  };
  return (
    <>
      <div role={multi ? 'group' : 'radiogroup'} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {step.options.map((o, i) => {
          const isSel = selected.includes(i);
          const showKey = done && step.correct.includes(i);
          return (
            <label
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: showKey ? 'var(--success-border)' : done && isSel ? 'var(--danger-border)' : 'var(--border)',
                background: showKey ? 'var(--success-subtle)' : 'var(--bg-elevated)',
                fontSize: 'var(--fs-sm)',
                cursor: done ? 'default' : 'pointer',
              }}
            >
              <input type={multi ? 'checkbox' : 'radio'} checked={isSel} disabled={done} onChange={() => toggle(i)} onKeyDown={(e) => e.stopPropagation()} />
              <span style={{ minWidth: 0 }}>
                <MarkdownInline>{o}</MarkdownInline>
              </span>
            </label>
          );
        })}
      </div>
      {!done ? (
        <div style={eegToolbarStyle}>
          <ToolButton primary disabled={selected.length === 0} onClick={() => onRecord(step.id, nextAnswer(answer, selected, gradeChoice(step, selected)))}>
            {answer?.attempts ? 'Check again' : 'Check'}
          </ToolButton>
          {answer?.attempts ? <span style={{ ...eegMutedTextStyle, color: 'var(--danger)' }}>Not quite — one more try.</span> : null}
        </div>
      ) : (
        <FeedbackPanel tone={lastCorrect ? 'success' : 'danger'} title={lastCorrect ? 'Correct' : 'The correct answer is highlighted'}>
          <MarkdownInline>{step.explanation}</MarkdownInline>
        </FeedbackPanel>
      )}
    </>
  );
}

function MeasureStep({ step, answer, onRecord, hasCaliper }: StepProps<Extract<EegCaseStep, { kind: 'measure' }>> & { hasCaliper: boolean }) {
  const unit = MEASURE_UNITS[step.quantity];
  const [text, setText] = useState(() => (typeof answer?.value === 'number' ? String(answer.value) : ''));
  const done = !!answer?.done;
  const value = parseNumber(text);
  const lastCorrect = typeof answer?.value === 'number' && gradeMeasure(step, answer.value);
  return (
    <>
      {hasCaliper && !done ? <span style={eegMutedTextStyle}>Tip: use the Caliper on the EEG above.</span> : null}
      <div style={eegToolbarStyle}>
        <input
          type="text"
          inputMode="decimal"
          aria-label={`Your measurement in ${unit}`}
          value={text}
          disabled={done}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && Number.isFinite(value) && !done) onRecord(step.id, nextAnswer(answer, value, gradeMeasure(step, value)));
          }}
          style={{ width: 110, height: 30, padding: '0 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text)' }}
        />
        <span style={eegMutedTextStyle}>{unit}</span>
        {!done ? (
          <ToolButton primary disabled={!Number.isFinite(value)} onClick={() => onRecord(step.id, nextAnswer(answer, value, gradeMeasure(step, value)))}>
            {answer?.attempts ? 'Check again' : 'Check'}
          </ToolButton>
        ) : null}
        {!done && answer?.attempts ? <span style={{ ...eegMutedTextStyle, color: 'var(--danger)' }}>Outside the accepted range — measure once more.</span> : null}
      </div>
      {done ? (
        <FeedbackPanel tone={lastCorrect ? 'success' : 'danger'} title={`${lastCorrect ? 'Correct' : 'Expected'}: ${step.expected} ± ${step.tolerance} ${unit}`}>
          <MarkdownInline>{step.explanation}</MarkdownInline>
        </FeedbackPanel>
      ) : null}
    </>
  );
}

function RevealStep({ step, answer, onRecord }: StepProps<Extract<EegCaseStep, { kind: 'reveal' }>>) {
  if (answer?.done) {
    return (
      <FeedbackPanel tone="neutral" title="Expert description">
        <MarkdownInline>{step.content}</MarkdownInline>
      </FeedbackPanel>
    );
  }
  return (
    <div style={eegToolbarStyle}>
      <span style={eegMutedTextStyle}>Think it through (or say it out loud), then compare.</span>
      <ToolButton primary onClick={() => onRecord(step.id, { value: true, attempts: 1, firstCorrect: false, done: true })}>
        <Eye size={13} aria-hidden />
        Show the expert description
      </ToolButton>
    </div>
  );
}

function MarkStepBoard({
  step,
  figure,
  calibration,
  answer,
  onDone,
}: {
  step: Extract<EegCaseStep, { kind: 'mark' }>;
  figure: FigureRef;
  calibration?: FigureCalibration;
  answer: StepAnswer | undefined;
  onDone: (id: string, a: StepAnswer) => void;
}) {
  const fm = useFigureMarks({ mode: step.mode, targets: step.targets, distractors: step.distractors });
  const [checked, setChecked] = useState(false);
  const feedback = fm.feedback;
  const result = fm.result;
  const ok = !!result && result.allRequiredHit && result.falseMarks.length === 0;
  const summary = useMemo(
    () => (result && feedback ? `Found ${result.hits} of ${step.targets.length}${feedback.falseCount ? ` · ${feedback.falseCount} false` : ''}` : ''),
    [result, feedback, step.targets.length],
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <FigureMarkBoard figure={figure} fm={fm} mode={step.mode} calibration={calibration} />
      <div style={eegToolbarStyle}>
        {!checked ? (
          <ToolButton
            primary
            disabled={fm.marks.length === 0}
            onClick={() => {
              fm.check();
              setChecked(true);
            }}
          >
            Check
          </ToolButton>
        ) : (
          <ToolButton
            primary
            onClick={() => onDone(step.id, { value: fm.snapshot, attempts: (answer?.attempts ?? 0) + 1, firstCorrect: ok, done: true })}
          >
            Continue <ArrowRight size={13} aria-hidden />
          </ToolButton>
        )}
      </div>
      {checked && feedback ? (
        <FeedbackPanel tone={ok ? 'success' : result && result.hits > 0 ? 'warning' : 'danger'} title={summary}>
          {feedback.missed.length ? (
            <div style={{ marginBottom: 'var(--space-2)' }}>
              Missed: <MarkdownInline>{feedback.missed.map((m) => m.label).join('; ')}</MarkdownInline>
            </div>
          ) : null}
          {feedback.distractorNotes.map((n, i) => (
            <div key={i} style={{ marginBottom: 'var(--space-2)' }}>
              ⚠ <MarkdownInline>{n}</MarkdownInline>
            </div>
          ))}
          <MarkdownInline>{step.explanation}</MarkdownInline>
        </FeedbackPanel>
      ) : null}
    </div>
  );
}

export default EegCaseWidget;
