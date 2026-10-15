// Small, dependency-free CSS colour helpers for canvas/SVG rendering of the
// EEG widgets. Pure TypeScript, Node-safe.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function channel(token: string): number | null {
  const t = token.trim();
  if (t.endsWith('%')) {
    const p = Number(t.slice(0, -1));
    return Number.isFinite(p) ? clamp((p / 100) * 255, 0, 255) : null;
  }
  const v = Number(t);
  return Number.isFinite(v) ? clamp(v, 0, 255) : null;
}

function alpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const t = token.trim();
  if (t.endsWith('%')) {
    const p = Number(t.slice(0, -1));
    return Number.isFinite(p) ? clamp(p / 100, 0, 1) : null;
  }
  const v = Number(t);
  return Number.isFinite(v) ? clamp(v, 0, 1) : null;
}

/**
 * Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` (comma or
 * space syntax, % channels, `/ alpha`) and `transparent`. Returns null for
 * anything else (e.g. oklch — normalise those in the browser first).
 */
export function parseCssColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    const expand = hex.length === 3 || hex.length === 4 ? hex.split('').map((c) => c + c).join('') : hex;
    if (expand.length !== 6 && expand.length !== 8) return null;
    const n = (i: number) => parseInt(expand.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: expand.length === 8 ? n(6) / 255 : 1 };
  }
  const m = /^rgba?\((.*)\)$/.exec(s);
  if (!m) return null;
  const body = m[1].trim();
  let parts: string[];
  let a: string | undefined;
  if (body.includes(',')) {
    parts = body.split(',');
    if (parts.length === 4) a = parts.pop();
  } else {
    const [rgb, al] = body.split('/');
    parts = rgb.trim().split(/\s+/);
    a = al;
  }
  if (parts.length !== 3) return null;
  const [r, g, b] = parts.map(channel);
  const av = alpha(a);
  if (r === null || g === null || b === null || av === null) return null;
  return { r, g, b, a: av };
}

export function formatRgba({ r, g, b, a }: Rgba): string {
  const R = Math.round(r), G = Math.round(g), B = Math.round(b);
  return a >= 1 ? `rgb(${R}, ${G}, ${B})` : `rgba(${R}, ${G}, ${B}, ${Number(a.toFixed(3))})`;
}

/** The colour with its alpha multiplied by `a` (unparseable colours returned unchanged). */
export function withAlpha(color: string, a: number): string {
  const c = parseCssColor(color);
  return c ? formatRgba({ ...c, a: c.a * clamp(a, 0, 1) }) : color;
}

/** Linear mix in sRGB: t = 0 → `a`, t = 1 → `b`. Falls back to the nearer endpoint. */
export function mixColors(a: string, b: string, t: number): string {
  const ca = parseCssColor(a);
  const cb = parseCssColor(b);
  const k = clamp(t, 0, 1);
  if (!ca || !cb) return k < 0.5 ? a : b;
  return formatRgba({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
    a: ca.a + (cb.a - ca.a) * k,
  });
}

/** WCAG relative luminance (0 = black, 1 = white); null if unparseable. */
export function relativeLuminance(color: string): number | null {
  const c = parseCssColor(color);
  if (!c) return null;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/**
 * Diverging palette for potentials (head maps): −maxAbs → `negative`,
 * 0 → `neutral`, +maxAbs → `positive`. Pair it with a legend/sign so colour
 * is never the only cue.
 */
export function divergingColor(
  value: number,
  maxAbs: number,
  colors: { negative: string; neutral: string; positive: string },
): string {
  if (!(maxAbs > 0) || !Number.isFinite(value)) return colors.neutral;
  const t = clamp(Math.abs(value) / maxAbs, 0, 1);
  return mixColors(colors.neutral, value < 0 ? colors.negative : colors.positive, t);
}
