// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { z } from 'zod';

import { AttributionLine } from './AttributionLine';
import { DataErrorCard } from './DataErrorCard';
import { FigureCanvas } from './FigureCanvas';
import { SimulationBadge, SIMULATION_TOOLTIP } from './SimulationBadge';
import { TraceCanvas } from './TraceCanvas';
import { computeTraceLayout, estimateLabelWidth, timeToX } from './traceLayout';
import { useEegTheme } from './useEegTheme';
import { useFigureMarks } from './useFigureMarks';
import { useWidgetProgress } from './useWidgetProgress';

// jsdom has no canvas: make getContext return null quietly (renderers guard it).
const originalGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof originalGetContext;
});
afterEach(() => {
  cleanup();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.removeProperty('--text');
});

/** Fire a pointer event with coordinates (jsdom lacks PointerEvent init support in places). */
function pointer(el: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number, extra: Record<string, unknown> = {}) {
  fireEvent[type](el, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, ...extra });
}

describe('SimulationBadge', () => {
  it('shows SYMULACJA by default and reveals the explanation on tap', () => {
    render(<SimulationBadge />);
    const btn = screen.getByRole('button', { name: /SYMULACJA/ });
    expect(btn.getAttribute('title')).toBe(SIMULATION_TOOLTIP);
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByRole('note').textContent).toBe(SIMULATION_TOOLTIP);
  });

  it('accepts a custom label', () => {
    render(<SimulationBadge label="SIM" variant="overlay" />);
    expect(screen.getByRole('button', { name: /^SIM:/ })).toBeTruthy();
  });
});

