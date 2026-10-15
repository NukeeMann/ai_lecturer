'use client';

// A real EEG figure with marking, panning and an optional calibrated caliper.
// Shared by eegFigureMark and the `mark` steps of eegCase; the parent owns
// the marking state (useFigureMarks) and the Check / feedback UI.

import { useEffect, useMemo, useState, type Ref } from 'react';
import { Hand, MousePointer2, Ruler, Trash2 } from 'lucide-react';

import { MarkdownInline } from '@/components/MarkdownInline';

import { AttributionLine } from './AttributionLine';
import { FigureCanvas, type FigureCaliper, type FigureCanvasHandle } from './FigureCanvas';
import type { FigureCalibration, FigureRef } from './figure';
import { figureCaliperReadout, formatCaliper, type FigureOverlayItem } from './figureMath';
import { ToolButton, eegMutedTextStyle, eegToolbarStyle } from './ui';
import type { UseFigureMarksResult } from './useFigureMarks';

export interface FigureMarkBoardProps {
  figure: FigureRef;
  fm: UseFigureMarksResult;
  mode: 'point' | 'box';
  calibration?: FigureCalibration;
  canvasRef?: Ref<FigureCanvasHandle>;
  /** Current caliper readout (text) — e.g. for the tutor's live state. */
  onCaliperText?: (text: string | null) => void;
  /** Hide the caption (when the parent shows it elsewhere). */
  hideCaption?: boolean;
}

type Tool = 'mark' | 'pan' | 'caliper';

/** Normalised distance under which a click on an existing point mark removes it. */
const HIT_RADIUS = 0.015;

/** Id of the mark a click at `p` lands on (point within HIT_RADIUS, or inside a box). */
export function markAt(marks: UseFigureMarksResult['marks'], p: { x: number; y: number }): string | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (m.kind === 'point' ? Math.hypot(m.x - p.x, m.y - p.y) <= HIT_RADIUS : p.x >= m.x && p.x <= m.x + m.w && p.y >= m.y && p.y <= m.y + m.h) {
      return m.id;
    }
  }
  return null;
}

export function FigureMarkBoard({ figure, fm, mode, calibration, canvasRef, onCaliperText, hideCaption }: FigureMarkBoardProps) {
  const [tool, setTool] = useState<Tool>(fm.checked ? 'pan' : 'mark');
  const [caliper, setCaliper] = useState<FigureCaliper | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(
    figure.width && figure.height ? { width: figure.width, height: figure.height } : null,
  );

  // After Check there is nothing to mark: fall back to panning.
  const effectiveTool: Tool = fm.checked && tool === 'mark' ? 'pan' : tool;
  const interaction = effectiveTool === 'mark' ? mode : effectiveTool === 'caliper' ? 'caliper' : 'pan';

  const caliperText = useMemo(() => {
    if (!caliper || !calibration || !natural) return null;
    const r = figureCaliperReadout(caliper.from, caliper.to, natural, calibration);
    return `${formatCaliper(r)}${r.rowLabel ? ` · ${r.rowLabel}` : ''}`;
  }, [caliper, calibration, natural]);

  useEffect(() => {
    onCaliperText?.(caliperText);
  }, [caliperText, onCaliperText]);

  const overlay: FigureOverlayItem[] = useMemo(
    () => (caliper && caliperText ? [...fm.overlay, { kind: 'caliper', from: caliper.from, to: caliper.to, label: caliperText }] : fm.overlay),
    [fm.overlay, caliper, caliperText],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <div role="toolbar" aria-label="Figure tools" style={eegToolbarStyle}>
        {!fm.checked ? (
          <ToolButton active={effectiveTool === 'mark'} onClick={() => setTool('mark')} title={mode === 'box' ? 'Drag a box around each finding' : 'Click each finding'}>
            <MousePointer2 size={13} aria-hidden />
            Mark
          </ToolButton>
        ) : null}
        <ToolButton active={effectiveTool === 'pan'} onClick={() => setTool('pan')} title="Drag to pan a zoomed figure">
          <Hand size={13} aria-hidden />
          Pan
        </ToolButton>
        {calibration ? (
          <ToolButton
            active={effectiveTool === 'caliper'}
            onClick={() => {
              setTool((t) => (t === 'caliper' ? (fm.checked ? 'pan' : 'mark') : 'caliper'));
              setCaliper(null);
            }}
            title="Caliper: drag horizontally to measure duration and frequency"
          >
            <Ruler size={13} aria-hidden />
            Caliper
          </ToolButton>
        ) : null}
        <span style={eegMutedTextStyle}>
          {fm.marks.length} mark{fm.marks.length === 1 ? '' : 's'}
        </span>
        {!fm.checked && fm.marks.length > 0 ? (
          <ToolButton onClick={fm.clearMarks} title="Remove all marks">
            <Trash2 size={13} aria-hidden />
            Clear
          </ToolButton>
        ) : null}
      </div>

      <FigureCanvas
        ref={canvasRef}
        src={figure.src}
        alt={figure.alt}
        naturalWidth={figure.width}
        naturalHeight={figure.height}
        interaction={interaction}
        overlay={overlay}
        onPoint={(p) => {
          if (effectiveTool !== 'mark' || fm.checked) return;
          const hit = markAt(fm.marks, p);
          if (hit) fm.removeMark(hit);
          else if (fm.canAddMore) fm.addPoint(p);
        }}
        onBox={(r) => {
          if (effectiveTool === 'mark' && fm.canAddMore) fm.addBox(r);
        }}
        onCaliperChange={setCaliper}
        onLoad={(n) => setNatural((cur) => cur ?? n)}
      />

      {!fm.checked && effectiveTool === 'mark' ? (
        <span style={eegMutedTextStyle}>
          {mode === 'box' ? 'Drag a box around each finding' : 'Click each finding'} — click a mark again to remove it.
          {!fm.canAddMore ? ' Mark limit reached.' : ''}
        </span>
      ) : null}
      {effectiveTool === 'caliper' && !caliper ? <span style={eegMutedTextStyle}>Drag between two points to measure.</span> : null}

      {!hideCaption && figure.caption ? (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
          <MarkdownInline>{figure.caption}</MarkdownInline>
        </div>
      ) : null}
      <AttributionLine attribution={figure.attribution} />
    </div>
  );
}

export default FigureMarkBoard;
