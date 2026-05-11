'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Settings as SettingsIcon } from 'lucide-react';

import {
  isMod,
  useKeyboardShortcuts,
  type KeyboardShortcut,
} from '@/lib/hooks/useKeyboardShortcuts';

type ThemePref = 'light' | 'dark' | 'sunset' | 'system';
type Density = 'compact' | 'comfortable' | 'spacious';
type Accent = 'default' | 'black' | 'indigo' | 'terracotta' | 'emerald';
type FontFamily = 'geist' | 'ibm-plex' | 'source-serif';
type SunsetVariant = 'A' | 'B' | 'C';

export const THEME_STORAGE_KEY = 'aiLecturer.theme';
export const DENSITY_STORAGE_KEY = 'aiLecturer.density';
export const FONT_STORAGE_KEY = 'aiLecturer.font';
export const TEXT_SCALE_STORAGE_KEY = 'aiLecturer.textScale';
export const SUNSET_VARIANT_STORAGE_KEY = 'aiLecturer.sunsetVariant';
// Ship-first default per US-162 research note (Candidate A "Ember Drive").
export const SUNSET_VARIANT_DEFAULT: SunsetVariant = 'A';

export const TEXT_SCALE_MIN = 0.8;
export const TEXT_SCALE_MAX = 1.4;
export const TEXT_SCALE_STEP = 0.05;
export const TEXT_SCALE_DEFAULT = 1;
// Per-course accent override key. Suffixed with the course slug, e.g.
// 'aiLecturer.accent.widget-dev-guide'. Stored value is one of the Accent
// literals; absence means "use the course default declared in course.json".
export const ACCENT_STORAGE_KEY_PREFIX = 'aiLecturer.accent.';
// Dispatched by SettingsMenu (and ThemeToggle) whenever theme/density/accent
// changes so co-resident controls can re-read the persisted value within the
// same tab. (The native `storage` event only fires across tabs.)
export const SETTINGS_CHANGE_EVENT = 'aiLecturer:settings-change';

const ACCENT_VALUES: Accent[] = [
  'default',
  'black',
  'indigo',
  'terracotta',
  'emerald',
];

export function accentStorageKey(courseSlug: string): string {
  return `${ACCENT_STORAGE_KEY_PREFIX}${courseSlug}`;
}

function isAccent(v: unknown): v is Accent {
  return typeof v === 'string' && (ACCENT_VALUES as string[]).includes(v);
}

export function readAccentOverride(courseSlug: string): Accent | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(accentStorageKey(courseSlug));
    return isAccent(v) ? v : null;
  } catch {
    return null;
  }
}

export function applyAccent(value: Accent): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-accent', value);
}

function readThemePref(): ThemePref {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'sunset' || v === 'system') return v;
  } catch {
    // localStorage may be unavailable; fall through to default.
  }
  return 'system';
}

function readDensity(): Density {
  if (typeof window === 'undefined') return 'comfortable';
  try {
    const v = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    if (v === 'compact' || v === 'comfortable' || v === 'spacious') return v;
  } catch {
    // localStorage may be unavailable; fall through to default.
  }
  return 'comfortable';
}

function readFont(): FontFamily {
  if (typeof window === 'undefined') return 'geist';
  try {
    const v = window.localStorage.getItem(FONT_STORAGE_KEY);
    if (v === 'geist' || v === 'ibm-plex' || v === 'source-serif') return v;
  } catch {
    // localStorage may be unavailable; fall through to default.
  }
  return 'geist';
}

function readSunsetVariant(): SunsetVariant {
  if (typeof window === 'undefined') return SUNSET_VARIANT_DEFAULT;
  try {
    const v = window.localStorage.getItem(SUNSET_VARIANT_STORAGE_KEY);
    if (v === 'A' || v === 'B' || v === 'C') return v;
  } catch {
    // localStorage may be unavailable; fall through to default.
  }
  return SUNSET_VARIANT_DEFAULT;
}

function clampTextScale(n: number): number {
  if (!Number.isFinite(n)) return TEXT_SCALE_DEFAULT;
  if (n < TEXT_SCALE_MIN) return TEXT_SCALE_MIN;
  if (n > TEXT_SCALE_MAX) return TEXT_SCALE_MAX;
  return n;
}

export function readTextScale(): number {
  if (typeof window === 'undefined') return TEXT_SCALE_DEFAULT;
  try {
    const raw = window.localStorage.getItem(TEXT_SCALE_STORAGE_KEY);
    if (raw === null) return TEXT_SCALE_DEFAULT;
    const parsed = Number.parseFloat(raw);
    return clampTextScale(parsed);
  } catch {
    return TEXT_SCALE_DEFAULT;
  }
}

export function applyTextScale(value: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(
    '--text-scale',
    String(clampTextScale(value)),
  );
}

function systemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(pref: ThemePref): void {
  const effective = pref === 'system' ? systemTheme() : pref;
  document.documentElement.setAttribute('data-theme', effective);
}

