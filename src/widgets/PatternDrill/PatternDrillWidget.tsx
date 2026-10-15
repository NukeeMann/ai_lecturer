'use client';

// patternDrill — rapid pattern recognition on REAL figures (spec §3.4).
// One card at a time, answer by category (keys 1–9), immediate feedback,
// confusion-pair comparison on a miss, missed cards come back 3–5 cards
// later, end-of-deck summary with a confusion list and "Retry missed".

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from 'react';
import { ArrowRight, Maximize2, MessageCircleQuestion, RotateCcw, Shuffle } from 'lucide-react';

import { MarkdownInline } from '@/components/MarkdownInline';
import type { NormRect } from '@/lib/eeg';
import { useTutorBridge } from '@/lib/lessonChat/tutorBridge';
import {
  AttributionLine,
  DataErrorCard,
  FigureCanvas,
  parseWidgetState,
  useParsedData,
  useWidgetProgress,
  type EegWidgetProps,
  type FigureCanvasHandle,
  type FigureRef,
} from '@/widgets/common/eeg';
import { FeedbackPanel, ToolButton, eegMutedTextStyle, eegToolbarStyle, eegWidgetBodyStyle } from '@/widgets/common/eeg/ui';

import {
  IFCN_IED_CRITERIA_EN,
  PatternDrillDataSchema,
  PatternDrillStateSchema,
  describeDrillState,
  mergeLearned,
  type PatternDrillData,
  type PatternDrillItem,
  type PatternDrillState,
} from './schema';
import { answerCurrent, hashSeed, isFinished, startSession, summarize, topConfusions, type DrillSession } from './session';

export type PatternDrillWidgetProps = EegWidgetProps<PatternDrillData>;

export function PatternDrillWidget(props: PatternDrillWidgetProps) {
  const parsed = useParsedData(PatternDrillDataSchema, props.data);
  if (!parsed.ok) return <DataErrorCard title="This pattern drill's data is invalid" error={parsed.error} />;
  return <PatternDrillReady {...props} data={parsed.data} />;
}

/** A normalised crop of a figure, scaled to the container width (CSS only). */
function CroppedFigure({ figure, crop }: { figure: FigureRef; crop: NormRect }) {
  const nw = figure.width ?? 2000;
  const nh = figure.height ?? 1400;
  const ratio = (crop.w * nw) / (crop.h * nh);
  const img: CSSProperties = {
    position: 'absolute',
    width: `${100 / crop.w}%`,
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
    height: `${100 / crop.h}%`,
    maxWidth: 'none',
  };
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: String(ratio), overflow: 'hidden', borderRadius: 'var(--radius-md)', background: '#fff' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={figure.src} alt={figure.alt} style={img} draggable={false} />
    </div>
  );
}

function FigureView({ figure, crop, canvasRef }: { figure: FigureRef; crop?: NormRect; canvasRef?: Ref<FigureCanvasHandle> }) {
  const [full, setFull] = useState(!crop);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      {full || !crop ? (
        <FigureCanvas ref={canvasRef} src={figure.src} alt={figure.alt} naturalWidth={figure.width} naturalHeight={figure.height} interaction="pan" />
      ) : (
        <CroppedFigure figure={figure} crop={crop} />
      )}
      {crop ? (
        <div>
          <ToolButton onClick={() => setFull((f) => !f)}>
            <Maximize2 size={13} aria-hidden />
            {full ? 'Show the cropped view' : 'Show the whole figure'}
          </ToolButton>
        </div>
      ) : null}
    </div>
  );
}

