'use client';

// eegFigureMark — "mark the fragment" on a REAL EEG figure (spec §3.3).
// The learner clicks (or boxes) every finding; Check scores against the
// expert key, gives specific feedback for known look-alikes (distractors)
// and reveals the expert overlay.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircleQuestion, RotateCcw } from 'lucide-react';

import { MarkdownInline } from '@/components/MarkdownInline';
import { useTutorBridge } from '@/lib/lessonChat/tutorBridge';
import {
  DataErrorCard,
  parseWidgetState,
  useFigureMarks,
  useParsedData,
  useWidgetProgress,
  type EegWidgetProps,
  type FigureCanvasHandle,
} from '@/widgets/common/eeg';
import { FigureMarkBoard } from '@/widgets/common/eeg/FigureMarkBoard';
import { FeedbackPanel, ToolButton, eegToolbarStyle, eegWidgetBodyStyle } from '@/widgets/common/eeg/ui';

import {
  EegFigureMarkDataSchema,
  EegFigureMarkStateSchema,
  describeFigureMarkState,
  type EegFigureMarkData,
  type EegFigureMarkState,
} from './schema';

export type EegFigureMarkWidgetProps = EegWidgetProps<EegFigureMarkData>;

export function EegFigureMarkWidget(props: EegFigureMarkWidgetProps) {
  const parsed = useParsedData(EegFigureMarkDataSchema, props.data);
  if (!parsed.ok) return <DataErrorCard title="This figure exercise's data is invalid" error={parsed.error} />;
  return <EegFigureMarkReady {...props} data={parsed.data} />;
}

function plain(md: string): string {
  return md.replace(/[*_`]/g, '');
}

function EegFigureMarkReady({ data, progressKey, onComplete, initialWidgetState, alreadyCompleted }: EegFigureMarkWidgetProps & { data: EegFigureMarkData }) {
  const [persisted] = useState<EegFigureMarkState | null>(() => parseWidgetState(initialWidgetState, EegFigureMarkStateSchema));
  const fm = useFigureMarks({
    mode: data.mode,
    targets: data.targets,
    distractors: data.distractors,
    maxMarks: data.maxMarks,
    boxIoU: data.boxIoU,
    revealKey: data.revealKey,
    initial: persisted,
  });

  const progress = useWidgetProgress(progressKey);
  const completedRef = useRef<boolean>(!!alreadyCompleted);
  const [caliperText, setCaliperText] = useState<string | null>(null);

  // Draft marks: merge-save (keeps the stored done/score).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!fm.checked) progress.saveDebounced({ widgetState: { v: 1, ...fm.snapshot } });
  }, [fm.snapshot, fm.checked, progress]);

  const onCheck = useCallback(() => {
    const result = fm.check();
    void progress.saveNow({
      done: true,
      widgetState: { v: 1, marks: fm.snapshot.marks, checked: true },
      score: { correct: result.hits, total: data.targets.length },
    });
    if (!completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
  }, [fm, progress, data.targets.length, onComplete]);

  const onRetry = () => {
    fm.reset();
    progress.saveDebounced({ widgetState: { v: 1, marks: [], checked: false } });
  };

  // ── Tutor ─────────────────────────────────────────────────────────────
  const tutor = useTutorBridge(progressKey?.sectionId);
  const canvasRef = useRef<FigureCanvasHandle>(null);
  const feedback = fm.feedback;
  const liveState = useMemo(
    () =>
      describeFigureMarkState({
        prompt: plain(data.prompt),
        figureAlt: data.figure.alt,
        attribution: `${data.figure.attribution.text}; ${data.figure.attribution.license}`,
        marks: fm.marks.length,
        checked: fm.checked,
        feedback: feedback
          ? {
              found: feedback.found.map((f) => plain(f.label)),
              missed: feedback.missed.map((m) => plain(m.label)),
              falseCount: feedback.falseCount,
              distractorNotes: feedback.distractorNotes.map(plain),
            }
          : null,
        caliper: caliperText,
      }),
    [data.prompt, data.figure, fm.marks.length, fm.checked, feedback, caliperText],
  );
  useEffect(() => {
    tutor?.publishState(liveState);
  }, [tutor, liveState]);

  const askTutor = async () => {
    if (!tutor) return;
    const image = (await canvasRef.current?.captureView('image/png')) ?? undefined;
    await tutor.askAboutView({ prompt: 'Pomóż mi zrozumieć ten fragment ryciny EEG (załącznik).', image: image ?? undefined }).catch(() => {});
  };

  const result = fm.result;
  const allFound = !!result && result.allRequiredHit && result.falseMarks.length === 0;

  return (
    <div style={eegWidgetBodyStyle} data-eeg-figure-mark="">
      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>
        <MarkdownInline>{data.prompt}</MarkdownInline>
      </div>

      <FigureMarkBoard
        figure={data.figure}
        fm={fm}
        mode={data.mode}
        calibration={data.calibration}
        canvasRef={canvasRef}
        onCaliperText={setCaliperText}
      />

      <div style={eegToolbarStyle}>
        {!fm.checked ? (
          <ToolButton primary onClick={onCheck} disabled={fm.marks.length === 0}>
            Check
          </ToolButton>
        ) : (
          <ToolButton onClick={onRetry}>
            <RotateCcw size={13} aria-hidden />
            Try again
          </ToolButton>
        )}
        {tutor ? (
          <ToolButton onClick={() => void askTutor()} title="Ask the AI tutor about the visible part of the figure">
            <MessageCircleQuestion size={13} aria-hidden />
            Ask tutor
          </ToolButton>
        ) : null}
      </div>

      {fm.checked && feedback && result ? (
        <FeedbackPanel
          tone={allFound ? 'success' : result.hits > 0 ? 'warning' : 'danger'}
          title={`Found ${result.hits} of ${data.targets.length}${feedback.falseCount ? ` · ${feedback.falseCount} false mark${feedback.falseCount > 1 ? 's' : ''}` : ''}`}
        >
          {feedback.missed.length > 0 ? (
            <div style={{ marginBottom: 'var(--space-2)' }}>
              Missed: <MarkdownInline>{feedback.missed.map((m) => m.label).join('; ')}</MarkdownInline>
            </div>
          ) : null}
          {feedback.distractorNotes.map((n, i) => (
            <div key={i} style={{ marginBottom: 'var(--space-2)' }}>
              ⚠ <MarkdownInline>{n}</MarkdownInline>
            </div>
          ))}
          <MarkdownInline>{data.explanation}</MarkdownInline>
        </FeedbackPanel>
      ) : null}
    </div>
  );
}

export default EegFigureMarkWidget;
