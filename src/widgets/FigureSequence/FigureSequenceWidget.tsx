'use client';

// figureSequence — step through, slide across (e.g. maturation by age) or
// compare side by side REAL figures (spec §3.6). Each figure is zoomable;
// neighbours are preloaded; done after every frame was seen (stepper /
// slider) or after the first interaction (compare).

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { MarkdownInline } from '@/components/MarkdownInline';
import { useTutorBridge } from '@/lib/lessonChat/tutorBridge';
import {
  AttributionLine,
  DataErrorCard,
  FigureCanvas,
  parseWidgetState,
  useParsedData,
  useWidgetProgress,
  type EegWidgetProps,
} from '@/widgets/common/eeg';
import { ToolButton, ToolSelect, eegMutedTextStyle, eegToolbarStyle, eegWidgetBodyStyle } from '@/widgets/common/eeg/ui';

import {
  FigureSequenceDataSchema,
  FigureSequenceStateSchema,
  compareInitial,
  describeSequenceState,
  initialIndex,
  isSequenceComplete,
  tickLabelIndices,
  type FigureSequenceData,
  type FigureSequenceState,
} from './schema';

export type FigureSequenceWidgetProps = EegWidgetProps<FigureSequenceData>;

export function FigureSequenceWidget(props: FigureSequenceWidgetProps) {
  const parsed = useParsedData(FigureSequenceDataSchema, props.data);
  if (!parsed.ok) return <DataErrorCard title="This figure sequence's data is invalid" error={parsed.error} />;
  return <FigureSequenceReady {...props} data={parsed.data} />;
}

type Frame = FigureSequenceData['frames'][number];

function FramePanel({ frame }: { frame: Frame }) {
  const caption = frame.caption ?? frame.figure.caption;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: '1 1 0' }}>
      <FigureCanvas key={frame.id} src={frame.figure.src} alt={frame.figure.alt} naturalWidth={frame.figure.width} naturalHeight={frame.figure.height} interaction="pan" />
      {caption ? (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
          <MarkdownInline>{caption}</MarkdownInline>
        </div>
      ) : null}
      <AttributionLine attribution={frame.figure.attribution} />
    </div>
  );
}

/** Warm the browser cache for the neighbouring frames. */
function usePreload(srcs: readonly string[]) {
  useEffect(() => {
    if (typeof Image === 'undefined') return;
    for (const s of srcs) {
      const img = new Image();
      img.decoding = 'async';
      img.src = s;
    }
  }, [srcs]);
}

