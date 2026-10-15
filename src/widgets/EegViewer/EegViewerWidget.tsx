'use client';

// eegViewer — multichannel EEG reader (spec §3.1).
//
// Real recordings (asset JSON) or synthetic mechanism demos (always badged
// "SYMULACJA") rendered on the shared TraceCanvas with clinical controls:
// montage, sensitivity (µV/mm), timebase (s/page), LFF/HFF/notch, paging,
// a caliper (Δt / Hz / µV) and optional "mark the events" tasks graded
// against an expert key.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  MessageCircleQuestion,
  Minus,
  Plus,
  RotateCcw,
  Ruler,
  SlidersHorizontal,
  Tag,
  Trash2,
} from 'lucide-react';

import { MarkdownInline } from '@/components/MarkdownInline';
import {
  availableMontages,
  channelInvolves,
  channelMatchesTarget,
  createDisplayCache,
  formatTime,
  formatTimeRange,
  measureWindow,
  nativeMontage,
  scoreTimeMarks,
  stepOption,
  type DecodedRecording,
  type Montage,
  type TimeScore,
} from '@/lib/eeg';
import { useTutorBridge } from '@/lib/lessonChat/tutorBridge';
import {
  AttributionLine,
  DataErrorCard,
  SimulationBadge,
  TraceCanvas,
  parseWidgetState,
  useParsedData,
  useWidgetProgress,
  type EegWidgetProps,
  type TraceCaliper,
  type TraceCanvasHandle,
  type TraceMark,
  type TraceMarkInput,
  type TraceShading,
} from '@/widgets/common/eeg';
import { useRecordingSource } from '@/widgets/common/eeg/useRecordingSource';
import {
  FeedbackPanel,
  ToolButton,
  ToolSelect,
  eegMutedTextStyle,
  eegToolbarStyle,
  eegWidgetBodyStyle,
} from '@/widgets/common/eeg/ui';

import {
  BUILTIN_MONTAGE_IDS,
  EegViewerDataSchema,
  EegViewerStateSchema,
  NARROW_VIEWER_PX,
  VIEWER_OPTIONS,
  clampStart,
  describeViewerState,
  filterSettings,
  pageStart,
  resolveInitialSettings,
  withValue,
  type EegViewerData,
  type EegViewerState,
  type ViewerMark,
  type ViewerSettings,
} from './schema';

export type EegViewerWidgetProps = EegWidgetProps<EegViewerData>;

const ASK_TUTOR_PROMPT = 'Pomóż mi zinterpretować ten fragment zapisu EEG (widok w załączniku).';

export function EegViewerWidget(props: EegViewerWidgetProps) {
  const parsed = useParsedData(EegViewerDataSchema, props.data);
  if (!parsed.ok) return <DataErrorCard title="This EEG viewer's data is invalid" error={parsed.error} />;
  return <EegViewerLoader {...props} data={parsed.data} />;
}

function EegViewerLoader(props: EegViewerWidgetProps & { data: EegViewerData }) {
  const state = useRecordingSource(props.data.source);
  if (state.status === 'error') {
    return (
      <div style={eegWidgetBodyStyle}>
        <DataErrorCard title="The EEG signal could not be loaded" error={state.error} />
      </div>
    );
  }
  if (state.status === 'loading') {
    return (
      <div style={{ ...eegWidgetBodyStyle, minHeight: 200 }} aria-busy="true">
        <span style={eegMutedTextStyle}>Loading EEG…</span>
      </div>
    );
  }
  return <EegViewerReady {...props} recording={state.recording} />;
}

function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(`(max-width: ${NARROW_VIEWER_PX}px)`).matches
    : false;
}

function hzLabel(v: number | null): string {
  return v === null ? 'off' : `${v} Hz`;
}

