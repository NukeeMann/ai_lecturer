'use client';

// montageLab — montage, polarity and localisation simulator (spec §3.2).
// Always synthetic: the SYMULACJA badge is on the toolbar and on the canvas.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Crosshair, MessageCircleQuestion, Minus, Plus, RotateCcw } from 'lucide-react';

import { MarkdownInline } from '@/components/MarkdownInline';
import {
  DEFAULT_RECORDING_ELECTRODES,
  componentPeakField,
  generateRecording,
  getMontage,
  peakSampleIndex,
  prepareDisplayChannels,
  stepOption,
  type Montage,
  type SimComponent,
  type SphericalPoint,
} from '@/lib/eeg';
import { SIM_PRESET_INFO } from '@/lib/eeg/synth';
import { useTutorBridge } from '@/lib/lessonChat/tutorBridge';
import {
  DataErrorCard,
  SimulationBadge,
  TraceCanvas,
  parseWidgetState,
  useParsedData,
  useWidgetProgress,
  type EegWidgetProps,
  type TraceCanvasHandle,
  type TraceMark,
} from '@/widgets/common/eeg';
import { FieldLegend, HeadMap } from '@/widgets/common/eeg/HeadMap';
import {
  FeedbackPanel,
  ToolButton,
  eegMutedTextStyle,
  eegToolbarStyle,
  eegWidgetBodyStyle,
} from '@/widgets/common/eeg/ui';

import {
  LAB_EPOCH_SEC,
  MontageLabDataSchema,
  MontageLabStateSchema,
  SPREAD_RANGE_DEG,
  channelsWithElectrode,
  checkChallenge,
  describeLabState,
  editableSourceIndex,
  focusComponentIndex,
  labSpec,
  scenarioSpec,
  summarizeLocalization,
  withSourceEdit,
  type MontageLabData,
  type MontageLabState,
  type SourceEdit,
} from './schema';

export type MontageLabWidgetProps = EegWidgetProps<MontageLabData>;

const SHORT_MONTAGE_LABEL: Record<string, string> = {
  LB: 'Double banana',
  TB: 'Transverse',
  AVG: 'Average ref',
  CZ: 'Cz ref',
  EAR: 'Ear ref',
  NEO: 'Neonatal',
};

const LAB_SENSITIVITIES = [5, 7, 10, 15, 20, 30, 50, 70, 100] as const;
const HEAD_ELECTRODES = DEFAULT_RECORDING_ELECTRODES;

export function MontageLabWidget(props: MontageLabWidgetProps) {
  const parsed = useParsedData(MontageLabDataSchema, props.data);
  if (!parsed.ok) return <DataErrorCard title="This montage lab's data is invalid" error={parsed.error} />;
  return <MontageLabReady {...props} data={parsed.data} />;
}

function centerLabel(center: string | SphericalPoint): string {
  return typeof center === 'string' ? center : `θ ${Math.round(center.theta)}°, φ ${Math.round(center.phi)}°`;
}

