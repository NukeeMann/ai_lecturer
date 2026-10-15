'use client';

// Top-view 10-20 head map (SVG). Nose up, LEFT hemisphere on the LEFT of the
// drawing (as seen from above, behind the patient) — "L"/"R" are labelled so
// the convention is never ambiguous. Electrodes are coloured by a signed
// field (µV) with the theme's negative/positive palette; an optional
// draggable source marker lets the learner move a simulated generator.

import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import {
  electrodeSpherical,
  projectElectrode,
  projectSpherical,
  unprojectToSpherical,
  type Point2D,
  type SphericalPoint,
} from '@/lib/eeg';

import { divergingColor } from './color';
import { useEegTheme } from './useEegTheme';

export interface HeadMapProps {
  electrodes: readonly string[];
  /** Signed field per electrode (µV); missing = neutral. */
  values?: Readonly<Record<string, number>> | null;
  /** Colour scale maximum (default: max |value|). */
  maxAbs?: number;
  selected?: string | null;
  /** Electrodes to ring (e.g. the computed localisation). */
  emphasized?: readonly string[];
  /** Electrodes marked correct / wrong after a challenge answer. */
  correct?: readonly string[];
  wrong?: readonly string[];
  /** Simulated source position (electrode name or spherical point). */
  source?: string | SphericalPoint | null;
  /** Drag anywhere on the head to move the source (θ clamped to the scalp). */
  onSourceMove?: (p: SphericalPoint) => void;
  onElectrodeClick?: (electrode: string) => void;
  ariaLabel?: string;
  style?: CSSProperties;
}

const VIEW = 1.5;

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true; // old engines / jsdom: show the ring
  }
}
const R_ELECTRODE = 0.105;
const MAX_SOURCE_THETA = 110;

function sourcePoint(source: string | SphericalPoint | null | undefined): Point2D | null {
  if (!source) return null;
  if (typeof source === 'string') {
    const s = electrodeSpherical(source);
    return s ? projectSpherical(s) : null;
  }
  return projectSpherical(source);
}

