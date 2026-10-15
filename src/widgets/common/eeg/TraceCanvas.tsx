'use client';

// HiDPI, theme-aware canvas renderer for derived EEG channels.
//
// Two stacked canvases: the BASE layer (grid, shading, labels, traces, marks,
// calibration bar) redraws only when data/view/theme change; the OVERLAY
// layer (hover line, drag draft, caliper + readout) redraws on pointer moves.
// Size follows the container (ResizeObserver) and devicePixelRatio.
//
// Interaction (pointer events: mouse, touch, pen). The canvas uses
// `touch-action: pan-y`, so vertical swipes still scroll the page while
// horizontal drags reach the widget:
//   • 'caliper'   drag along a channel → onCaliperChange({t0, t1, channelIndex}); tap clears;
//   • 'markPoint' tap → onMarkAdd({t, channel});
//   • 'markRange' drag → onMarkAdd({t0, t1, channel});
//   • 'none'      tap → onChannelClick; horizontal swipe → onSwipe('prev'|'next').
// Keyboard handling belongs to the widget (pass `onKeyDown`; stop propagation
// for handled keys — the lesson page has global shortcuts).

import {
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEventHandler,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react';

import type { MinMaxColumns } from '@/lib/eeg/dsp';

import {
  computeTraceLayout,
  defaultTraceHeight,
  estimateLabelWidth,
  xToTime,
  yToChannel,
  type TraceLayout,
} from './traceLayout';
import {
  drawTraceBase,
  drawTraceOverlay,
  type TraceCaliper,
  type TraceChannel,
  type TraceMark,
  type TraceShading,
} from './traceRender';
import { useEegTheme } from './useEegTheme';

export type { TraceCaliper, TraceChannel, TraceMark, TraceShading } from './traceRender';
export type { TraceMarkTone, TraceShadingTone } from './traceRender';

export type TraceInteraction = 'none' | 'caliper' | 'markPoint' | 'markRange';

export type TraceMarkInput =
  | { t: number; channel: string | null }
  | { t0: number; t1: number; channel: string | null };

export interface TracePointerInfo {
  /** Time (s) under the pointer, clamped to the page. */
  t: number;
  channelIndex: number | null;
  channelLabel: string | null;
  /** CSS px within the canvas. */
  x: number;
  y: number;
}

export interface TraceCanvasHandle {
  getCanvas(): HTMLCanvasElement | null;
  /** PNG (or `type`) of the current view incl. overlay — e.g. for "Ask tutor". */
  toBlob(type?: string): Promise<Blob | null>;
  focus(): void;
}

export interface TraceCanvasProps {
  channels: readonly TraceChannel[];
  sampleRate: number;
  /** Left edge of the page (s). */
  startSec: number;
  secondsPerPage: number;
  /** µV per nominal mm (larger = smaller traces). */
  sensitivityUvPerMm: number;
  /** Time of data[0] (s), default 0. */
  dataStartSec?: number;
  /** Extra vertical gain on top of the physical scale (default 1). */
  zoom?: number;
  /** CSS px; default ≈ 18 px per channel, min 320. */
  height?: number;
  /** Label column width; default from the longest label. */
  labelWidth?: number;
  /** Used when channels carry no `group`: indices after which a gap is drawn. */
  groupBreaks?: readonly number[];
  shadings?: readonly TraceShading[];
  marks?: readonly TraceMark[];
  /** Controlled caliper (shown on the overlay). */
  caliper?: TraceCaliper | null;
  highlightChannels?: readonly number[];
  dimChannels?: readonly number[];
  interaction?: TraceInteraction;
  onCaliperChange?: (caliper: TraceCaliper | null) => void;
  onMarkAdd?: (mark: TraceMarkInput) => void;
  onChannelClick?: (index: number, label: string) => void;
  onSwipe?: (direction: 'prev' | 'next') => void;
  /** Hover / pointer position (null when the pointer leaves). */
  onPointerInfo?: (info: TracePointerInfo | null) => void;
  showTimeAxis?: boolean;
  showScaleBar?: boolean;
  /** Accessible name of the viewer, e.g. "EEG, longitudinal bipolar, 00:10–00:20". */
  ariaLabel: string;
  /** Longer plain-text description for screen readers. */
  ariaDescription?: string;
  tabIndex?: number;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  /** Overrides the default `pan-y` (e.g. 'none' while a mark mode needs vertical drags). */
  touchAction?: CSSProperties['touchAction'];
  /** Rendered above the canvas (e.g. `<SimulationBadge variant="overlay" />`). */
  children?: ReactNode;
  style?: CSSProperties;
  ref?: Ref<TraceCanvasHandle>;
}

const TIME_AXIS_H = 18;
const BOTTOM_PAD = 6;
const TAP_SLOP_PX = 5;
const SWIPE_MIN_PX = 60;
const FALLBACK_WIDTH = 640;

const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

interface Gesture {
  pointerId: number;
  x0: number;
  y0: number;
  t0: number;
  channelIndex: number | null;
  moved: boolean;
}

function devicePixelRatioSafe(): number {
  return typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
}

function sizeCanvas(canvas: HTMLCanvasElement, w: number, h: number, dpr: number): CanvasRenderingContext2D | null {
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function TraceCanvas(props: TraceCanvasProps) {
  const {
    channels,
    sampleRate,
    startSec,
    secondsPerPage,
    sensitivityUvPerMm,
    dataStartSec = 0,
    zoom = 1,
    groupBreaks,
    shadings,
    marks,
    caliper = null,
    highlightChannels,
    dimChannels,
    interaction = 'none',
    showTimeAxis = true,
    showScaleBar = true,
    ariaLabel,
    ariaDescription,
    tabIndex = 0,
    onKeyDown,
    touchAction = 'pan-y',
    children,
    style,
    ref,
  } = props;
  const theme = useEegTheme();
  const descId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const buffersRef = useRef(new Map<number, MinMaxColumns>());
  const gestureRef = useRef<Gesture | null>(null);

  const [width, setWidth] = useState(0);
  const [dprVersion, setDprVersion] = useState(0);
  const [draft, setDraft] = useState<{ t0: number; t1: number; channelIndex: number | null } | null>(null);
  const [dragCaliper, setDragCaliper] = useState<TraceCaliper | null>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);

  // ── Size ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-render when the window moves to a screen with another pixel ratio.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(resolution: ${devicePixelRatioSafe()}dppx)`);
    const onChange = () => setDprVersion((v) => v + 1);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [dprVersion]);

  const groups = useMemo(() => {
    const breaks = new Set(groupBreaks ?? []);
    let g = 0;
    return channels.map((ch, i) => {
      if (ch.group !== undefined) return ch.group;
      const out = g;
      if (breaks.has(i)) g++;
      return out;
    });
  }, [channels, groupBreaks]);

  const nBreaks = useMemo(() => groups.reduce((n, g, i) => (i > 0 && g !== groups[i - 1] ? n + 1 : n), 0), [groups]);
  const height = props.height ?? defaultTraceHeight(channels.length, nBreaks, showTimeAxis ? TIME_AXIS_H : 0);
  const labelWidth = useMemo(
    () => props.labelWidth ?? estimateLabelWidth(channels.map((c) => c.label)),
    [props.labelWidth, channels],
  );
  const cssWidth = width > 0 ? width : FALLBACK_WIDTH;

  const layout: TraceLayout = useMemo(
    () =>
      computeTraceLayout({
        width: cssWidth,
        height,
        groups,
        labelWidth,
        timeAxisHeight: showTimeAxis ? TIME_AXIS_H : 4,
        bottomPad: BOTTOM_PAD,
        startSec,
        secondsPerPage,
      }),
    [cssWidth, height, groups, labelWidth, showTimeAxis, startSec, secondsPerPage],
  );

  const highlight = useMemo(() => new Set(highlightChannels ?? []), [highlightChannels]);
  const dim = useMemo(() => new Set(dimChannels ?? []), [dimChannels]);

  // ── Base layer ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || width <= 0) return;
    const raf = requestAnimationFrame(() => {
      const dpr = devicePixelRatioSafe();
      const ctx = sizeCanvas(canvas, layout.width, layout.height, dpr);
      if (!ctx) return;
      drawTraceBase(
        ctx,
        layout,
        {
          channels,
          sampleRate,
          dataStartSec,
          sensitivityUvPerMm,
          zoom,
          shadings: shadings ?? [],
          marks: marks ?? [],
          highlight,
          dim,
          showTimeAxis,
          showScaleBar,
          buffers: buffersRef.current,
        },
        theme,
        dpr,
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [layout, width, channels, sampleRate, dataStartSec, sensitivityUvPerMm, zoom, shadings, marks, highlight, dim, showTimeAxis, showScaleBar, theme, dprVersion]);

  const shownCaliper = dragCaliper ?? caliper;

  // ── Overlay layer ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || width <= 0) return;
    const raf = requestAnimationFrame(() => {
      const dpr = devicePixelRatioSafe();
      const ctx = sizeCanvas(canvas, layout.width, layout.height, dpr);
      if (!ctx) return;
      drawTraceOverlay(ctx, layout, { channels, sampleRate, dataStartSec }, { caliper: shownCaliper, draft, hoverT }, theme);
    });
    return () => cancelAnimationFrame(raf);
  }, [layout, width, channels, sampleRate, dataStartSec, shownCaliper, draft, hoverT, theme, dprVersion]);

  useImperativeHandle(
    ref,
    () => ({
      getCanvas: () => baseRef.current,
      focus: () => containerRef.current?.focus(),
      toBlob: (type = 'image/png') =>
        new Promise<Blob | null>((resolve) => {
          const base = baseRef.current;
          const over = overlayRef.current;
          if (!base || typeof document === 'undefined') return resolve(null);
          try {
            const out = document.createElement('canvas');
            out.width = base.width;
            out.height = base.height;
            const ctx = out.getContext('2d');
            if (!ctx) return resolve(null);
            ctx.drawImage(base, 0, 0);
            if (over) ctx.drawImage(over, 0, 0);
            out.toBlob((b) => resolve(b), type);
          } catch {
            resolve(null);
          }
        }),
    }),
    [],
  );

  // ── Pointer handling ────────────────────────────────────────────────────
  const pageEnd = startSec + secondsPerPage;
  const locate = (e: ReactPointerEvent<HTMLElement>): TracePointerInfo => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = rect.width > 0 ? layout.width / rect.width : 1;
    const sy = rect.height > 0 ? layout.height / rect.height : 1;
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sy;
    const t = Math.min(pageEnd, Math.max(startSec, xToTime(layout, x)));
    const channelIndex = yToChannel(layout, y);
    return { t, channelIndex, channelLabel: channelIndex !== null ? channels[channelIndex]?.label ?? null : null, x, y };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = locate(e);
    gestureRef.current = { pointerId: e.pointerId, x0: p.x, y0: p.y, t0: p.t, channelIndex: p.channelIndex, moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom / unsupported — gestures still work without capture
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = locate(e);
    props.onPointerInfo?.(p);
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) {
      if (e.pointerType === 'mouse' && interaction !== 'none') setHoverT(p.t);
      return;
    }
    if (!g.moved && Math.hypot(p.x - g.x0, p.y - g.y0) > TAP_SLOP_PX) g.moved = true;
    if (!g.moved) return;
    if (interaction === 'caliper' && g.channelIndex !== null) {
      const c = { t0: g.t0, t1: p.t, channelIndex: g.channelIndex };
      setDragCaliper(c);
      props.onCaliperChange?.(c);
    } else if (interaction === 'markRange') {
      setDraft({ t0: g.t0, t1: p.t, channelIndex: g.channelIndex });
    }
  };

  const endGesture = (e: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    const p = locate(e);
    setDraft(null);
    setDragCaliper(null);
    if (cancelled) return;
    const label = g.channelIndex !== null ? channels[g.channelIndex]?.label ?? null : null;
    if (!g.moved) {
      if (interaction === 'markPoint') props.onMarkAdd?.({ t: g.t0, channel: label });
      else if (interaction === 'caliper') props.onCaliperChange?.(null);
      if (g.channelIndex !== null && label) props.onChannelClick?.(g.channelIndex, label);
      return;
    }
    if (interaction === 'caliper' && g.channelIndex !== null) {
      props.onCaliperChange?.({ t0: g.t0, t1: p.t, channelIndex: g.channelIndex });
    } else if (interaction === 'markRange') {
      if (Math.abs(p.t - g.t0) > 1e-3) {
        props.onMarkAdd?.({ t0: Math.min(g.t0, p.t), t1: Math.max(g.t0, p.t), channel: label });
      }
    } else if (interaction === 'none') {
      const dx = p.x - g.x0;
      const dy = p.y - g.y0;
      if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > 2 * Math.abs(dy)) props.onSwipe?.(dx < 0 ? 'next' : 'prev');
    }
  };

  const onPointerLeave = () => {
    setHoverT(null);
    props.onPointerInfo?.(null);
  };

  const cursor =
    interaction === 'caliper' || interaction === 'markRange'
      ? 'crosshair'
      : interaction === 'markPoint'
        ? 'copy'
        : props.onChannelClick
          ? 'pointer'
          : 'default';

  const canvasStyle: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' };

  return (
    <div
      ref={containerRef}
      role="group"
      aria-roledescription="EEG traces"
      aria-label={ariaLabel}
      aria-describedby={ariaDescription ? descId : undefined}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onFocus={(e) => setFocused(e.target === e.currentTarget)}
      onBlur={() => setFocused(false)}
      data-eeg-trace-canvas=""
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        height,
        outline: 'none',
        boxShadow: focused ? 'var(--shadow-focus)' : undefined,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        background: 'var(--bg-elevated)',
        ...style,
      }}
    >
      <canvas ref={baseRef} aria-hidden="true" style={canvasStyle} />
      <canvas
        ref={overlayRef}
        aria-hidden="true"
        style={{ ...canvasStyle, touchAction, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endGesture(e, false)}
        onPointerCancel={(e) => endGesture(e, true)}
        onPointerLeave={onPointerLeave}
      />
      {ariaDescription ? (
        <span id={descId} style={srOnly}>
          {ariaDescription}
        </span>
      ) : null}
      {children ? (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{children}</div>
      ) : null}
    </div>
  );
}

export default TraceCanvas;
