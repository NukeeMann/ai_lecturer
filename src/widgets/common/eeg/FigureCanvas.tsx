'use client';

// Zoom/pan viewer for EEG figures with an overlay in normalised image
// coordinates (marks, boxes, expert key, distractors, caliper).
//
// • Fit-width by default (scale 1). Zoom: buttons, keyboard + / − / 0,
//   Ctrl/⌘ + wheel (trackpad pinch) and two-finger pinch. Plain wheel keeps
//   scrolling the page.
// • Pan: drag in 'pan' mode; in marking modes use two fingers, the middle
//   mouse button, Shift + drag, the hand toggle or arrow keys. In 'point'
//   mode a drag on a zoomed image also pans (a tap marks).
// • Marking: 'point' → onPoint(p); 'box' → onBox(rect) (a tap → onPoint);
//   'caliper' → onCaliperChange({from, to}) live (a tap clears).
// • The overlay is SVG in viewport pixels, so strokes and labels stay crisp
//   at any zoom; every tone also has a glyph (colour is never the only cue).
// • `src` is used verbatim (the static exporter rewrites asset paths in the
//   lesson payload) — never build /api/... URLs here.

import {
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type KeyboardEventHandler,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Hand, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

import { clamp01, rectFromPoints, type NormPoint, type NormRect } from '@/lib/eeg/scoring';

import {
  clampView,
  normToScreen,
  panBy,
  screenToNorm,
  TONE_GLYPH,
  viewRect,
  zoomAt,
  type FigureOverlayItem,
  type FigureOverlayTone,
  type ViewTransform,
} from './figureMath';

export type { FigureOverlayItem, FigureOverlayTone } from './figureMath';

export type FigureInteraction = 'pan' | 'point' | 'box' | 'caliper';

export interface FigureCaliper {
  from: NormPoint;
  to: NormPoint;
}

export interface FigureOverlayApi {
  /** Normalised → viewport px. */
  toScreen(p: NormPoint): { x: number; y: number };
  scale: number;
  width: number;
  height: number;
}

export interface FigureCanvasHandle {
  /** Client (page) coordinates → normalised image point (null outside the image). */
  toNormalized(clientX: number, clientY: number): NormPoint | null;
  /** Normalised rectangle currently visible. */
  getViewRect(): NormRect;
  /** PNG of the visible crop at natural resolution (≤ 2048 px), e.g. for "Ask tutor". */
  captureView(type?: string): Promise<Blob | null>;
  resetView(): void;
  zoomBy(factor: number): void;
  getImage(): HTMLImageElement | null;
}

export interface FigureCanvasProps {
  src: string;
  /** Plain text. */
  alt: string;
  /** Natural size (FigureRef width/height) — reserves the space before load. */
  naturalWidth?: number;
  naturalHeight?: number;
  interaction?: FigureInteraction;
  overlay?: readonly FigureOverlayItem[];
  /** Extra overlay content in viewport px (rendered inside the SVG). */
  renderOverlay?: (api: FigureOverlayApi) => ReactNode;
  onPoint?: (p: NormPoint) => void;
  onBox?: (rect: NormRect) => void;
  onCaliperChange?: (caliper: FigureCaliper | null) => void;
  /** Mouse hover position (normalised), null on leave. */
  onHover?: (p: NormPoint | null) => void;
  /** Called with the natural size once the image has loaded. */
  onLoad?: (natural: { width: number; height: number }) => void;
  maxZoom?: number;
  showControls?: boolean;
  /** Accessible name (default: alt). */
  ariaLabel?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  touchAction?: CSSProperties['touchAction'];
  /** Positioned over the viewport (pointer-events: none wrapper). */
  children?: ReactNode;
  style?: CSSProperties;
  ref?: Ref<FigureCanvasHandle>;
}

const TONE_COLOR: Readonly<Record<FigureOverlayTone, string>> = {
  mark: 'var(--accent)',
  hit: 'var(--success)',
  miss: 'var(--danger)',
  false: 'var(--warning)',
  key: 'var(--insight)',
  distractor: 'var(--warning)',
  draft: 'var(--accent)',
  caliper: 'var(--accent)',
};
const DASHED: ReadonlySet<FigureOverlayTone> = new Set(['key', 'miss', 'distractor', 'draft']);

const TAP_SLOP_PX = 6;
const BUTTON_ZOOM = 1.5;

/** Strip light markdown so overlay labels can be drawn as SVG text. */
export function plainLabel(md: string): string {
  return md.replace(/[*_`$]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').trim();
}

interface StoredView {
  scale: number;
  /** Normalised image coordinate at the viewport's top-left. */
  ox: number;
  oy: number;
}

interface Gesture {
  pointerId: number;
  x0: number;
  y0: number;
  lastX: number;
  lastY: number;
  start: NormPoint;
  mode: FigureInteraction;
  moved: boolean;
}

interface Pinch {
  dist: number;
  midX: number;
  midY: number;
}

const controlButton: CSSProperties = {
  width: 30,
  height: 30,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: 0,
  boxShadow: 'var(--shadow-xs)',
};

function toPx(v: StoredView, W: number, H: number): ViewTransform {
  return { scale: v.scale, tx: -v.ox * W * v.scale, ty: -v.oy * H * v.scale };
}

function fromPx(v: ViewTransform, W: number, H: number): StoredView {
  return { scale: v.scale, ox: W > 0 ? -v.tx / (W * v.scale) : 0, oy: H > 0 ? -v.ty / (H * v.scale) : 0 };
}

export function FigureCanvas(props: FigureCanvasProps) {
  const {
    src,
    alt,
    interaction = 'pan',
    overlay,
    renderOverlay,
    maxZoom = 8,
    showControls = true,
    onKeyDown,
    children,
    style,
    ref,
  } = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<Gesture | null>(null);
  const pinchRef = useRef<Pinch | null>(null);
  const labelId = useId();

  const [W, setW] = useState(0);
  const [loadedNatural, setLoadedNatural] = useState<{ width: number; height: number } | null>(null);
  const [stored, setStored] = useState<StoredView>({ scale: 1, ox: 0, oy: 0 });
  const [draftBox, setDraftBox] = useState<NormRect | null>(null);
  const [draftCaliper, setDraftCaliper] = useState<FigureCaliper | null>(null);
  const [panOverride, setPanOverride] = useState(false);
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false);

  const natural = useMemo(() => {
    if (props.naturalWidth && props.naturalHeight) return { width: props.naturalWidth, height: props.naturalHeight };
    return loadedNatural;
  }, [props.naturalWidth, props.naturalHeight, loadedNatural]);
  const aspect = natural ? natural.height / natural.width : 9 / 16;
  const width = W > 0 ? W : 640;
  const H = Math.max(1, width * aspect);
  const view = useMemo(() => clampView(toPx(stored, width, H), width, H, maxZoom), [stored, width, H, maxZoom]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl/⌘ + wheel (incl. trackpad pinch) zooms; needs a non-passive listener.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0025);
      setStored((s) => fromPx(zoomAt(toPx(s, width, H), factor, px, py, width, H, maxZoom), width, H));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [width, H, maxZoom]);

  const update = (fn: (v: ViewTransform) => ViewTransform) =>
    setStored((s) => fromPx(fn(clampView(toPx(s, width, H), width, H, maxZoom)), width, H));
  const zoomCenter = (factor: number) => update((v) => zoomAt(v, factor, width / 2, H / 2, width, H, maxZoom));
  const reset = () => setStored({ scale: 1, ox: 0, oy: 0 });

  useImperativeHandle(
    ref,
    () => ({
      toNormalized: (clientX, clientY) => {
        const el = viewportRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const p = screenToNorm(view, clientX - rect.left, clientY - rect.top, width, H);
        return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? p : null;
      },
      getViewRect: () => viewRect(view, width, H),
      resetView: reset,
      zoomBy: zoomCenter,
      getImage: () => imgRef.current,
      captureView: (type = 'image/png') =>
        new Promise<Blob | null>((resolve) => {
          const img = imgRef.current;
          if (!img || !img.naturalWidth || typeof document === 'undefined') return resolve(null);
          try {
            const r = viewRect(view, width, H);
            const sx = r.x * img.naturalWidth;
            const sy = r.y * img.naturalHeight;
            const sw = r.w * img.naturalWidth;
            const sh = r.h * img.naturalHeight;
            const k = Math.min(1, 2048 / Math.max(sw, sh));
            const out = document.createElement('canvas');
            out.width = Math.max(1, Math.round(sw * k));
            out.height = Math.max(1, Math.round(sh * k));
            const ctx = out.getContext('2d');
            if (!ctx) return resolve(null);
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
            out.toBlob((b) => resolve(b), type); // throws on tainted canvases
          } catch {
            resolve(null);
          }
        }),
    }),
  );

  // ── Pointer gestures ────────────────────────────────────────────────────
  const local = (e: ReactPointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const norm = (x: number, y: number): NormPoint => {
    const p = screenToNorm(view, x, y, width, H);
    return { x: clamp01(p.x), y: clamp01(p.y) };
  };
  const marking = interaction !== 'pan' && !panOverride;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const p = local(e);
    pointersRef.current.set(e.pointerId, p);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // unsupported (jsdom)
    }
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
      gestureRef.current = null;
      setDraftBox(null);
      setDraftCaliper(null);
      return;
    }
    const forcePan = !marking || e.button === 1 || e.shiftKey;
    gestureRef.current = {
      pointerId: e.pointerId,
      x0: p.x,
      y0: p.y,
      lastX: p.x,
      lastY: p.y,
      start: norm(p.x, p.y),
      mode: forcePan ? 'pan' : interaction,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = local(e);
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, p);
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const factor = pinch.dist > 0 ? dist / pinch.dist : 1;
      update((v) => panBy(zoomAt(v, factor, midX, midY, width, H, maxZoom), midX - pinch.midX, midY - pinch.midY, width, H, maxZoom));
      pinchRef.current = { dist, midX, midY };
      return;
    }
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) {
      if (e.pointerType === 'mouse') props.onHover?.(norm(p.x, p.y));
      return;
    }
    if (!g.moved && Math.hypot(p.x - g.x0, p.y - g.y0) > TAP_SLOP_PX) {
      g.moved = true;
      // In point mode a drag on a zoomed image pans instead of marking.
      if (g.mode === 'point') g.mode = 'pan';
    }
    const dx = p.x - g.lastX;
    const dy = p.y - g.lastY;
    g.lastX = p.x;
    g.lastY = p.y;
    if (!g.moved) return;
    if (g.mode === 'pan') {
      if (view.scale > 1) update((v) => panBy(v, dx, dy, width, H, maxZoom));
    } else if (g.mode === 'box') {
      setDraftBox(rectFromPoints(g.start, norm(p.x, p.y)));
    } else if (g.mode === 'caliper') {
      const c = { from: g.start, to: norm(p.x, p.y) };
      setDraftCaliper(c);
      props.onCaliperChange?.(c);
    }
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    setDraftBox(null);
    setDraftCaliper(null);
    if (cancelled) return;
    const p = local(e);
    const end = norm(p.x, p.y);
    if (!g.moved) {
      if (g.mode === 'point' || g.mode === 'box') props.onPoint?.(g.start);
      else if (g.mode === 'caliper') props.onCaliperChange?.(null);
      return;
    }
    if (g.mode === 'box') {
      const r = rectFromPoints(g.start, end);
      if (r.w > 0 && r.h > 0) props.onBox?.(r);
      else props.onPoint?.(g.start);
    } else if (g.mode === 'caliper') {
      props.onCaliperChange?.({ from: g.start, to: end });
    }
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    let handled = true;
    const step = 40;
    switch (e.key) {
      case '+':
      case '=':
        zoomCenter(BUTTON_ZOOM);
        break;
      case '-':
      case '_':
        zoomCenter(1 / BUTTON_ZOOM);
        break;
      case '0':
        reset();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        if (view.scale <= 1) {
          handled = false;
          break;
        }
        update((v) =>
          panBy(
            v,
            e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0,
            e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0,
            width,
            H,
            maxZoom,
          ),
        );
        break;
      default:
        handled = false;
    }
    if (handled && e.target === e.currentTarget) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onKeyDown?.(e);
  };

  const touchAction =
    props.touchAction ?? (view.scale > 1 ? 'none' : marking && interaction !== 'point' ? 'none' : 'pan-y');
  const cursor = marking ? (interaction === 'point' ? 'copy' : 'crosshair') : view.scale > 1 ? 'grab' : 'default';

  const api: FigureOverlayApi = { toScreen: (p) => normToScreen(view, p, width, H), scale: view.scale, width, height: H };
  const items: FigureOverlayItem[] = [...(overlay ?? [])];
  if (draftBox) items.push({ kind: 'rect', rect: draftBox, tone: 'draft' });
  if (draftCaliper) items.push({ kind: 'caliper', ...draftCaliper });

  return (
    <div
      data-eeg-figure-canvas=""
      style={{ position: 'relative', width: '100%', maxWidth: '100%', minWidth: 0, ...style }}
    >
      <div
        ref={viewportRef}
        role="group"
        aria-label={props.ariaLabel ?? alt}
        aria-describedby={labelId}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onFocus={(e) => setFocused(e.target === e.currentTarget)}
        onBlur={() => setFocused(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') props.onHover?.(null);
        }}
        style={{
          position: 'relative',
          width: '100%',
          height: H,
          overflow: 'hidden',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          touchAction,
          cursor,
          outline: 'none',
          boxShadow: focused ? 'var(--shadow-focus)' : undefined,
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>: works in the static export */}
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              const n = { width: img.naturalWidth, height: img.naturalHeight };
              setLoadedNatural(n);
              props.onLoad?.(n);
            }
            setFailed(false);
          }}
          onError={() => setFailed(true)}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: width * view.scale,
            height: H * view.scale,
            maxWidth: 'none',
            maxHeight: 'none',
            margin: 0,
            display: 'block',
            objectFit: 'contain',
            transform: `translate(${view.tx}px, ${view.ty}px)`,
            transformOrigin: '0 0',
            pointerEvents: 'none',
          }}
        />
        <svg
          width={width}
          height={H}
          aria-hidden="true"
          style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}
        >
          {items.map((it, i) => (
            <OverlayShape key={it.id ?? `i${i}`} item={it} api={api} />
          ))}
          {renderOverlay?.(api)}
        </svg>
        {failed ? (
          <div
            role="alert"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--space-4)',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-sm)',
              background: 'var(--bg-subtle)',
            }}
          >
            Image could not be loaded: {alt}
          </div>
        ) : null}
        {children ? <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{children}</div> : null}
        {showControls ? (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{ position: 'absolute', right: 6, bottom: 6, display: 'flex', gap: 4, zIndex: 3 }}
          >
            {interaction !== 'pan' ? (
              <button
                type="button"
                aria-label={panOverride ? 'Back to marking' : 'Pan the image'}
                aria-pressed={panOverride}
                title={panOverride ? 'Back to marking' : 'Pan the image'}
                onClick={() => setPanOverride((v) => !v)}
                style={{ ...controlButton, ...(panOverride ? { background: 'var(--accent-subtle)', color: 'var(--accent-text)', borderColor: 'var(--accent-border)' } : null) }}
              >
                <Hand size={15} aria-hidden />
              </button>
            ) : null}
            <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={view.scale <= 1} onClick={() => zoomCenter(1 / BUTTON_ZOOM)} style={{ ...controlButton, opacity: view.scale <= 1 ? 0.5 : 1 }}>
              <ZoomOut size={15} aria-hidden />
            </button>
            <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={view.scale >= maxZoom} onClick={() => zoomCenter(BUTTON_ZOOM)} style={{ ...controlButton, opacity: view.scale >= maxZoom ? 0.5 : 1 }}>
              <ZoomIn size={15} aria-hidden />
            </button>
            <button type="button" aria-label="Fit to width" title="Fit to width (0)" disabled={view.scale === 1} onClick={reset} style={{ ...controlButton, opacity: view.scale === 1 ? 0.5 : 1 }}>
              <Maximize2 size={15} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
      <span
        id={labelId}
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        {`Zoom ${Math.round(view.scale * 100)}%. Keys: plus and minus zoom, 0 fits to width, arrows pan when zoomed.`}
      </span>
    </div>
  );
}

function OverlayShape({ item, api }: { item: FigureOverlayItem; api: FigureOverlayApi }) {
  const halo: CSSProperties = { paintOrder: 'stroke', stroke: 'var(--bg-elevated)', strokeWidth: 3, strokeLinejoin: 'round' };
  if (item.kind === 'caliper') {
    const a = api.toScreen(item.from);
    const b = api.toScreen(item.to);
    const color = TONE_COLOR.caliper;
    return (
      <g>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={1.5} />
        {[a, b].map((p, i) => (
          <line key={i} x1={p.x} y1={p.y - 8} x2={p.x} y2={p.y + 8} stroke={color} strokeWidth={1.5} />
        ))}
        {item.label ? (
          <text x={(a.x + b.x) / 2} y={Math.min(a.y, b.y) - 10} textAnchor="middle" fontSize={11} fontWeight={600} fill={color} style={halo}>
            {plainLabel(item.label)}
          </text>
        ) : null}
      </g>
    );
  }
  const color = TONE_COLOR[item.tone];
  const glyph = TONE_GLYPH[item.tone];
  const dash = DASHED.has(item.tone) ? '5 3' : undefined;
  if (item.kind === 'point') {
    const p = api.toScreen(item);
    const text = [glyph, item.label ? plainLabel(item.label) : ''].filter(Boolean).join(' ');
    return (
      <g>
        <circle cx={p.x} cy={p.y} r={8} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={2} strokeDasharray={dash} />
        <circle cx={p.x} cy={p.y} r={2} fill={color} />
        {text ? (
          <text x={p.x + 11} y={p.y - 9} fontSize={11} fontWeight={700} fill={color} style={halo}>
            {text}
          </text>
        ) : null}
      </g>
    );
  }
  const a = api.toScreen({ x: item.rect.x, y: item.rect.y });
  const b = api.toScreen({ x: item.rect.x + item.rect.w, y: item.rect.y + item.rect.h });
  const text = [glyph, item.label ? plainLabel(item.label) : ''].filter(Boolean).join(' ');
  return (
    <g>
      <rect
        x={a.x}
        y={a.y}
        width={Math.max(1, b.x - a.x)}
        height={Math.max(1, b.y - a.y)}
        fill={color}
        fillOpacity={item.tone === 'draft' ? 0.1 : 0.12}
        stroke={color}
        strokeWidth={2}
        strokeDasharray={dash}
        rx={2}
      />
      {text ? (
        <text x={a.x + 2} y={a.y - 5} fontSize={11} fontWeight={700} fill={color} style={halo}>
          {text}
        </text>
      ) : null}
    </g>
  );
}

export default FigureCanvas;
