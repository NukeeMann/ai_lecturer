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

type ThemePref = 'light' | 'dark' | 'system';
type Density = 'compact' | 'comfortable' | 'spacious';

export const THEME_STORAGE_KEY = 'aiLecturer.theme';
export const DENSITY_STORAGE_KEY = 'aiLecturer.density';
// Dispatched by SettingsMenu (and ThemeToggle) whenever theme/density changes
// so co-resident controls can re-read the persisted value within the same tab.
// (The native `storage` event only fires across tabs.)
export const SETTINGS_CHANGE_EVENT = 'aiLecturer:settings-change';

function readThemePref(): ThemePref {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
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

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'spacious', label: 'Spacious' },
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

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>('system');
  const [density, setDensity] = useState<Density>('comfortable');
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Initial sync from localStorage. The boot script in layout.tsx applies the
  // attributes to <html> before paint; here we only mirror those values into
  // React state so the dropdown reflects the correct selection on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(readThemePref());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDensity(readDensity());
  }, []);

  // Stay in sync when ThemeToggle (same tab, custom event) or another tab
  // (storage event) changes the persisted values.
  useEffect(() => {
    function refresh() {
      setTheme(readThemePref());
      setDensity(readDensity());
    }
    window.addEventListener(SETTINGS_CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SETTINGS_CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

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
          <SettingsGroup
            label="Density"
            options={DENSITY_OPTIONS}
            value={density}
            onSelect={onDensitySelect}
            testIdPrefix="settings-density"
          />
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