describe('AttributionLine', () => {
  it('renders text, licence and link; lock for restricted material', () => {
    render(
      <AttributionLine attribution={{ text: 'AES 2016, *Fig. 84*', license: 'CC BY-NC-SA 4.0', url: 'https://example.org/x', restricted: true }} />,
    );
    expect(screen.getByText('Private use only')).toBeTruthy();
    expect(screen.getByText('CC BY-NC-SA 4.0')).toBeTruthy();
    expect(screen.getByText('Fig. 84').tagName).toBe('EM');
    const link = screen.getByRole('link', { name: /Source/ });
    expect(link.getAttribute('href')).toBe('https://example.org/x');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('has no lock for open material', () => {
    render(<AttributionLine attribution={{ text: 'Open', license: 'CC BY 4.0' }} />);
    expect(screen.queryByText('Private use only')).toBeNull();
  });
});

describe('DataErrorCard', () => {
  it('lists zod issues', () => {
    const r = z.object({ prompt: z.string() }).safeParse({});
    render(<DataErrorCard title="Invalid data" error={r.success ? null : r.error} />);
    expect(screen.getByRole('alert').textContent).toContain('prompt: Required');
  });
});

describe('TraceCanvas', () => {
  const channels = [
    { label: 'Fp1-F7', data: new Float32Array(2560), available: true, group: 0 },
    { label: 'F7-T7', data: new Float32Array(2560), available: true, group: 0 },
  ];
  const common = { channels, sampleRate: 256, startSec: 0, secondsPerPage: 10, sensitivityUvPerMm: 10, ariaLabel: 'EEG' };
  // jsdom: no ResizeObserver callback → the component lays out at its 640 px fallback.
  const layout = computeTraceLayout({
    width: 640,
    height: 320,
    groups: [0, 0],
    labelWidth: estimateLabelWidth(channels.map((c) => c.label)),
    timeAxisHeight: 18,
    bottomPad: 6,
    startSec: 0,
    secondsPerPage: 10,
  });
  const overlayCanvas = (container: HTMLElement) => container.querySelectorAll('canvas')[1];

  it('renders an accessible, focusable group with pan-y touch action', () => {
    const { container } = render(<TraceCanvas {...common} ariaDescription="Two channels" />);
    const group = screen.getByRole('group', { name: 'EEG' });
    expect(group.getAttribute('tabindex')).toBe('0');
    expect(overlayCanvas(container).style.touchAction).toBe('pan-y');
    expect(screen.getByText('Two channels')).toBeTruthy();
  });

  it('caliper mode: a drag on a channel reports t0/t1/channel; a tap clears', () => {
    const onCaliperChange = vi.fn();
    const { container } = render(<TraceCanvas {...common} interaction="caliper" onCaliperChange={onCaliperChange} />);
    const c = overlayCanvas(container);
    const y = layout.rowCenters[1];
    pointer(c, 'pointerDown', timeToX(layout, 2), y);
    pointer(c, 'pointerMove', timeToX(layout, 2.5), y);
    pointer(c, 'pointerUp', timeToX(layout, 2.5), y);
    const last = onCaliperChange.mock.calls.at(-1)![0];
    expect(last.channelIndex).toBe(1);
    expect(last.t0).toBeCloseTo(2, 6);
    expect(last.t1).toBeCloseTo(2.5, 6);
    pointer(c, 'pointerDown', timeToX(layout, 4), y);
    pointer(c, 'pointerUp', timeToX(layout, 4), y);
    expect(onCaliperChange.mock.calls.at(-1)![0]).toBeNull();
  });

  it('markPoint mode: a tap adds a mark with its channel', () => {
    const onMarkAdd = vi.fn();
    const onChannelClick = vi.fn();
    const { container } = render(<TraceCanvas {...common} interaction="markPoint" onMarkAdd={onMarkAdd} onChannelClick={onChannelClick} />);
    const c = overlayCanvas(container);
    pointer(c, 'pointerDown', timeToX(layout, 3), layout.rowCenters[0]);
    pointer(c, 'pointerUp', timeToX(layout, 3), layout.rowCenters[0]);
    expect(onMarkAdd).toHaveBeenCalledWith({ t: expect.closeTo(3, 6), channel: 'Fp1-F7' });
    expect(onChannelClick).toHaveBeenCalledWith(0, 'Fp1-F7');
  });

  it('markRange mode: a drag adds an ordered range', () => {
    const onMarkAdd = vi.fn();
    const { container } = render(<TraceCanvas {...common} interaction="markRange" onMarkAdd={onMarkAdd} />);
    const c = overlayCanvas(container);
    pointer(c, 'pointerDown', timeToX(layout, 6), layout.rowCenters[0]);
    pointer(c, 'pointerMove', timeToX(layout, 5), layout.rowCenters[0]);
    pointer(c, 'pointerUp', timeToX(layout, 5), layout.rowCenters[0]);
    const m = onMarkAdd.mock.calls[0][0];
    expect(m.t0).toBeCloseTo(5, 6);
    expect(m.t1).toBeCloseTo(6, 6);
    expect(m.channel).toBe('Fp1-F7');
  });

  it('none mode: a horizontal swipe pages', () => {
    const onSwipe = vi.fn();
    const { container } = render(<TraceCanvas {...common} onSwipe={onSwipe} />);
    const c = overlayCanvas(container);
    pointer(c, 'pointerDown', 400, 100, { pointerType: 'touch' });
    pointer(c, 'pointerMove', 300, 105, { pointerType: 'touch' });
    pointer(c, 'pointerUp', 300, 105, { pointerType: 'touch' });
    expect(onSwipe).toHaveBeenCalledWith('next');
  });

  it('passes keys to the widget handler', () => {
    const onKeyDown = vi.fn();
    render(<TraceCanvas {...common} onKeyDown={onKeyDown} />);
    fireEvent.keyDown(screen.getByRole('group', { name: 'EEG' }), { key: 'ArrowRight' });
    expect(onKeyDown).toHaveBeenCalled();
  });
});

describe('FigureCanvas', () => {
  // naturalWidth/Height given → viewport 640 × 320 in jsdom.
  const base = { src: '/api/courses/c/assets/figures/f.png', alt: 'EEG figure', naturalWidth: 1000, naturalHeight: 500 };
  const viewport = () => screen.getByRole('group', { name: 'EEG figure' });

  it('uses src verbatim and reserves the aspect ratio', () => {
    render(<FigureCanvas {...base} />);
    const img = screen.getByRole('img', { name: 'EEG figure' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(base.src);
    expect(viewport().style.height).toBe('320px');
  });

  it('point mode: a tap reports normalised coordinates', () => {
    const onPoint = vi.fn();
    render(<FigureCanvas {...base} interaction="point" onPoint={onPoint} />);
    pointer(viewport(), 'pointerDown', 160, 80);
    pointer(viewport(), 'pointerUp', 160, 80);
    expect(onPoint).toHaveBeenCalledWith({ x: 0.25, y: 0.25 });
  });

  it('box mode: a drag reports a normalised rectangle', () => {
    const onBox = vi.fn();
    render(<FigureCanvas {...base} interaction="box" onBox={onBox} />);
    expect(viewport().style.touchAction).toBe('none');
    pointer(viewport(), 'pointerDown', 320, 160);
    pointer(viewport(), 'pointerMove', 64, 32);
    pointer(viewport(), 'pointerUp', 64, 32);
    expect(onBox).toHaveBeenCalledWith({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 });
  });

  it('caliper mode reports from/to', () => {
    const onCaliperChange = vi.fn();
    render(<FigureCanvas {...base} interaction="caliper" onCaliperChange={onCaliperChange} />);
    pointer(viewport(), 'pointerDown', 64, 160);
    pointer(viewport(), 'pointerMove', 128, 160);
    pointer(viewport(), 'pointerUp', 128, 160);
    expect(onCaliperChange.mock.calls.at(-1)![0]).toEqual({ from: { x: 0.1, y: 0.5 }, to: { x: 0.2, y: 0.5 } });
  });

  it('zooms with keys / buttons, stops propagation of handled keys, and maps taps through the zoom', () => {
    const outer = vi.fn();
    const onPoint = vi.fn();
    render(
      <div onKeyDown={outer}>
        <FigureCanvas {...base} interaction="point" onPoint={onPoint} />
      </div>,
    );
    expect(screen.getByText(/Zoom 100%/)).toBeTruthy();
    fireEvent.keyDown(viewport(), { key: '+' });
    expect(screen.getByText(/Zoom 150%/)).toBeTruthy();
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(viewport(), { key: 'x' });
    expect(outer).toHaveBeenCalledTimes(1);
    // Centre stays fixed when zooming from the buttons/keys.
    pointer(viewport(), 'pointerDown', 320, 160);
    pointer(viewport(), 'pointerUp', 320, 160);
    expect(onPoint).toHaveBeenCalledWith({ x: 0.5, y: 0.5 });
    fireEvent.click(screen.getByRole('button', { name: 'Fit to width' }));
    expect(screen.getByText(/Zoom 100%/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText(/Zoom 150%/)).toBeTruthy();
  });

  it('draws overlay items with glyphs and plain labels', () => {
    const { container } = render(
      <FigureCanvas
        {...base}
        overlay={[
          { kind: 'rect', id: 'k', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, tone: 'miss', label: '**Spike** F8' },
          { kind: 'point', id: 'p', x: 0.5, y: 0.5, tone: 'hit', label: '1' },
        ]}
      />,
    );
    const texts = Array.from(container.querySelectorAll('svg text')).map((t) => t.textContent);
    expect(texts).toEqual(['! Spike F8', '✓ 1']);
    const rect = container.querySelector('svg rect')!;
    expect(Number(rect.getAttribute('x'))).toBeCloseTo(64, 6);
    expect(rect.getAttribute('stroke-dasharray')).toBe('5 3');
  });

  it('shows a readable message when the image fails', () => {
    render(<FigureCanvas {...base} />);
    fireEvent.error(screen.getByRole('img', { name: 'EEG figure' }));
    expect(screen.getByRole('alert').textContent).toContain('Image could not be loaded');
  });
});

describe('useEegTheme', () => {
  function Probe() {
    const t = useEegTheme();
    return <span data-testid="trace">{t.trace}</span>;
  }

  it('reads CSS variables and re-renders when data-theme changes', async () => {
    document.documentElement.style.setProperty('--text', '#111111');
    render(<Probe />);
    expect(screen.getByTestId('trace').textContent).toBe('#111111');
    document.documentElement.style.setProperty('--text', '#eeeeee');
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      await Promise.resolve();
    });
    expect(screen.getByTestId('trace').textContent).toBe('#eeeeee');
  });
});

describe('useFigureMarks', () => {
  const targets = [{ id: 't1', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, label: 'Spike' }];
  function Harness({ onResult }: { onResult: (r: unknown) => void }) {
    const fm = useFigureMarks({ mode: 'point', targets, distractors: [{ rect: { x: 0.7, y: 0.7, w: 0.2, h: 0.2 }, note: 'Blink' }] });
    return (
      <div>
        <button onClick={() => fm.addPoint({ x: 0.2, y: 0.2 })}>hit</button>
        <button onClick={() => fm.addPoint({ x: 0.8, y: 0.8 })}>blink</button>
        <button onClick={() => onResult(fm.check())}>check</button>
        <button onClick={fm.reset}>reset</button>
        <output data-testid="state">{JSON.stringify({ n: fm.marks.length, checked: fm.checked, fb: fm.feedback, overlay: fm.overlay.length, snap: fm.snapshot })}</output>
      </div>
    );
  }

  it('adds marks, checks with feedback, and resets', () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByText('hit'));
    fireEvent.click(screen.getByText('blink'));
    fireEvent.click(screen.getByText('check'));
    expect(onResult.mock.calls[0][0]).toMatchObject({ hits: 1, falseMarks: [1] });
    const s = JSON.parse(screen.getByTestId('state').textContent!);
    expect(s.checked).toBe(true);
    expect(s.fb).toMatchObject({ found: [{ id: 't1', label: 'Spike' }], missed: [], distractorNotes: ['Blink'], falseCount: 1 });
    expect(s.snap.marks).toHaveLength(2);
    fireEvent.click(screen.getByText('hit')); // locked after check
    expect(JSON.parse(screen.getByTestId('state').textContent!).n).toBe(2);
    fireEvent.click(screen.getByText('reset'));
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toMatchObject({ n: 0, checked: false, fb: null });
  });
});

describe('useWidgetProgress', () => {
  it('saves immediately, debounces settings and flushes on unmount', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const key = { courseSlug: 'c', lessonSlug: 'l', sectionId: 's' };
    let api: ReturnType<typeof useWidgetProgress> | null = null;
    function Harness() {
      api = useWidgetProgress(key);
      return null;
    }
    const { unmount } = render(<Harness />);
    expect(api!.enabled).toBe(true);
    await act(async () => {
      await api!.saveNow({ done: true, score: { correct: 1, total: 1 } });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => api!.saveDebounced({ done: true, widgetState: { v: 1 } }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(init.keepalive).toBe(true);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is disabled without a progress key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    let api: ReturnType<typeof useWidgetProgress> | null = null;
    function Harness() {
      api = useWidgetProgress(undefined);
      return null;
    }
    render(<Harness />);
    expect(api!.enabled).toBe(false);
    expect(await api!.saveNow({ done: true })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