function PatternDrillReady({ data, progressKey, onComplete, initialWidgetState, alreadyCompleted }: PatternDrillWidgetProps & { data: PatternDrillData }) {
  const items = data.items;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const catLabel = useCallback((id: string) => data.categories.find((c) => c.id === id)?.label ?? id, [data.categories]);
  const criteria = data.criteriaLabels ?? IFCN_IED_CRITERIA_EN;

  const [persisted] = useState<PatternDrillState | null>(() => parseWidgetState(initialWidgetState, PatternDrillStateSchema));
  const [learned, setLearned] = useState<string[]>(() => persisted?.learned ?? []);
  const [sessions, setSessions] = useState(() => persisted?.sessions ?? 0);

  const baseSeed = useMemo(() => hashSeed(progressKey?.sectionId ?? items.map((i) => i.id).join('|')), [progressKey?.sectionId, items]);
  const newSession = useCallback(
    (n: number, onlyIds?: string[]) =>
      startSession(items, { seed: (baseSeed + n * 7919) >>> 0, length: onlyIds ? undefined : data.session.length, interleave: data.session.interleave, onlyIds }),
    [items, baseSeed, data.session.length, data.session.interleave],
  );
  const [session, setSession] = useState<DrillSession>(() => newSession(persisted?.sessions ?? 0));
  const [answered, setAnswered] = useState<{ choice: string; correct: boolean } | null>(null);
  const [ticked, setTicked] = useState<boolean[]>(() => criteria.map(() => false));
  // When the current card was shown (set in an effect — render must stay pure).
  const shownAt = useRef<number | null>(null);

  const currentId = session.queue[0];
  const current: PatternDrillItem | undefined = currentId ? byId.get(currentId) : undefined;
  const cardKey = `${session.seed}:${session.history.length}:${currentId ?? ''}`;
  useEffect(() => {
    shownAt.current = typeof performance !== 'undefined' ? performance.now() : null;
  }, [cardKey]);
  const finished = isFinished(session);
  const summary = useMemo(() => (finished ? summarize(session, items) : null), [finished, session, items]);

  // ── Progress ──────────────────────────────────────────────────────────
  const progress = useWidgetProgress(progressKey);
  const completedRef = useRef<boolean>(!!alreadyCompleted);
  // Called from the "Next" handler when the last card has been answered.
  const finishSession = (s: DrillSession) => {
    const sum = summarize(s, items);
    const firstCorrect = s.history.filter((h) => h.firstAttempt && h.correct).map((h) => h.itemId);
    const nextLearned = mergeLearned(learned, firstCorrect);
    const nextSessions = sessions + 1;
    setLearned(nextLearned);
    setSessions(nextSessions);
    const state: PatternDrillState = { v: 1, learned: nextLearned, sessions: nextSessions, lastAccuracy: sum.accuracy };
    const passed = nextLearned.length / items.length >= data.passThreshold;
    void progress.saveNow({
      done: passed || completedRef.current,
      widgetState: state,
      score: { correct: nextLearned.length, total: items.length },
    });
    if (passed && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
  };

  // ── Actions ───────────────────────────────────────────────────────────
  const choose = (catId: string) => {
    if (!current || answered) return;
    setAnswered({ choice: catId, correct: current.answer === catId });
  };
  const next = () => {
    if (!current || !answered) return;
    const rt = shownAt.current !== null && typeof performance !== 'undefined' ? performance.now() - shownAt.current : 0;
    const s2 = answerCurrent(session, items, answered.choice, rt, data.session.requeueMissed);
    setSession(s2);
    if (isFinished(s2)) finishSession(s2);
    setAnswered(null);
    setTicked(criteria.map(() => false));
  };
  const restart = (onlyIds?: string[]) => {
    setSession(newSession(sessions + 1, onlyIds));
    setAnswered(null);
    setTicked(criteria.map(() => false));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement).closest('input, textarea')) return;
    const n = Number(e.key);
    if (!answered && Number.isInteger(n) && n >= 1 && n <= data.categories.length) {
      choose(data.categories[n - 1].id);
    } else if (answered && (e.key === 'Enter' || e.key === ' ')) {
      next();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  // ── Tutor ─────────────────────────────────────────────────────────────
  const tutor = useTutorBridge(progressKey?.sectionId);
  const canvasRef = useRef<FigureCanvasHandle>(null);
  useEffect(() => {
    if (!tutor || !current) return;
    tutor.publishState(
      describeDrillState({
        cardIndex: session.history.length + 1,
        remaining: session.queue.length,
        figureAlt: current.figure.alt,
        attribution: `${current.figure.attribution.text}; ${current.figure.attribution.license}`,
        answered: answered ? { choice: catLabel(answered.choice), correct: answered.correct, correctLabel: catLabel(current.answer) } : null,
        learned: learned.length,
        total: items.length,
        criteriaTicked: data.session.showCriteriaChecklist ? ticked.filter(Boolean).length : null,
      }),
    );
  }, [tutor, current, session, answered, learned.length, items.length, ticked, data.session.showCriteriaChecklist, catLabel]);

  const askTutor = async () => {
    if (!tutor) return;
    const image = (await canvasRef.current?.captureView('image/png')) ?? undefined;
    await tutor.askAboutView({ prompt: 'Dlaczego ten zapis należy do tej kategorii? (rycina w załączniku)', image: image ?? undefined }).catch(() => {});
  };

  // ── Render ────────────────────────────────────────────────────────────
  const contrast = answered && !answered.correct && current?.contrastItemId ? byId.get(current.contrastItemId) : undefined;
  const repeats = session.pendingRequeue.length;
  const criteriaMet = ticked.filter(Boolean).length;

  return (
    <div style={{ ...eegWidgetBodyStyle, outline: 'none' }} tabIndex={0} onKeyDown={onKeyDown} data-pattern-drill="" aria-label="Pattern recognition drill">
      {data.prompt ? (
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>
          <MarkdownInline>{data.prompt}</MarkdownInline>
        </div>
      ) : null}

      {!finished && current ? (
        <>
          <div style={{ ...eegToolbarStyle, justifyContent: 'space-between' }}>
            <span style={eegMutedTextStyle}>
              Card {session.history.length + 1} · {session.queue.length} left
              {repeats ? ` (incl. ${repeats} to repeat)` : ''} · recognised {learned.length}/{items.length}
            </span>
            {tutor ? (
              <ToolButton onClick={() => void askTutor()} title="Ask the AI tutor about this card">
                <MessageCircleQuestion size={13} aria-hidden />
                Ask tutor
              </ToolButton>
            ) : null}
          </div>

          <FigureView key={current.id} figure={current.figure} crop={current.crop} canvasRef={canvasRef} />
          <AttributionLine attribution={current.figure.attribution} />

          <div role="group" aria-label="Choose a category" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {data.categories.map((c, i) => {
              const isAnswer = answered && c.id === current.answer;
              const isWrongChoice = answered && !answered.correct && c.id === answered.choice;
              return (
                <ToolButton
                  key={c.id}
                  onClick={() => choose(c.id)}
                  disabled={!!answered && !isAnswer && !isWrongChoice}
                  title={c.description ?? `Key ${i + 1}`}
                  style={{
                    height: 36,
                    fontSize: 'var(--fs-sm)',
                    ...(isAnswer ? { borderColor: 'var(--success)', background: 'var(--success-subtle)', color: 'var(--text)' } : null),
                    ...(isWrongChoice ? { borderColor: 'var(--danger)', background: 'var(--danger-subtle)', color: 'var(--text)' } : null),
                  }}
                >
                  <span style={{ color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                  {c.label}
                  {isAnswer ? ' ✓' : isWrongChoice ? ' ✗' : ''}
                </ToolButton>
              );
            })}
          </div>

          {data.session.showCriteriaChecklist && !answered ? (
            <details style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)' }}>
              <summary style={{ ...eegMutedTextStyle, cursor: 'pointer' }}>
                IFCN criteria for an epileptiform discharge (optional) — met: <strong style={{ color: 'var(--text)' }}>{criteriaMet}/6</strong>
              </summary>
              {criteria.map((c, i) => (
                <label key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', padding: '2px 0' }}>
                  <input
                    type="checkbox"
                    checked={ticked[i]}
                    onChange={(e) => setTicked((t) => t.map((v, k) => (k === i ? e.target.checked : v)))}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <span>
                    {i + 1}. {c}
                  </span>
                </label>
              ))}
              <div style={{ ...eegMutedTextStyle, marginTop: 4 }}>
                Criteria met: <strong style={{ color: 'var(--text)' }}>{criteriaMet}/6</strong>
                {criteriaMet >= 4 ? ' — ≥ 4 suggests an epileptiform discharge (≥ 5: higher specificity)' : ' — fewer than 4: probably not epileptiform'}
              </div>
            </details>
          ) : null}

          {answered ? (
            <>
              <FeedbackPanel tone={answered.correct ? 'success' : 'danger'} title={answered.correct ? 'Correct' : `Not quite — this is: ${catLabel(current.answer)}`}>
                <MarkdownInline>{current.explanation}</MarkdownInline>
              </FeedbackPanel>
              {contrast ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={eegMutedTextStyle}>
                    Compare with a real example of <strong style={{ color: 'var(--text)' }}>{catLabel(contrast.answer)}</strong>:
                  </span>
                  <FigureView figure={contrast.figure} crop={contrast.crop} />
                  <AttributionLine attribution={contrast.figure.attribution} />
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
                    <MarkdownInline>{contrast.explanation}</MarkdownInline>
                  </div>
                </div>
              ) : null}
              <div>
                <ToolButton primary onClick={next}>
                  Next card <ArrowRight size={13} aria-hidden />
                </ToolButton>
                <span style={{ ...eegMutedTextStyle, marginLeft: 8 }}>Enter</span>
              </div>
            </>
          ) : (
            <span style={eegMutedTextStyle}>Answer with the buttons or keys 1–{data.categories.length}.</span>
          )}
        </>
      ) : null}

      {finished && summary ? (
        <DrillSummaryView
          summary={summary}
          catLabel={catLabel}
          learned={learned.length}
          total={items.length}
          passThreshold={data.passThreshold}
          onRetryMissed={summary.missedIds.length ? () => restart(summary.missedIds) : undefined}
          onRestart={() => restart()}
        />
      ) : null}
    </div>
  );
}

function DrillSummaryView({
  summary,
  catLabel,
  learned,
  total,
  passThreshold,
  onRetryMissed,
  onRestart,
}: {
  summary: ReturnType<typeof summarize>;
  catLabel: (id: string) => string;
  learned: number;
  total: number;
  passThreshold: number;
  onRetryMissed?: () => void;
  onRestart: () => void;
}) {
  const passed = learned / total >= passThreshold;
  const confusions = topConfusions(summary);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <FeedbackPanel
        tone={passed ? 'success' : 'warning'}
        title={`First-try accuracy ${Math.round(summary.accuracy * 100)}% (${summary.firstAttemptCorrect}/${summary.total}) · recognised overall ${learned}/${total}`}
      >
        {passed ? 'Deck mastered for now — come back later to refresh it.' : `Aim for ${Math.round(passThreshold * 100)}% — retry the cards you missed.`}
        {summary.medianRtMs !== null ? ` Median answer time ${(summary.medianRtMs / 1000).toFixed(1)} s.` : ''}
      </FeedbackPanel>
      <table style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>Category</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>First try</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(summary.perCategory).map(([cat, v]) => (
            <tr key={cat}>
              <td style={{ padding: '4px 8px' }}>{catLabel(cat)}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {v.correct}/{v.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {confusions.length ? (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
          Most frequent confusions:{' '}
          {confusions.map((c, i) => (
            <span key={i}>
              {i ? '; ' : ''}
              <strong style={{ color: 'var(--text)' }}>{catLabel(c.expected)}</strong> taken for {catLabel(c.chosen)} ×{c.count}
            </span>
          ))}
        </div>
      ) : null}
      <div style={eegToolbarStyle}>
        {onRetryMissed ? (
          <ToolButton primary onClick={onRetryMissed}>
            <RotateCcw size={13} aria-hidden />
            Retry missed ({summary.missedIds.length})
          </ToolButton>
        ) : null}
        <ToolButton onClick={onRestart}>
          <Shuffle size={13} aria-hidden />
          New shuffled round
        </ToolButton>
      </div>
    </div>
  );
}

export default PatternDrillWidget;
