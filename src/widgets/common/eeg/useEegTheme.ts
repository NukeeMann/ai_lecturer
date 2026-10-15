'use client';

// Theme colours for canvas/SVG rendering of the EEG widgets.
//
// Canvas cannot use CSS variables, so the tokens are read with
// getComputedStyle(<html>) and re-read whenever the theme changes:
// a MutationObserver watches data-theme / data-accent / data-sunset-variant /
// data-font / class on <html>, plus the app's `aiLecturer:settings-change`
// event (see MermaidDiagram.tsx for the same approach). All values come back
// as canvas-parseable strings (oklch()/color-mix() are normalised to rgb by
// painting one pixel, as the zajawa export reskin uses oklch tokens).

import { useSyncExternalStore } from 'react';

import { parseCssColor, relativeLuminance } from './color';

export interface EegTheme {
  /** Canvas background (widget surface). */
  bg: string;
  /** Slightly darker surface (label column, toolbars). */
  bgSubtle: string;
  /** 1-s grid lines. */
  grid: string;
  /** 5-s grid lines. */
  gridStrong: string;
  trace: string;
  /** Unavailable / de-emphasised channels. */
  traceDim: string;
  /** Channel labels and axis text. */
  label: string;
  /** Primary text. */
  text: string;
  accent: string;
  /** Correct marks / found targets. */
  hit: string;
  /** Missed targets. */
  miss: string;
  /** Wrong (false) marks. */
  falseMark: string;
  /** Expert answer key overlay. */
  keyOverlay: string;
  /** Expert annotations from the recording. */
  annotation: string;
  /** Learner selection / draft ranges. */
  selection: string;
  /** Caliper lines and readout. */
  caliper: string;
  /** Diverging palette for potentials (head map): negative / positive. */
  negative: string;
  positive: string;
  fontSans: string;
  fontMono: string;
  isDark: boolean;
}

export const EEG_THEME_FALLBACK: Readonly<EegTheme> = {
  bg: '#ffffff',
  bgSubtle: '#f6f4f0',
  grid: '#e8e4dc',
  gridStrong: '#d4cec3',
  trace: '#18171a',
  traceDim: '#b3ad9f',
  label: '#56524a',
  text: '#18171a',
  accent: '#2563eb',
  hit: '#0d7a5f',
  miss: '#be3a3a',
  falseMark: '#b45309',
  keyOverlay: '#6b3eaa',
  annotation: '#6b3eaa',
  selection: '#2563eb',
  caliper: '#2563eb',
  negative: '#2563eb',
  positive: '#c2410c',
  fontSans: 'system-ui, -apple-system, sans-serif',
  fontMono: 'ui-monospace, Menlo, monospace',
  isDark: false,
};

const DARK_DIVERGING = { negative: '#60a5fa', positive: '#fb923c' };

/** Attributes on <html> that can change token values. */
export const THEME_ATTRIBUTES = ['data-theme', 'data-accent', 'data-sunset-variant', 'data-font', 'class'];

let probe: CanvasRenderingContext2D | null | undefined;

/** Normalise any CSS colour to a canvas-safe rgb()/rgba() string (browser only). */
export function normalizeColor(value: string, fallback: string): string {
  const v = value.trim();
  if (!v) return fallback;
  if (parseCssColor(v)) return v;
  if (typeof document === 'undefined') return fallback;
  try {
    if (probe === undefined) {
      probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    }
    if (!probe) return fallback;
    probe.fillStyle = '#000';
    probe.fillStyle = v;
    const a = probe.fillStyle;
    probe.fillStyle = '#fff';
    probe.fillStyle = v;
    if (a !== probe.fillStyle) return fallback; // unparseable → unchanged fillStyle
    probe.clearRect(0, 0, 1, 1);
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, al] = probe.getImageData(0, 0, 1, 1).data;
    return al === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(al / 255).toFixed(3)})`;
  } catch {
    return fallback;
  }
}

/** Read the theme from the document (fallbacks outside the browser). */
export function readEegTheme(root?: Element): EegTheme {
  if (typeof window === 'undefined' || typeof document === 'undefined') return { ...EEG_THEME_FALLBACK };
  const cs = window.getComputedStyle(root ?? document.documentElement);
  const raw = (name: string) => cs.getPropertyValue(name).trim();
  const color = (names: string[], fallback: string) => {
    for (const n of names) {
      const v = raw(n);
      if (v) return normalizeColor(v, fallback);
    }
    return fallback;
  };
  const F = EEG_THEME_FALLBACK;
  const bg = color(['--bg-elevated', '--bg'], F.bg);
  const lum = relativeLuminance(bg);
  const isDark = lum !== null ? lum < 0.35 : (root ?? document.documentElement).getAttribute('data-theme') === 'dark';
  const accent = color(['--accent'], F.accent);
  return {
    bg,
    bgSubtle: color(['--bg-subtle'], F.bgSubtle),
    grid: color(['--border'], F.grid),
    gridStrong: color(['--border-strong'], F.gridStrong),
    trace: color(['--eeg-trace', '--text'], F.trace),
    traceDim: color(['--text-quaternary', '--text-tertiary'], F.traceDim),
    label: color(['--text-secondary'], F.label),
    text: color(['--text'], F.text),
    accent,
    hit: color(['--success'], F.hit),
    miss: color(['--danger'], F.miss),
    falseMark: color(['--warning'], F.falseMark),
    keyOverlay: color(['--insight'], F.keyOverlay),
    annotation: color(['--eeg-annotation', '--insight'], F.annotation),
    selection: accent,
    caliper: accent,
    negative: color(['--eeg-negative'], isDark ? DARK_DIVERGING.negative : F.negative),
    positive: color(['--eeg-positive'], isDark ? DARK_DIVERGING.positive : F.positive),
    fontSans: raw('--font-sans') || F.fontSans,
    fontMono: raw('--font-mono') || F.fontMono,
    isDark,
  };
}

// ── External store: one observer for all mounted widgets ─────────────────────

let cached: EegTheme | null = null;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function invalidate(): void {
  cached = null;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(invalidate);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
    }
    window.addEventListener('aiLecturer:settings-change', invalidate);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      observer?.disconnect();
      observer = null;
      window.removeEventListener('aiLecturer:settings-change', invalidate);
      cached = null;
    }
  };
}

function getSnapshot(): EegTheme {
  if (!cached) cached = readEegTheme();
  return cached;
}

function getServerSnapshot(): EegTheme {
  return EEG_THEME_FALLBACK;
}

/** Current EEG theme colours; re-renders when the app theme changes. */
export function useEegTheme(): EegTheme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