function MontageLabReady({ data, progressKey, onComplete, initialWidgetState, alreadyCompleted }: MontageLabWidgetProps & { data: MontageLabData }) {
  const base = useMemo(() => labSpec(scenarioSpec(data)), [data]);
  const montages: Montage[] = useMemo(() => data.montages.map((m) => getMontage(m)).filter((m): m is Montage => !!m), [data.montages]);

  const [persisted] = useState<MontageLabState | null>(() => parseWidgetState(initialWidgetState, MontageLabStateSchema));
  const [montageId, setMontageId] = useState<string>(() => {
    const wanted = (persisted?.montage ?? data.initialMontage ?? montages[0]?.id ?? 'LB').toUpperCase();
    return montages.find((m) => m.id === wanted)?.id ?? montages[0]?.id ?? 'LB';
  });
  const [sensitivity, setSensitivity] = useState(20);
  const [edit, setEdit] = useState<SourceEdit>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [showLocalization, setShowLocalization] = useState(data.challenges.length === 0);
  const [answers, setAnswers] = useState<MontageLabState['answers']>(() => persisted?.answers ?? {});

  const montage = montages.find((m) => m.id === montageId) ?? montages[0];
  const challenges = data.challenges;
  const answeredCount = challenges.filter((c) => answers[c.id]).length;
  const allAnswered = answeredCount === challenges.length;
  const current = challenges.find((c) => !answers[c.id]) ?? null;
  // Feedback for the challenge just answered stays up until "Next question".
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const lastAnswered = feedbackId ? challenges.find((c) => c.id === feedbackId) ?? null : null;
  const showingFeedback = !!lastAnswered && !!answers[lastAnswered.id];
  const canAnswer = !!current && !showingFeedback;
  const editingLocked = challenges.length > 0 && !allAnswered;

  // ── Simulation (regenerated when the learner moves the source) ─────────
  const spec = useMemo(() => withSourceEdit(base.spec, edit), [base.spec, edit]);
  const recording = useMemo(() => generateRecording(spec), [spec]);
  const channels = useMemo(
    () => prepareDisplayChannels(recording, montage, { lffHz: 0.5, hffHz: 70, notchHz: null }),
    [recording, montage],
  );
  const srcIdx = editableSourceIndex(spec);
  const source = srcIdx >= 0 ? (spec.components[srcIdx] as Extract<SimComponent, { kind: 'discharge' }>) : null;
  const canEdit = !!source && !editingLocked;

  const focusIdx = focusComponentIndex(spec);
  const field = useMemo(() => {
    const c = spec.components[focusIdx >= 0 ? focusIdx : 0];
    return c ? componentPeakField(c, HEAD_ELECTRODES) : null;
  }, [spec, focusIdx]);
  const fieldMax = useMemo(() => Math.max(1, ...Object.values(field ?? {}).map((v) => Math.abs(v))), [field]);

  const peakIdx = useMemo(() => {
    const fs = recording.sampleRate;
    const c = Math.round((base.eventSec ?? spec.durationSec / 2) * fs);
    return peakSampleIndex(channels, c - 0.15 * fs, c + 0.15 * fs);
  }, [channels, recording.sampleRate, base.eventSec, spec.durationSec]);
  const summary = useMemo(() => summarizeLocalization(montage, channels, peakIdx), [montage, channels, peakIdx]);

  // ── Progress + completion ─────────────────────────────────────────────
  const progress = useWidgetProgress(progressKey);
  const completedRef = useRef<boolean>(!!alreadyCompleted);
  const finish = useCallback(
    (state: MontageLabState) => {
      const correct = challenges.filter((c) => state.answers[c.id]?.correct).length;
      void progress.saveNow({ done: true, widgetState: state, score: challenges.length ? { correct, total: challenges.length } : undefined });
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
    },
    [challenges, progress, onComplete],
  );
  const explored = useCallback(() => {
    if (challenges.length === 0 && !completedRef.current) finish({ v: 1, montage: montageId, answers });
  }, [challenges.length, finish, montageId, answers]);

  const chooseMontage = (id: string) => {
    setMontageId(id);
    setSelected(null);
    if (completedRef.current) progress.saveDebounced({ widgetState: { v: 1, montage: id, answers } });
    explored();
  };

  // Source drags: at most one regeneration per animation frame.
  const pendingEdit = useRef<SourceEdit | null>(null);
  const raf = useRef<number | null>(null);
  const queueEdit = (patch: SourceEdit) => {
    pendingEdit.current = { ...(pendingEdit.current ?? {}), ...patch };
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const p = pendingEdit.current;
      pendingEdit.current = null;
      if (p) setEdit((e) => ({ ...e, ...p }));
    });
  };
  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  const answer = (value: { electrode: string } | { channel: string }) => {
    if (!current) return;
    const correct = checkChallenge(current, value);
    const next = { ...answers, [current.id]: { value: 'electrode' in value ? value.electrode : value.channel, correct } };
    setAnswers(next);
    setFeedbackId(current.id);
    const state: MontageLabState = { v: 1, montage: montageId, answers: next };
    if (challenges.every((c) => next[c.id])) {
      setShowLocalization(true);
      finish(state);
    } else {
      progress.saveDebounced({ widgetState: state });
    }
  };

  const onElectrodeClick = (e: string) => {
    if (canAnswer && current?.answer.kind === 'electrode') {
      answer({ electrode: e });
      return;
    }
    setSelected((s) => (s === e ? null : e));
  };

  // ── Overlays ──────────────────────────────────────────────────────────
  const peakT = peakIdx / recording.sampleRate;
  const highlight = useMemo(() => {
    if (selected) return channelsWithElectrode(montage, selected);
    return showLocalization ? summary.highlight : [];
  }, [selected, montage, showLocalization, summary.highlight]);
  const marks: TraceMark[] = showLocalization ? [{ t: peakT, channel: null, tone: 'key', label: 'peak' }] : [];

  // ── Tutor ─────────────────────────────────────────────────────────────
  const tutor = useTutorBridge(progressKey?.sectionId);
  const canvasRef = useRef<TraceCanvasHandle>(null);
  const presetTitle = 'preset' in data.scenario ? SIM_PRESET_INFO[data.scenario.preset].title : 'custom simulation';
  useEffect(() => {
    tutor?.publishState(
      describeLabState({
        scenarioLabel: presetTitle,
        montageLabel: montage.label,
        source: source ? { center: centerLabel(source.center), polarity: source.polarity, spreadDeg: source.spreadDeg } : null,
        summary,
        challenge: current
          ? { prompt: current.prompt, answered: false }
          : lastAnswered
            ? { prompt: lastAnswered.prompt, answered: true, correct: answers[lastAnswered.id]?.correct, value: answers[lastAnswered.id]?.value }
            : null,
        challengesDone: answeredCount,
        challengesTotal: challenges.length,
      }),
    );
  }, [tutor, presetTitle, montage.label, source, summary, current, lastAnswered, answers, answeredCount, challenges.length]);

  const askTutor = async () => {
    if (!tutor) return;
    const image = (await canvasRef.current?.toBlob('image/png')) ?? undefined;
    await tutor
      .askAboutView({ prompt: 'Wyjaśnij mi, co pokazuje ten montaż (symulacja w załączniku).', image: image ?? undefined })
      .catch(() => {});
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div style={eegWidgetBodyStyle} data-montage-lab="" data-synthetic="true">
      {data.prompt ? (
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>
          <MarkdownInline>{data.prompt}</MarkdownInline>
        </div>
      ) : null}

      <div role="toolbar" aria-label="Montage" style={eegToolbarStyle}>
        <SimulationBadge label={data.simulationLabel} />
        {montages.map((m) => (
          <ToolButton key={m.id} active={m.id === montage.id} onClick={() => chooseMontage(m.id)} title={m.label}>
            {SHORT_MONTAGE_LABEL[m.id] ?? m.label}
          </ToolButton>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 220px', maxWidth: 280, minWidth: 180 }}>
          <HeadMap
            electrodes={HEAD_ELECTRODES}
            values={field}
            maxAbs={fieldMax}
            selected={selected}
            emphasized={showLocalization ? summary.electrodes : []}
            correct={lastAnswered && answers[lastAnswered.id]?.correct ? [answers[lastAnswered.id].value] : []}
            wrong={lastAnswered && answers[lastAnswered.id] && !answers[lastAnswered.id].correct ? [answers[lastAnswered.id].value] : []}
            source={source ? source.center : null}
            onSourceMove={canEdit && data.editable.moveSource ? (p) => queueEdit({ center: p }) : undefined}
            onElectrodeClick={onElectrodeClick}
          />
          <FieldLegend maxAbs={fieldMax} />
        </div>
        <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
          {source ? (
            <>
              <span style={eegMutedTextStyle}>
                Source: <strong style={{ color: 'var(--text)' }}>{centerLabel(source.center)}</strong> · {source.polarity} · spread {Math.round(source.spreadDeg)}°
              </span>
              {canEdit ? (
                <span style={eegMutedTextStyle}>
                  <Crosshair size={11} aria-hidden /> Drag on the head to move the source; click an electrode to highlight its channels.
                </span>
              ) : editingLocked ? (
                <span style={eegMutedTextStyle}>Answer the questions first — then you can move the source freely.</span>
              ) : null}
              {canEdit && (data.editable.polarity || data.editable.spread) ? (
                <div style={eegToolbarStyle}>
                  {data.editable.polarity ? (
                    <ToolButton
                      onClick={() => {
                        setEdit((e) => ({ ...e, polarity: source.polarity === 'negative' ? 'positive' : 'negative' }));
                        explored();
                      }}
                      title="Flip the polarity of the simulated source"
                    >
                      {source.polarity === 'negative' ? '− negative' : '+ positive'}
                    </ToolButton>
                  ) : null}
                  {data.editable.spread ? (
                    <label style={{ ...eegMutedTextStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      Spread
                      <input
                        type="range"
                        min={SPREAD_RANGE_DEG.min}
                        max={SPREAD_RANGE_DEG.max}
                        value={Math.round(source.spreadDeg)}
                        onChange={(e) => {
                          queueEdit({ spreadDeg: Number(e.target.value) });
                          explored();
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        aria-label="Spread of the simulated field (degrees)"
                      />
                    </label>
                  ) : null}
                  <ToolButton onClick={() => setEdit({})} title="Back to the original source">
                    <RotateCcw size={13} aria-hidden />
                    Reset
                  </ToolButton>
                </div>
              ) : null}
            </>
          ) : null}
          {selected ? (
            <span style={eegMutedTextStyle}>
              Channels with <strong style={{ color: 'var(--text)' }}>{selected}</strong> are highlighted.
            </span>
          ) : null}
          <div style={eegToolbarStyle}>
            <ToolButton
              active={showLocalization}
              disabled={editingLocked}
              onClick={() => setShowLocalization((s) => !s)}
              title={editingLocked ? 'Unlocks after the questions' : 'Show the computed localisation'}
            >
              Localisation
            </ToolButton>
            <ToolButton aria-label="Smaller traces" onClick={() => setSensitivity((s) => stepOption(LAB_SENSITIVITIES, s, 1))}>
              <Minus size={13} aria-hidden />
            </ToolButton>
            <span style={eegMutedTextStyle}>{sensitivity} µV/mm</span>
            <ToolButton aria-label="Larger traces" onClick={() => setSensitivity((s) => stepOption(LAB_SENSITIVITIES, s, -1))}>
              <Plus size={13} aria-hidden />
            </ToolButton>
            {tutor ? (
              <ToolButton onClick={() => void askTutor()} title="Ask the AI tutor about this view">
                <MessageCircleQuestion size={13} aria-hidden />
                Ask tutor
              </ToolButton>
            ) : null}
          </div>
        </div>
      </div>

      <TraceCanvas
        ref={canvasRef}
        channels={channels}
        sampleRate={recording.sampleRate}
        startSec={0}
        secondsPerPage={Math.min(LAB_EPOCH_SEC, recording.durationSec)}
        sensitivityUvPerMm={sensitivity}
        highlightChannels={highlight}
        marks={marks}
        onChannelClick={(_, label) => {
          if (canAnswer && current?.answer.kind === 'channel') answer({ channel: label });
        }}
        ariaLabel={`Simulated EEG, ${montage.label}`}
        ariaDescription={`Synthetic simulation. ${summary.lines.join(' ').replace(/\*\*/g, '')}`}
      >
        <SimulationBadge
          label={data.simulationLabel}
          variant="overlay"
          style={{ top: 0, left: 0, right: 'auto', alignItems: 'flex-start', transform: 'scale(0.85)', transformOrigin: 'top left' }}
        />
      </TraceCanvas>

      {showLocalization ? (
        <FeedbackPanel tone="neutral" title={`What ${montage.label.toLowerCase()} shows`}>
          {summary.lines.map((l, i) => (
            <p key={i} style={{ margin: i ? '6px 0 0' : 0 }}>
              <MarkdownInline>{l}</MarkdownInline>
            </p>
          ))}
        </FeedbackPanel>
      ) : null}

      {challenges.length > 0 ? (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--bg-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          <span style={eegMutedTextStyle}>
            Question {showingFeedback && lastAnswered ? challenges.indexOf(lastAnswered) + 1 : Math.min(answeredCount + 1, challenges.length)} of {challenges.length}
          </span>
          {showingFeedback && lastAnswered ? (
            <FeedbackPanel
              tone={answers[lastAnswered.id].correct ? 'success' : 'danger'}
              title={answers[lastAnswered.id].correct ? `Correct — ${answers[lastAnswered.id].value}` : `Not quite — you chose ${answers[lastAnswered.id].value}`}
            >
              <MarkdownInline>{lastAnswered.explanation}</MarkdownInline>
            </FeedbackPanel>
          ) : null}
          {current ? (
            showingFeedback ? (
              <div>
                <ToolButton primary onClick={() => setFeedbackId(null)}>
                  Next question <ArrowRight size={13} aria-hidden />
                </ToolButton>
              </div>
            ) : (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>
                <MarkdownInline>{current.prompt}</MarkdownInline>
                <div style={{ ...eegMutedTextStyle, marginTop: 4 }}>
                  {current.answer.kind === 'electrode' ? 'Click an electrode on the head map.' : 'Click a channel in the traces.'}
                </div>
              </div>
            )
          ) : allAnswered ? (
            <span style={eegMutedTextStyle}>
              {challenges.filter((c) => answers[c.id]?.correct).length}/{challenges.length} correct — now move the source and switch montages freely.
            </span>
          ) : null}
        </div>
      ) : null}

      {data.caption ? (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
          <MarkdownInline>{data.caption}</MarkdownInline>
        </div>
      ) : null}
    </div>
  );
}

export default MontageLabWidget;