export function HeadMap({
  electrodes,
  values,
  maxAbs,
  selected,
  emphasized,
  correct,
  wrong,
  source,
  onSourceMove,
  onElectrodeClick,
  ariaLabel = 'Head map, top view, nose up, left hemisphere on the left',
  style,
}: HeadMapProps) {
  const theme = useEegTheme();
  const svgRef = useRef<SVGSVGElement>(null);
  // Keyboard focus ring drawn in SVG units: a native CSS outline on an SVG
  // element is rendered in user space and would cover the whole map.
  const [focused, setFocused] = useState<string | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean; electrode: string | null } | null>(null);

  const placed = useMemo(
    () =>
      electrodes
        .map((e) => ({ e, p: projectElectrode(e) }))
        .filter((x): x is { e: string; p: Point2D } => x.p !== null),
    [electrodes],
  );
  const scale = useMemo(() => {
    if (maxAbs && maxAbs > 0) return maxAbs;
    let m = 0;
    for (const e of electrodes) m = Math.max(m, Math.abs(values?.[e] ?? 0));
    return m || 1;
  }, [maxAbs, values, electrodes]);

  const emph = useMemo(() => new Set(emphasized ?? []), [emphasized]);
  const ok = useMemo(() => new Set(correct ?? []), [correct]);
  const bad = useMemo(() => new Set(wrong ?? []), [wrong]);
  const src = sourcePoint(source);

  const toSvg = (clientX: number, clientY: number): Point2D | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  };

  const moveSource = (e: ReactPointerEvent) => {
    if (!onSourceMove) return;
    const p = toSvg(e.clientX, e.clientY);
    if (!p) return;
    const s = unprojectToSpherical(p, MAX_SOURCE_THETA);
    onSourceMove(s);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = (e.target as Element).closest('[data-electrode]');
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, electrode: target?.getAttribute('data-electrode') ?? null };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom */
    }
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
    if (d.moved) moveSource(e);
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      if (d.electrode) onElectrodeClick?.(d.electrode);
      else if (onSourceMove) moveSource(e);
    }
  };

  const neutral = theme.bgSubtle;
  return (
    <svg
      ref={svgRef}
      viewBox={`${-VIEW} ${-VIEW} ${2 * VIEW} ${2 * VIEW}`}
      role="img"
      aria-label={ariaLabel}
      data-eeg-head-map=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      style={{
        width: '100%',
        maxWidth: 280,
        aspectRatio: '1 / 1',
        touchAction: onSourceMove ? 'none' : 'manipulation',
        cursor: onSourceMove ? 'grab' : 'default',
        userSelect: 'none',
        ...style,
      }}
    >
      {/* head, nose, ears */}
      <path d="M -0.13 -0.985 L 0 -1.16 L 0.13 -0.985" fill="none" stroke={theme.traceDim} strokeWidth={0.02} />
      <ellipse cx={-1.17} cy={0.1} rx={0.13} ry={0.27} fill="none" stroke={theme.traceDim} strokeWidth={0.02} />
      <ellipse cx={1.17} cy={0.1} rx={0.13} ry={0.27} fill="none" stroke={theme.traceDim} strokeWidth={0.02} />
      <circle cx={0} cy={0} r={1} fill="none" stroke={theme.traceDim} strokeWidth={0.02} />
      <text x={-1.38} y={-1.3} fontSize={0.13} fill={theme.label} fontWeight={700}>
        L
      </text>
      <text x={1.28} y={-1.3} fontSize={0.13} fill={theme.label} fontWeight={700}>
        R
      </text>

      {placed.map(({ e, p }) => {
        const v = values?.[e] ?? 0;
        // Square-root scaling keeps moderate potentials visible next to the maximum.
        const shown = Math.sign(v) * Math.sqrt(Math.min(1, Math.abs(v) / scale)) * scale;
        const fill = divergingColor(shown, scale, { negative: theme.negative, neutral, positive: theme.positive });
        const ring = bad.has(e) ? theme.miss : ok.has(e) ? theme.hit : e === selected ? theme.accent : emph.has(e) ? theme.text : theme.gridStrong;
        const thick = bad.has(e) || ok.has(e) || e === selected || emph.has(e);
        return (
          <g
            key={e}
            data-electrode={e}
            role={onElectrodeClick ? 'button' : undefined}
            tabIndex={onElectrodeClick ? 0 : undefined}
            aria-label={`${e}${values ? `: ${Math.round(v)} µV` : ''}`}
            onFocus={(ev) => setFocused(isFocusVisible(ev.currentTarget) ? e : null)}
            onBlur={() => setFocused((f) => (f === e ? null : f))}
            onKeyDown={(ev) => {
              if (onElectrodeClick && (ev.key === 'Enter' || ev.key === ' ')) {
                ev.preventDefault();
                ev.stopPropagation();
                onElectrodeClick(e);
              }
            }}
            style={{ cursor: onElectrodeClick ? 'pointer' : undefined, outline: 'none' }}
          >
            {focused === e ? <circle cx={p.x} cy={p.y} r={R_ELECTRODE + 0.045} fill="none" stroke={theme.accent} strokeWidth={0.02} /> : null}
            <circle cx={p.x} cy={p.y} r={R_ELECTRODE} fill={fill} stroke={ring} strokeWidth={thick ? 0.03 : 0.012} />
            <text
              x={p.x}
              y={p.y + 0.026}
              textAnchor="middle"
              fontSize={0.075}
              fontWeight={600}
              fill={theme.text}
              stroke={theme.bg}
              strokeWidth={0.018}
              paintOrder="stroke"
              style={{ pointerEvents: 'none' }}
            >
              {e}
            </text>
          </g>
        );
      })}

      {src ? (
        <g style={{ pointerEvents: 'none' }} aria-hidden>
          <circle cx={src.x} cy={src.y} r={0.07} fill="none" stroke={theme.accent} strokeWidth={0.025} />
          <line x1={src.x - 0.13} y1={src.y} x2={src.x + 0.13} y2={src.y} stroke={theme.accent} strokeWidth={0.018} />
          <line x1={src.x} y1={src.y - 0.13} x2={src.x} y2={src.y + 0.13} stroke={theme.accent} strokeWidth={0.018} />
        </g>
      ) : null}
    </svg>
  );
}

/** Colour legend for the head map (negative ↔ positive). */
export function FieldLegend({ maxAbs }: { maxAbs: number }) {
  const theme = useEegTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>
      <span>−{Math.round(maxAbs)} µV</span>
      <span
        aria-hidden
        style={{
          width: 90,
          height: 8,
          borderRadius: 4,
          background: `linear-gradient(90deg, ${theme.negative}, ${theme.bgSubtle}, ${theme.positive})`,
          border: '1px solid var(--border)',
        }}
      />
      <span>+{Math.round(maxAbs)} µV</span>
    </div>
  );
}

export default HeadMap;