function applyDensity(d: Density): void {
  document.documentElement.setAttribute('data-density', d);
}

function applyFont(f: FontFamily): void {
  document.documentElement.setAttribute('data-font', f);
}

function applySunsetVariant(v: SunsetVariant): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-sunset-variant', v);
}

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'system', label: 'System' },
];

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'spacious', label: 'Spacious' },
];

const FONT_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: 'geist', label: 'Geist' },
  { value: 'ibm-plex', label: 'IBM Plex Sans' },
  { value: 'source-serif', label: 'Source Serif' },
];

const SUNSET_VARIANT_OPTIONS: { value: SunsetVariant; label: string }[] = [
  { value: 'A', label: 'A — Ember Drive' },
  { value: 'B', label: 'B — Magenta Dusk' },
  { value: 'C', label: 'C — Coastal Sundown' },
];

const ACCENT_OPTIONS: { value: Accent; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'black', label: 'Black' },
  { value: 'indigo', label: 'Indigo' },
  { value: 'terracotta', label: 'Terracotta' },
  { value: 'emerald', label: 'Emerald' },
];

const triggerBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
  border: 'none',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  borderRadius: 'var(--radius-md)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
};

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  minWidth: 220,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-lg)',
  padding: 8,
  zIndex: 100,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const groupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 4,
};

const groupLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-xs)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
  color: 'var(--text-tertiary)',
  paddingBottom: 2,
};

const radioGroupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const optionStyle: CSSProperties = {
  textAlign: 'left',
  background: 'transparent',
  border: '1px solid transparent',
  color: 'var(--text-secondary)',
  borderRadius: 'var(--radius-sm)',
  padding: '6px 8px',
  fontSize: 'var(--fs-sm)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const optionSelectedStyle: CSSProperties = {
  ...optionStyle,
  background: 'var(--bg-subtle)',
  color: 'var(--text)',
  fontWeight: 500,
};

export interface SettingsMenuProps {
  // Course context for the per-course Accent picker. When `courseSlug` is
  // provided, the Accent group is rendered. The selected value is the
  // override stored at accentStorageKey(courseSlug) if present, otherwise
  // `courseDefaultAccent` (declared in course.json), otherwise 'default'.
  // Selecting an option both writes the override and applies it live to
  // <html data-accent>.
  courseSlug?: string;
  courseDefaultAccent?: Accent;
}

