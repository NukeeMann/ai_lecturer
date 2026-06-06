// Simplified version of the AccentIcon used on the main dashboard
// (src/app/page.tsx). The static export can't import that file directly
// because it's a 'use client' page with React hooks and a lot of unrelated
// state — so we mirror the palette and use a STATIC icon map.
//
// We intentionally do NOT use `lucide-react/dynamic`: Vite emits a separate
// chunk per dynamic import, and lucide-dynamic has ~1500 icons → ~1500 tiny
// JS files in the output. That bloats the dist by an order of magnitude and
// makes FTP uploads time out / fail. Instead we hand-pick the icon names
// the courses actually use (grep on courses/*/course.json) and statically
// import only those. Unknown names fall back to BookOpen.

import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  BarChart3,
  Code,
  Compass,
  FileText,
  Flame,
  FlaskConical,
  Headphones,
  Image as ImageIcon,
  Languages,
  Layers,
  Mic,
  Move,
  Satellite,
  ScanEye,
  Sigma,
  Table,
  Target,
  Video,
} from 'lucide-react';

// Zharmonizowana, ciepła/przygaszona paleta — spójna z reskinem zajawa.eu
// (alabaster + petrol). Kursy nadal rozróżnialne kolorem, ale stonowane.
const accentPalette: Record<string, { color: string; bg: string }> = {
  default: { color: '#6f8a4e', bg: 'color-mix(in srgb, #6f8a4e 16%, var(--bg-subtle))' }, // matcha (akcent)
  indigo: { color: '#5f6488', bg: 'color-mix(in srgb, #5f6488 16%, var(--bg-subtle))' }, // przygaszony granat
  emerald: { color: '#5f7d5f', bg: 'color-mix(in srgb, #5f7d5f 16%, var(--bg-subtle))' }, // szałwia
  terracotta: { color: '#b06b4f', bg: 'color-mix(in srgb, #b06b4f 16%, var(--bg-subtle))' }, // terakota
  black: { color: '#4a443c', bg: 'color-mix(in srgb, #4a443c 12%, var(--bg-subtle))' }, // ciepły tusz
};

const iconMap: Record<string, LucideIcon> = {
  'bar-chart-3': BarChart3,
  'book-open': BookOpen,
  code: Code,
  compass: Compass,
  'file-text': FileText,
  flame: Flame,
  'flask-conical': FlaskConical,
  headphones: Headphones,
  image: ImageIcon,
  languages: Languages,
  layers: Layers,
  mic: Mic,
  move: Move,
  satellite: Satellite,
  'scan-eye': ScanEye,
  sigma: Sigma,
  table: Table,
  target: Target,
  video: Video,
};

export function AccentIcon({
  iconName,
  accent,
  size = 36,
  glyphSize = 18,
}: {
  iconName?: string;
  accent?: string;
  size?: number;
  glyphSize?: number;
}) {
  const palette = accentPalette[accent ?? 'default'] ?? accentPalette.default;
  const Glyph: LucideIcon = (iconName && iconMap[iconName]) || BookOpen;
  return (
    <div
      data-accent-icon
      data-accent={accent ?? 'default'}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: palette.bg,
        color: palette.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Glyph size={glyphSize} strokeWidth={2} />
    </div>
  );
}
