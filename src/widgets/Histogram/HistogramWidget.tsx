'use client';

import {
  useCallback,
  useId,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';

import type { HistogramData } from './schema';

export interface HistogramWidgetProps {
  data: HistogramData;
}

const SVG_HEIGHT = 200;
const SVG_PADDING_TOP = 12;
const SVG_PADDING_BOTTOM = 18;
const BAR_GAP = 2;

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const chartAreaStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  background: 'var(--bg-subtle)',
  padding: 'var(--space-4) var(--space-5)',
};

const calloutStyle: CSSProperties = {
  marginTop: 'var(--space-3)',
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 'var(--space-3)',
  padding: '6px 10px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  lineHeight: 1.2,
};

const calloutLabelStyle: CSSProperties = {
  color: 'var(--text-tertiary)',
  fontSize: 'var(--fs-xs)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
};

const controlsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  padding: 'var(--space-4) var(--space-5)',
  background: 'var(--bg-elevated)',
  borderTop: '1px solid var(--border)',
};

const sliderRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
};

const sliderLabelStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  minWidth: 28,
};

const sliderValueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  minWidth: 44,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const SLIDER_CSS = `
.histwidget-slider {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 14px;
  background: transparent;
  outline: none;
  cursor: pointer;
}
.histwidget-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(
    to right,
    var(--widget-histogram) 0%,
    var(--widget-histogram) var(--hist-fill, 0%),
    var(--bg-subtle) var(--hist-fill, 0%),
    var(--bg-subtle) 100%
  );
  border: 1px solid var(--border);
}
.histwidget-slider::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
}
.histwidget-slider::-moz-range-progress {
  height: 4px;
  border-radius: 2px;
  background: var(--widget-histogram);
}
.histwidget-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--widget-histogram);
  border: none;
  box-shadow: var(--shadow-sm);
  margin-top: -6px;
  cursor: grab;
  transition: transform 120ms;
}
.histwidget-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.08); }
.histwidget-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--widget-histogram);
  border: none;
  box-shadow: var(--shadow-sm);
  cursor: grab;
}
`;

function formatEdge(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(2).replace(/\.?0+$/, '');
}

export function HistogramWidget({ data }: HistogramWidgetProps) {
  const { binEdges, counts } = data;
  const reactId = useId();
  const sliderId = `histwidget-slider-${reactId}`;
  const numBins = counts.length;

  const [selectedBin, setSelectedBin] = useState<number>(0);
  const safeIndex = Math.min(Math.max(selectedBin, 0), Math.max(numBins - 1, 0));

  const maxCount = useMemo(() => {
    let m = 0;
    for (const c of counts) if (c > m) m = c;
    return m === 0 ? 1 : m;
  }, [counts]);

  const fillPct = useMemo(() => {
    if (numBins <= 1) return '0%';
    const t = safeIndex / (numBins - 1);
    return `${Math.max(0, Math.min(1, t)) * 100}%`;
  }, [safeIndex, numBins]);

  const handleSliderInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSelectedBin(Number(event.target.value));
    },
    [],
  );

  // SVG layout: each bar takes equal horizontal share. The viewBox uses
  // the number of bins as its width unit so any wrapper width scales smoothly.
  const viewWidth = Math.max(numBins * 10, 10);
  const innerHeight = SVG_HEIGHT - SVG_PADDING_TOP - SVG_PADDING_BOTTOM;
  const barWidth = 10 - BAR_GAP;

  const selectedRange = useMemo(() => {
    const lo = binEdges[safeIndex];
    const hi = binEdges[safeIndex + 1];
    return { lo, hi };
  }, [binEdges, safeIndex]);

  const selectedCount = counts[safeIndex] ?? 0;

  return (
    <div data-histwidget style={wrapStyle}>
      <style>{SLIDER_CSS}</style>
      <div style={chartAreaStyle}>
        <svg
          data-histwidget-svg
          role="img"
          aria-label={`Histogram with ${numBins} bins`}
          viewBox={`0 0 ${viewWidth} ${SVG_HEIGHT}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: SVG_HEIGHT, display: 'block' }}
        >
          <line
            x1={0}
            x2={viewWidth}
            y1={SVG_HEIGHT - SVG_PADDING_BOTTOM}
            y2={SVG_HEIGHT - SVG_PADDING_BOTTOM}
            stroke="var(--border)"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
          {counts.map((c, i) => {
            const h = (c / maxCount) * innerHeight;
            const x = i * 10 + BAR_GAP / 2;
            const y = SVG_HEIGHT - SVG_PADDING_BOTTOM - h;
            const isSelected = i === safeIndex;
            return (
              <rect
                key={i}
                data-histwidget-bar
                data-bin-index={i}
                data-selected={isSelected ? 'true' : 'false'}
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(h, 0.5)}
                fill={
                  isSelected
                    ? 'var(--widget-histogram)'
                    : 'color-mix(in srgb, var(--widget-histogram) 35%, transparent)'
                }
                stroke={
                  isSelected
                    ? 'var(--widget-histogram)'
                    : 'color-mix(in srgb, var(--widget-histogram) 55%, transparent)'
                }
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
                rx={0.6}
              />
            );
          })}
        </svg>
        <div
          data-histwidget-callout
          role="status"
          aria-live="polite"
          style={calloutStyle}
        >
          <span style={calloutLabelStyle}>Bin {safeIndex + 1}/{numBins}</span>
          <span data-histwidget-range>
            [{formatEdge(selectedRange.lo)}, {formatEdge(selectedRange.hi)})
          </span>
          <span data-histwidget-count style={{ color: 'var(--widget-histogram)' }}>
            count = {selectedCount}
          </span>
        </div>
      </div>
      <div style={controlsStyle}>
        <div style={sliderRowStyle}>
          <label htmlFor={sliderId} style={sliderLabelStyle}>
            Bin
          </label>
          <span style={sliderValueStyle} data-histwidget-value>
            {safeIndex + 1}
          </span>
          <input
            id={sliderId}
            type="range"
            className="histwidget-slider"
            data-histwidget-slider
            min={0}
            max={Math.max(numBins - 1, 0)}
            step={1}
            value={safeIndex}
            onChange={handleSliderInput}
            aria-label="Selected histogram bin"
            style={{ ['--hist-fill' as string]: fillPct } as CSSProperties}
          />
        </div>
      </div>
    </div>
  );
}