function sourceLabelOf(data: EegViewerData, rec: DecodedRecording): string {
  if (data.source.kind === 'simulation') return `simulation preset "${data.source.preset ?? 'custom spec'}"`;
  const s = rec.source;
  return s ? [s.dataset, s.record].filter(Boolean).join(', ') : data.source.src;
}

type Mode = 'view' | 'caliper' | 'mark';

function EegViewerReady({
  data,
  recording: rec,
  progressKey,
  onComplete,
  initialWidgetState,
  alreadyCompleted,
}: EegViewerWidgetProps & { data: EegViewerData; recording: DecodedRecording }) {
  const synthetic = rec.synthetic || data.source.kind === 'simulation';
  const task = data.task;
  const controls = data.controls;

  // ── Montages the learner can pick ─────────────────────────────────────
  const montages: Montage[] = useMemo(() => {
    const list = availableMontages(rec, data.allowedMontages ?? BUILTIN_MONTAGE_IDS);
    return list.length > 0 ? list : [nativeMontage(rec)];
  }, [rec, data.allowedMontages]);

  // ── State (restored from progress when valid) ─────────────────────────
  const [persisted] = useState<EegViewerState | null>(() => parseWidgetState(initialWidgetState, EegViewerStateSchema));
  const [settings, setSettings] = useState<ViewerSettings>(() => {
    const ids = montages.map((m) => m.id);
    const s = persisted?.settings;
    if (s && ids.includes(s.montage)) {
      return { ...s, startSec: clampStart(s.startSec, s.secondsPerPage, rec.durationSec) };
    }
    return resolveInitialSettings(data, { availableMontages: ids, durationSec: rec.durationSec, narrow: isNarrowViewport() });
  });
  const [marks, setMarks] = useState<ViewerMark[]>(() => (task ? persisted?.marks ?? [] : []));
  const [checked, setChecked] = useState<boolean>(() => !!task && (persisted?.checked ?? false));
  const [mode, setMode] = useState<Mode>('view');
  const [caliper, setCaliper] = useState<TraceCaliper | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState<boolean>(
    () => data.annotations === 'always' || (data.annotations === 'toggle' && !task),
  );

  const montage = montages.find((m) => m.id === settings.montage) ?? montages[0];
  const filters = useMemo(
    () => filterSettings(settings, data.initial.filterPhase),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.lffHz, settings.hffHz, settings.notchHz, data.initial.filterPhase],
  );
  const [cache] = useState(() => createDisplayCache(4));
  const channels = useMemo(() => cache.get(rec, montage, filters), [cache, rec, montage, filters]);

  // ── Scoring ───────────────────────────────────────────────────────────
  const score: TimeScore | null = useMemo(() => {
    if (!task || !checked) return null;
    return scoreTimeMarks(marks, task.targets, task.toleranceSec, { requireChannel: task.requireChannel });
  }, [task, checked, marks]);

  // ── Progress + completion ─────────────────────────────────────────────
  const progress = useWidgetProgress(progressKey);
  const completedRef = useRef<boolean>(!!alreadyCompleted || (!!task && (persisted?.checked ?? false)));
  const widgetState = useMemo<EegViewerState>(
    () => ({ v: 1, settings, marks, checked }),
    [settings, marks, checked],
  );
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Settings / draft marks: merge-save, keeps the stored done + score.
    progress.saveDebounced({ widgetState });
  }, [widgetState, progress]);

  const complete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete?.();
  }, [onComplete]);

  // Exploratory viewers (no task) count as done after the first real interaction.
  const touch = useCallback(() => {
    if (task) return;
    if (!completedRef.current) {
      void progress.saveNow({ done: true, widgetState });
      complete();
    }
  }, [task, progress, widgetState, complete]);

  const update = useCallback(
    (patch: Partial<ViewerSettings>) => {
      setSettings((s) => {
        const next = { ...s, ...patch };
        next.startSec = clampStart(next.startSec, next.secondsPerPage, rec.durationSec);
        return next;
      });
      touch();
    },
    [rec.durationSec, touch],
  );

  const page = useCallback(
    (dir: 1 | -1) => {
      setSettings((s) => ({ ...s, startSec: pageStart(s, dir, rec.durationSec) }));
      setCaliper(null);
      touch();
    },
    [rec.durationSec, touch],
  );

  const onCheck = () => {
    if (!task) return;
    const result = scoreTimeMarks(marks, task.targets, task.toleranceSec, { requireChannel: task.requireChannel });
    setChecked(true);
    setMode('view');
    setShowAnnotations(data.annotations !== 'hidden');
    void progress.saveNow({
      done: true,
      widgetState: { v: 1, settings, marks, checked: true },
      score: { correct: result.hits, total: task.targets.length },
    });
    complete();
  };

  const onRetry = () => {
    setChecked(false);
    setMarks([]);
    setMode('mark');
    setShowAnnotations(data.annotations === 'always');
  };

  const addMark = (m: TraceMarkInput) => {
    if (!task || checked) return;
    if (task.maxMarks !== undefined && marks.length >= task.maxMarks) return;
    setMarks((prev) => [...prev, 't' in m ? { t: m.t, channel: m.channel } : { t0: m.t0, t1: m.t1, channel: m.channel }]);
  };

  // ── Overlays ──────────────────────────────────────────────────────────
  const channelLabelsFor = useCallback(
    (electrodesOrChannels: readonly string[] | undefined): string[] | null => {
      if (!electrodesOrChannels || electrodesOrChannels.length === 0) return null;
      const labels = montage.channels
        .filter((ch) =>
          electrodesOrChannels.some((e) => channelInvolves(ch, e) || channelMatchesTarget(ch.label, [e])),
        )
        .map((ch) => ch.label);
      return labels.length > 0 ? labels : null;
    },
    [montage],
  );

  const shadings: TraceShading[] = useMemo(() => {
    const out: TraceShading[] = [];
    if (showAnnotations) {
      for (const a of rec.annotations) {
        const t1 = a.onsetSec + Math.max(a.durationSec ?? 0, 0.05);
        out.push({ t0: a.onsetSec, t1, channels: channelLabelsFor(a.channels), tone: 'annotation', label: a.label });
      }
    }
    if (task && checked && score) {
      task.targets.forEach((tg, i) => {
        if (tg.offsetSec === undefined) return;
        out.push({
          t0: tg.onsetSec,
          t1: tg.offsetSec,
          channels: channelLabelsFor(tg.channels),
          tone: score.targets[i]?.hit ? 'key' : 'miss',
          label: tg.label,
        });
      });
    }
    return out;
  }, [showAnnotations, rec.annotations, task, checked, score, channelLabelsFor]);

  const traceMarks: TraceMark[] = useMemo(() => {
    if (!task) return [];
    const out: TraceMark[] = marks.map((m, i) => {
      const reason = score?.marks[i]?.reason;
      const tone: TraceMark['tone'] = !score ? 'mark' : reason === 'matched' ? 'hit' : 'false';
      return 't' in m ? { t: m.t, channel: m.channel, tone } : { t: m.t0, t1: m.t1, channel: m.channel, tone };
    });
    if (score) {
      task.targets.forEach((tg, i) => {
        if (tg.offsetSec !== undefined) return;
        out.push({ t: tg.onsetSec, channel: null, tone: score.targets[i]?.hit ? 'key' : 'miss', label: tg.label });
      });
    }
    return out;
  }, [task, marks, score]);

  // ── Caliper readout for the tutor ─────────────────────────────────────
  const caliperInfo = useMemo(() => {
    if (!caliper) return null;
    const ch = channels[caliper.channelIndex];
    if (!ch || !ch.available) return null;
    const m = measureWindow(ch.data, rec.sampleRate, Math.min(caliper.t0, caliper.t1), Math.max(caliper.t0, caliper.t1));
    return { dtMs: m.dtMs, freqHz: m.freqHz, ppUv: m.ppUv, channel: ch.label };
  }, [caliper, channels, rec.sampleRate]);

  // ── Tutor bridge ──────────────────────────────────────────────────────
  const tutor = useTutorBridge(progressKey?.sectionId);
  const canvasRef = useRef<TraceCanvasHandle>(null);
  useEffect(() => {
    tutor?.publishState(
      describeViewerState({
        settings,
        montageLabel: montage.label,
        durationSec: rec.durationSec,
        synthetic,
        sourceLabel: sourceLabelOf(data, rec),
        task,
        marks,
        checked,
        result: score ? { hits: score.hits, misses: score.misses, falseMarks: score.falseMarks.length } : null,
        caliper: caliperInfo,
      }),
    );
  }, [tutor, settings, montage.label, rec, synthetic, data, task, marks, checked, score, caliperInfo]);

  const askTutor = async () => {
    if (!tutor) return;
    const image = (await canvasRef.current?.toBlob('image/png')) ?? undefined;
    await tutor.askAboutView({ prompt: ASK_TUTOR_PROMPT, image: image ?? undefined }).catch(() => {});
  };

  // ── Keyboard ──────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        if (controls.navigation) page(-1);
        break;
      case 'ArrowRight':
        if (controls.navigation) page(1);
        break;
      case '+':
      case '=':
        if (controls.sensitivity) update({ sensitivityUvPerMm: stepOption(VIEWER_OPTIONS.sensitivity, settings.sensitivityUvPerMm, -1) });
        break;
      case '-':
      case '_':
        if (controls.sensitivity) update({ sensitivityUvPerMm: stepOption(VIEWER_OPTIONS.sensitivity, settings.sensitivityUvPerMm, 1) });
        break;
      case 'c':
        if (controls.caliper) setMode((m) => (m === 'caliper' ? 'view' : 'caliper'));
        break;
      case 'm':
        if (task && !checked) setMode((m) => (m === 'mark' ? 'view' : 'mark'));
        break;
      case 'Escape':
        setMode('view');
        setCaliper(null);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  const interaction = mode === 'caliper' ? 'caliper' : mode === 'mark' ? (task?.mode === 'range' ? 'markRange' : 'markPoint') : 'none';
  const pageEnd = Math.min(rec.durationSec, settings.startSec + settings.secondsPerPage);
  const canPage = controls.navigation && rec.durationSec > settings.secondsPerPage + 1e-6;
  const attribution =
    data.attribution ??
    (rec.source && rec.source.license
      ? { text: [rec.source.citation ?? rec.source.dataset, rec.source.record].filter(Boolean).join(' — '), license: rec.source.license, url: rec.source.url }
      : undefined);
  const sensOptions = withValue(VIEWER_OPTIONS.sensitivity, settings.sensitivityUvPerMm);
  const sppOptions = withValue(VIEWER_OPTIONS.secondsPerPage, settings.secondsPerPage);
  const filterSummary = `${settings.lffHz ?? '–'}–${settings.hffHz ?? '–'} Hz${settings.notchHz ? `, notch ${settings.notchHz}` : ''}`;

  return (
    <div style={eegWidgetBodyStyle} data-eeg-viewer="" data-synthetic={synthetic ? 'true' : 'false'}>
      {data.prompt ? (
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>
          <MarkdownInline>{data.prompt}</MarkdownInline>
        </div>
      ) : null}

      <div role="toolbar" aria-label="EEG display controls" style={eegToolbarStyle}>
        {synthetic ? <SimulationBadge label={data.simulationLabel} /> : null}
        {controls.montage && montages.length > 1 ? (
          <ToolSelect
            label="Montage"
            value={montage.id}
            options={montages.map((m) => ({ value: m.id, label: m.label }))}
            onChange={(e) => {
              update({ montage: e.target.value });
              setCaliper(null);
            }}
          />
        ) : (
          <span style={eegMutedTextStyle}>{montage.label}</span>
        )}
        {controls.sensitivity ? (
          <>
            <ToolButton
              aria-label="Smaller traces (higher µV/mm)"
              title="Smaller traces (−)"
              onClick={() => update({ sensitivityUvPerMm: stepOption(VIEWER_OPTIONS.sensitivity, settings.sensitivityUvPerMm, 1) })}
            >
              <Minus size={13} aria-hidden />
            </ToolButton>
            <ToolSelect
              label="Sens"
              value={String(settings.sensitivityUvPerMm)}
              options={sensOptions.map((v) => ({ value: String(v), label: `${v} µV/mm` }))}
              onChange={(e) => update({ sensitivityUvPerMm: Number(e.target.value) })}
            />
            <ToolButton
              aria-label="Larger traces (lower µV/mm)"
              title="Larger traces (+)"
              onClick={() => update({ sensitivityUvPerMm: stepOption(VIEWER_OPTIONS.sensitivity, settings.sensitivityUvPerMm, -1) })}
            >
              <Plus size={13} aria-hidden />
            </ToolButton>
          </>
        ) : null}
        {controls.timebase ? (
          <ToolSelect
            label="Time"
            value={String(settings.secondsPerPage)}
            options={sppOptions.map((v) => ({ value: String(v), label: `${v} s/page` }))}
            onChange={(e) => update({ secondsPerPage: Number(e.target.value) })}
          />
        ) : null}
        {controls.filters ? (
          <ToolButton active={filtersOpen} onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} title="Display filters">
            <SlidersHorizontal size={13} aria-hidden />
            {filterSummary}
          </ToolButton>
        ) : null}
      </div>

      {controls.filters && filtersOpen ? (
        <div role="group" aria-label="Display filters" style={eegToolbarStyle}>
          <ToolSelect
            label="LFF"
            value={String(settings.lffHz)}
            options={withValue(VIEWER_OPTIONS.lff, settings.lffHz).map((v) => ({ value: String(v), label: hzLabel(v) }))}
            onChange={(e) => update({ lffHz: e.target.value === 'null' ? null : Number(e.target.value) })}
          />
          <ToolSelect
            label="HFF"
            value={String(settings.hffHz)}
            options={withValue(VIEWER_OPTIONS.hff, settings.hffHz).map((v) => ({ value: String(v), label: hzLabel(v) }))}
            onChange={(e) => update({ hffHz: e.target.value === 'null' ? null : Number(e.target.value) })}
          />
          <ToolSelect
            label="Notch"
            value={String(settings.notchHz)}
            options={[null, 50, 60].map((v) => ({ value: String(v), label: hzLabel(v) }))}
            onChange={(e) => update({ notchHz: e.target.value === 'null' ? null : Number(e.target.value) })}
          />
          <span style={eegMutedTextStyle}>Display filters are zero-phase (no latency shift).</span>
        </div>
      ) : null}

      <TraceCanvas
        ref={canvasRef}
        channels={channels}
        sampleRate={rec.sampleRate}
        startSec={settings.startSec}
        secondsPerPage={settings.secondsPerPage}
        sensitivityUvPerMm={settings.sensitivityUvPerMm}
        height={data.height}
        shadings={shadings}
        marks={traceMarks}
        caliper={caliper}
        interaction={interaction}
        onCaliperChange={(c) => {
          setCaliper(c);
          if (c) touch();
        }}
        onMarkAdd={addMark}
        onSwipe={(d) => (canPage ? page(d === 'next' ? 1 : -1) : undefined)}
        touchAction={mode === 'view' ? 'pan-y' : 'none'}
        onKeyDown={onKeyDown}
        ariaLabel={`EEG, ${montage.label}, ${formatTimeRange(settings.startSec, pageEnd)}`}
        ariaDescription={`${synthetic ? 'Synthetic simulation. ' : ''}${channels.length} channels, ${settings.sensitivityUvPerMm} µV/mm, ${settings.secondsPerPage} s per page. Keys: arrows page, plus/minus sensitivity, c caliper${task ? ', m mark' : ''}.`}
      >
        {/* Top-left, over the label column / time-axis gutter: never covers the
            caliper readout (top-right) or the scale bar (bottom-right). */}
        {synthetic ? (
          <SimulationBadge label={data.simulationLabel} variant="overlay" style={{ top: 0, left: 0, right: 'auto', alignItems: 'flex-start', transform: 'scale(0.85)', transformOrigin: 'top left' }} />
        ) : null}
      </TraceCanvas>

      <div role="toolbar" aria-label="EEG navigation and tools" style={{ ...eegToolbarStyle, justifyContent: 'space-between' }}>
        <div style={eegToolbarStyle}>
          {canPage ? (
            <ToolButton aria-label="Previous page" title="Previous page (←)" onClick={() => page(-1)} disabled={settings.startSec <= 0}>
              <ChevronLeft size={14} aria-hidden />
            </ToolButton>
          ) : null}
          <span style={eegMutedTextStyle}>
            {formatTimeRange(settings.startSec, pageEnd)} / {formatTime(rec.durationSec)}
          </span>
          {canPage ? (
            <ToolButton
              aria-label="Next page"
              title="Next page (→)"
              onClick={() => page(1)}
              disabled={settings.startSec + settings.secondsPerPage >= rec.durationSec - 1e-6}
            >
              <ChevronRight size={14} aria-hidden />
            </ToolButton>
          ) : null}
        </div>
        <div style={eegToolbarStyle}>
          {controls.caliper ? (
            <ToolButton
              active={mode === 'caliper'}
              onClick={() => {
                setMode((m) => (m === 'caliper' ? 'view' : 'caliper'));
                setCaliper(null);
              }}
              title="Caliper (c): drag along a channel to measure duration, frequency and amplitude"
            >
              <Ruler size={13} aria-hidden />
              Caliper
            </ToolButton>
          ) : null}
          {rec.annotations.length > 0 && data.annotations === 'toggle' ? (
            <ToolButton
              active={showAnnotations}
              disabled={!!task && !checked}
              onClick={() => setShowAnnotations((s) => !s)}
              title={task && !checked ? 'Expert annotations unlock after you check your answer' : 'Show expert annotations'}
            >
              {showAnnotations ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
              Annotations
            </ToolButton>
          ) : null}
          {task && !checked ? (
            <ToolButton active={mode === 'mark'} onClick={() => setMode((m) => (m === 'mark' ? 'view' : 'mark'))} title="Mark mode (m)">
              <Tag size={13} aria-hidden />
              Mark
            </ToolButton>
          ) : null}
          {tutor ? (
            <ToolButton onClick={() => void askTutor()} title="Ask the AI tutor about this view (attaches a screenshot)">
              <MessageCircleQuestion size={13} aria-hidden />
              Ask tutor
            </ToolButton>
          ) : null}
        </div>
      </div>

      {mode === 'caliper' && !caliper ? (
        <span style={eegMutedTextStyle}>Drag along one channel to measure Δt, frequency and peak-to-peak amplitude.</span>
      ) : null}

      {task ? (
        <TaskPanel
          task={task}
          marks={marks}
          checked={checked}
          score={score}
          onRemove={(i) => setMarks((prev) => prev.filter((_, k) => k !== i))}
          onCheck={onCheck}
          onRetry={onRetry}
          onStartMarking={() => setMode('mark')}
          marking={mode === 'mark'}
        />
      ) : null}

      {data.caption ? (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
          <MarkdownInline>{data.caption}</MarkdownInline>
        </div>
      ) : null}
      {attribution ? <AttributionLine attribution={attribution} /> : null}
    </div>
  );
}