function FigureSequenceReady({ data, progressKey, onComplete, initialWidgetState, alreadyCompleted }: FigureSequenceWidgetProps & { data: FigureSequenceData }) {
  const frames = data.frames;
  const [persisted] = useState<FigureSequenceState | null>(() => parseWidgetState(initialWidgetState, FigureSequenceStateSchema));
  const [index, setIndex] = useState(() => initialIndex(data));
  const [pair, setPair] = useState<[number, number]>(() => compareInitial(data));
  const [seen, setSeen] = useState<string[]>(() => Array.from(new Set([...(persisted?.seen ?? []), frames[initialIndex(data)].id])));
  const [interacted, setInteracted] = useState(false);

  const progress = useWidgetProgress(progressKey);
  const completedRef = useRef<boolean>(!!alreadyCompleted);

  const markSeen = useCallback(
    (ids: string[], didInteract: boolean) => {
      const nextSeen = Array.from(new Set([...seen, ...ids]));
      setSeen(nextSeen);
      if (didInteract) setInteracted(true);
      const state: FigureSequenceState = { v: 1, seen: nextSeen };
      if (!completedRef.current && isSequenceComplete(data.layout, nextSeen, frames.length, didInteract || interacted)) {
        completedRef.current = true;
        void progress.saveNow({ done: true, widgetState: state });
        onComplete?.();
      } else {
        progress.saveDebounced({ widgetState: state });
      }
    },
    [seen, interacted, data.layout, frames.length, progress, onComplete],
  );

  const go = (i: number) => {
    const next = Math.max(0, Math.min(frames.length - 1, i));
    setIndex(next);
    markSeen([frames[next].id], true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (data.layout === 'compare' || (e.target as HTMLElement).closest('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') go(index - 1);
    else if (e.key === 'ArrowRight') go(index + 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const neighbours = useMemo(
    () => [frames[index - 1], frames[index + 1]].filter(Boolean).map((f) => f!.figure.src),
    [frames, index],
  );
  usePreload(neighbours);

  // ── Tutor ─────────────────────────────────────────────────────────────
  const tutor = useTutorBridge(progressKey?.sectionId);
  const currentLabels = data.layout === 'compare' ? [frames[pair[0]], frames[pair[1]]].map((f) => `${f.label}: ${f.figure.alt}`) : [`${frames[index].label}: ${frames[index].figure.alt}`];
  const liveState = describeSequenceState({ layout: data.layout, current: currentLabels, seen: new Set(seen).size, total: frames.length });
  useEffect(() => {
    tutor?.publishState(liveState);
  }, [tutor, liveState]);

  const options = frames.map((f, i) => ({ value: String(i), label: f.label }));
  const ticks = tickLabelIndices(frames.length, 6);

  return (
    <div style={{ ...eegWidgetBodyStyle, outline: 'none' }} tabIndex={0} onKeyDown={onKeyDown} data-figure-sequence="" aria-label="Figure sequence">
      {data.prompt ? (
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>
          <MarkdownInline>{data.prompt}</MarkdownInline>
        </div>
      ) : null}

      {data.layout === 'compare' ? (
        <>
          <div style={{ ...eegToolbarStyle, justifyContent: 'space-between' }}>
            <ToolSelect
              label="Left"
              value={String(pair[0])}
              options={options}
              onChange={(e) => {
                setPair((p) => [Number(e.target.value), p[1]]);
                markSeen([frames[Number(e.target.value)].id], true);
              }}
            />
            <ToolSelect
              label="Right"
              value={String(pair[1])}
              options={options}
              onChange={(e) => {
                setPair((p) => [p[0], Number(e.target.value)]);
                markSeen([frames[Number(e.target.value)].id], true);
              }}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            {/* flex-basis 260px: two columns on wide content, stacked below ~560 px. */}
            <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex' }}>
              <FramePanel frame={frames[pair[0]]} />
            </div>
            <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex' }}>
              <FramePanel frame={frames[pair[1]]} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ ...eegToolbarStyle, justifyContent: 'space-between' }}>
            <ToolButton aria-label="Previous" title="Previous (←)" onClick={() => go(index - 1)} disabled={index === 0}>
              <ChevronLeft size={14} aria-hidden />
            </ToolButton>
            <strong style={{ fontSize: 'var(--fs-md)', color: 'var(--text)', textAlign: 'center', flex: 1 }}>
              {data.sliderLabel && data.layout === 'slider' ? `${data.sliderLabel}: ` : ''}
              {frames[index].label}
            </strong>
            <ToolButton aria-label="Next" title="Next (→)" onClick={() => go(index + 1)} disabled={index === frames.length - 1}>
              <ChevronRight size={14} aria-hidden />
            </ToolButton>
          </div>
          {data.layout === 'slider' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <input
                type="range"
                min={0}
                max={frames.length - 1}
                step={1}
                value={index}
                onChange={(e) => go(Number(e.target.value))}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label={data.sliderLabel ?? 'Frame'}
                aria-valuetext={frames[index].label}
                style={{ width: '100%' }}
              />
              <div style={{ position: 'relative', height: 16 }} aria-hidden>
                {ticks.map((i) => (
                  <span
                    key={i}
                    style={{
                      ...eegMutedTextStyle,
                      position: 'absolute',
                      left: `${(i / (frames.length - 1)) * 100}%`,
                      transform: i === 0 ? 'none' : i === frames.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                      whiteSpace: 'nowrap',
                      fontWeight: i === index ? 700 : 400,
                      color: i === index ? 'var(--text)' : undefined,
                    }}
                  >
                    {frames[i].label}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div role="tablist" aria-label="Frames" style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
              {frames.map((f, i) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={f.label}
                  onClick={() => go(i)}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    padding: 0,
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderColor: 'var(--border-strong)',
                    background: i === index ? 'var(--accent)' : seen.includes(f.id) ? 'var(--text-tertiary)' : 'transparent',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          )}
          <FramePanel frame={frames[index]} />
          <span style={eegMutedTextStyle}>
            Seen {new Set(seen).size} of {frames.length}
            {data.layout === 'stepper' ? ' · arrows ← → to step' : ''}
          </span>
        </>
      )}
    </div>
  );
}

export default FigureSequenceWidget;