export function SettingsMenu({
  courseSlug,
  courseDefaultAccent,
}: SettingsMenuProps = {}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>('system');
  const [density, setDensity] = useState<Density>('comfortable');
  const [font, setFont] = useState<FontFamily>('geist');
  const [textScale, setTextScale] = useState<number>(TEXT_SCALE_DEFAULT);
  const [sunsetVariant, setSunsetVariant] =
    useState<SunsetVariant>(SUNSET_VARIANT_DEFAULT);
  const [accent, setAccent] = useState<Accent>(
    courseDefaultAccent ?? 'default',
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Initial sync from localStorage. The boot script in layout.tsx applies the
  // attributes to <html> before paint; here we only mirror those values into
  // React state so the dropdown reflects the correct selection on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(readThemePref());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDensity(readDensity());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFont(readFont());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTextScale(readTextScale());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSunsetVariant(readSunsetVariant());
  }, []);

  // Resolve the visible accent selection from override + course default. Runs
  // when the course context changes (entering a different course), or when
  // the course default changes after async fetch.
  useEffect(() => {
    if (!courseSlug) return;
    const override = readAccentOverride(courseSlug);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccent(override ?? courseDefaultAccent ?? 'default');
  }, [courseSlug, courseDefaultAccent]);

  // Stay in sync when ThemeToggle (same tab, custom event) or another tab
  // (storage event) changes the persisted values.
  useEffect(() => {
    function refresh() {
      setTheme(readThemePref());
      setDensity(readDensity());
      setFont(readFont());
      setTextScale(readTextScale());
      setSunsetVariant(readSunsetVariant());
      if (courseSlug) {
        const override = readAccentOverride(courseSlug);
        setAccent(override ?? courseDefaultAccent ?? 'default');
      }
    }
    window.addEventListener(SETTINGS_CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SETTINGS_CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [courseSlug, courseDefaultAccent]);

  // When 'system' is selected, follow live OS-level preference changes.
  useEffect(() => {
    if (theme !== 'system') return;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [theme]);

  // Outside click + Escape close the dropdown.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Ctrl+, / Cmd+, toggles the dropdown. preventDefault overrides the macOS
  // browser default of opening the application's preferences pane.
  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      {
        match: (e) =>
          isMod(e) && !e.shiftKey && !e.altKey && e.key === ',',
        handler: () => setOpen((v) => !v),
      },
    ],
    [],
  );
  useKeyboardShortcuts(shortcuts);

  const onThemeSelect = useCallback((next: ThemePref) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable; in-memory selection still works.
    }
    applyTheme(next);
    setTheme(next);
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
  }, []);

  const onDensitySelect = useCallback((next: Density) => {
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable; in-memory selection still works.
    }
    applyDensity(next);
    setDensity(next);
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
  }, []);

  const onFontSelect = useCallback((next: FontFamily) => {
    try {
      window.localStorage.setItem(FONT_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable; in-memory selection still works.
    }
    applyFont(next);
    setFont(next);
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
  }, []);

  const onTextScaleSelect = useCallback((next: number) => {
    const clamped = clampTextScale(next);
    try {
      window.localStorage.setItem(TEXT_SCALE_STORAGE_KEY, String(clamped));
    } catch {
      // localStorage unavailable; in-memory selection still works.
    }
    applyTextScale(clamped);
    setTextScale(clamped);
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
  }, []);

  const onSunsetVariantSelect = useCallback((next: SunsetVariant) => {
    try {
      window.localStorage.setItem(SUNSET_VARIANT_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable; in-memory selection still works.
    }
    applySunsetVariant(next);
    setSunsetVariant(next);
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
  }, []);

  const onAccentSelect = useCallback(
    (next: Accent) => {
      if (!courseSlug) return;
      try {
        window.localStorage.setItem(accentStorageKey(courseSlug), next);
      } catch {
        // localStorage unavailable; in-memory selection still works.
      }
      applyAccent(next);
      setAccent(next);
      window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    },
    [courseSlug],
  );

  return (
    <div
      ref={containerRef}
      data-testid="settings-menu-root"
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      <button
        type="button"
        data-testid="settings-menu-trigger"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={triggerBtnStyle}
      >
        <SettingsIcon size={16} strokeWidth={2} />
      </button>
      {open ? (
        <div
          data-testid="settings-menu"
          role="menu"
          aria-label="Settings"
          style={panelStyle}
        >
          <SettingsGroup
            label="Theme"
            options={THEME_OPTIONS}
            value={theme}
            onSelect={onThemeSelect}
            testIdPrefix="settings-theme"
          />
          {theme === 'sunset' ? (
            <SettingsGroup
              label="Sunset variant"
              options={SUNSET_VARIANT_OPTIONS}
              value={sunsetVariant}
              onSelect={onSunsetVariantSelect}
              testIdPrefix="settings-sunset-variant"
            />
          ) : null}
          <SettingsGroup
            label="Density"
            options={DENSITY_OPTIONS}
            value={density}
            onSelect={onDensitySelect}
            testIdPrefix="settings-density"
          />
          <SettingsGroup
            label="Font"
            options={FONT_OPTIONS}
            value={font}
            onSelect={onFontSelect}
            testIdPrefix="settings-font"
          />
          <TextScaleGroup
            value={textScale}
            onSelect={onTextScaleSelect}
          />
          {courseSlug ? (
            <SettingsGroup
              label="Accent"
              options={ACCENT_OPTIONS}
              value={accent}
              onSelect={onAccentSelect}
              testIdPrefix="settings-accent"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface SettingsGroupProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onSelect: (v: T) => void;
  testIdPrefix: string;
}

function SettingsGroup<T extends string>({
  label,
  options,
  value,
  onSelect,
  testIdPrefix,
}: SettingsGroupProps<T>) {
  return (
    <section data-testid={`${testIdPrefix}-group`} style={groupStyle}>
      <h3 style={groupLabelStyle}>{label}</h3>
      <div role="radiogroup" aria-label={label} style={radioGroupStyle}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              data-testid={`${testIdPrefix}-${opt.value}`}
              aria-checked={selected}
              aria-selected={selected}
              onClick={() => onSelect(opt.value)}
              style={selected ? optionSelectedStyle : optionStyle}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

const sliderRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 4px 2px',
};

const sliderInputStyle: CSSProperties = {
  flex: 1,
  cursor: 'pointer',
  accentColor: 'var(--accent)',
};

const sliderReadoutStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-secondary)',
  fontVariantNumeric: 'tabular-nums',
  minWidth: 36,
  textAlign: 'right',
};

interface TextScaleGroupProps {
  value: number;
  onSelect: (next: number) => void;
}

function TextScaleGroup({ value, onSelect }: TextScaleGroupProps) {
  const percent = `${Math.round(value * 100)}%`;
  return (
    <section data-testid="settings-text-scale-group" style={groupStyle}>
      <h3 style={groupLabelStyle}>Text size</h3>
      <div style={sliderRowStyle}>
        <input
          type="range"
          min={TEXT_SCALE_MIN}
          max={TEXT_SCALE_MAX}
          step={TEXT_SCALE_STEP}
          value={value}
          onChange={(e) => onSelect(Number.parseFloat(e.target.value))}
          aria-label="Text size"
          aria-valuemin={TEXT_SCALE_MIN}
          aria-valuemax={TEXT_SCALE_MAX}
          aria-valuenow={value}
          aria-valuetext={percent}
          data-testid="settings-text-scale-slider"
          style={sliderInputStyle}
        />
        <span data-testid="settings-text-scale-value" style={sliderReadoutStyle}>
          {percent}
        </span>
      </div>
    </section>
  );
}