function fmtMark(m: ViewerMark): string {
  const ch = m.channel ? ` · ${m.channel}` : '';
  return 't' in m ? `${m.t.toFixed(2)} s${ch}` : `${m.t0.toFixed(2)}–${m.t1.toFixed(2)} s${ch}`;
}

function TaskPanel({
  task,
  marks,
  checked,
  score,
  onRemove,
  onCheck,
  onRetry,
  onStartMarking,
  marking,
}: {
  task: NonNullable<EegViewerData['task']>;
  marks: ViewerMark[];
  checked: boolean;
  score: TimeScore | null;
  onRemove: (index: number) => void;
  onCheck: () => void;
  onRetry: () => void;
  onStartMarking: () => void;
  marking: boolean;
}) {
  const limitReached = task.maxMarks !== undefined && marks.length >= task.maxMarks;
  const allFound = !!score && score.allRequiredHit && score.falseMarks.length === 0;
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3) var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        background: 'var(--bg-subtle)',
      }}
    >
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>
        <MarkdownInline>{task.prompt}</MarkdownInline>
      </div>
      {!checked ? (
        <span style={eegMutedTextStyle}>
          {marking
            ? task.mode === 'range'
              ? 'Drag across the event on the channel where you see it.'
              : 'Click the event on the channel where you see it.'
            : 'Turn on Mark mode, then mark every event you find.'}
          {task.maxMarks !== undefined ? ` (max ${task.maxMarks})` : ''}
        </span>
      ) : null}
      {marks.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }} aria-label="Your marks">
          {marks.map((m, i) => {
            const reason = score?.marks[i]?.reason;
            const tone = !score ? 'var(--border)' : reason === 'matched' ? 'var(--success-border)' : 'var(--danger-border)';
            return (
              <li
                key={i}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 4px 2px 8px',
                  borderRadius: 'var(--radius-full)',
                  border: `1px solid ${tone}`,
                  fontSize: 'var(--fs-xs)',
                  fontVariantNumeric: 'tabular-nums',
                  background: 'var(--bg-elevated)',
                }}
              >
                {score ? (reason === 'matched' ? '✓ ' : '✗ ') : null}
                {fmtMark(m)}
                {!checked ? (
                  <button
                    type="button"
                    aria-label={`Remove mark ${fmtMark(m)}`}
                    onClick={() => onRemove(i)}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'inline-flex', padding: 2 }}
                  >
                    <Trash2 size={12} aria-hidden />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div style={eegToolbarStyle}>
        {!checked ? (
          <>
            {!marking ? (
              <ToolButton onClick={onStartMarking}>
                <Tag size={13} aria-hidden />
                Start marking
              </ToolButton>
            ) : null}
            <ToolButton primary onClick={onCheck} disabled={marks.length === 0}>
              Check
            </ToolButton>
            {limitReached ? <span style={eegMutedTextStyle}>Mark limit reached — remove one to add another.</span> : null}
          </>
        ) : (
          <ToolButton onClick={onRetry}>
            <RotateCcw size={13} aria-hidden />
            Try again
          </ToolButton>
        )}
      </div>
      {checked && score ? (
        <FeedbackPanel
          tone={allFound ? 'success' : score.hits > 0 ? 'warning' : 'danger'}
          title={`Found ${score.hits} of ${task.targets.length}${score.falseMarks.length ? ` · ${score.falseMarks.length} false mark${score.falseMarks.length > 1 ? 's' : ''}` : ''}`}
        >
          {score.targets.some((t) => !t.hit) ? (
            <div style={{ fontSize: 'var(--fs-sm)', marginBottom: 'var(--space-2)' }}>
              Missed:{' '}
              {task.targets
                .filter((_, i) => !score.targets[i]?.hit)
                .map((t) => `${t.label} (${t.onsetSec.toFixed(1)} s)`)
                .join('; ')}
            </div>
          ) : null}
          <MarkdownInline>{task.explanation}</MarkdownInline>
        </FeedbackPanel>
      ) : null}
    </div>
  );
}

export default EegViewerWidget;
