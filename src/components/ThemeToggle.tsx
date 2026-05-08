'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Moon, Sun, Sunrise } from 'lucide-react';

import {
  SETTINGS_CHANGE_EVENT,
  THEME_STORAGE_KEY,
} from '@/components/SettingsMenu';

type Theme = 'light' | 'dark' | 'sunset';

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'sunset') return 'sunset';
  return attr === 'dark' ? 'dark' : 'light';
}

function nextTheme(t: Theme): Theme {
  // light → sunset → dark → light
  if (t === 'light') return 'sunset';
  if (t === 'sunset') return 'dark';
  return 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Sync React state from the data-theme attribute the inline boot script
    // already set. Standard "read external DOM state once on mount" pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    setTheme(readTheme());

    // Re-read whenever SettingsMenu (same tab) or another tab (storage event)
    // changes the persisted theme so this icon button stays in sync.
    function refresh() {
      setTheme(readTheme());
    }
    window.addEventListener(SETTINGS_CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SETTINGS_CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const toggle = () => {
    const next = nextTheme(theme);
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable; in-memory toggle still works for the session.
    }
    setTheme(next);
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
  };

  const ariaLabel =
    theme === 'light'
      ? 'Switch to sunset mode'
      : theme === 'sunset'
        ? 'Switch to dark mode'
        : 'Switch to light mode';

  const buttonStyle: CSSProperties = {
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

  const iconWrapStyle: CSSProperties = {
    position: 'relative',
    width: 16,
    height: 16,
    display: 'inline-block',
    // Hide all icons until we've read the actual theme to avoid a one-frame
    // mismatch between SSR (always 'light') and the post-script DOM.
    opacity: mounted ? 1 : 0,
  };

  const layeredIcon: CSSProperties = {
    position: 'absolute',
    inset: 0,
    transition: 'opacity 120ms ease, transform 120ms ease',
  };

  // Visible icon per state: light → Moon (next-state hint),
  // sunset → Sunrise, dark → Sun.
  const showMoon = theme === 'light';
  const showSunrise = theme === 'sunset';
  const showSun = theme === 'dark';

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      data-theme-state={theme}
      aria-label={ariaLabel}
      onClick={toggle}
      style={buttonStyle}
    >
      <span style={iconWrapStyle} aria-hidden>
        <Sun
          size={16}
          strokeWidth={2}
          style={{
            ...layeredIcon,
            opacity: showSun ? 1 : 0,
            transform: showSun ? 'rotate(0deg)' : 'rotate(-180deg)',
          }}
        />
        <Sunrise
          size={16}
          strokeWidth={2}
          style={{
            ...layeredIcon,
            opacity: showSunrise ? 1 : 0,
            transform: showSunrise ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        />
        <Moon
          size={16}
          strokeWidth={2}
          style={{
            ...layeredIcon,
            opacity: showMoon ? 1 : 0,
            transform: showMoon ? 'rotate(0deg)' : 'rotate(180deg)',
          }}
        />
      </span>
    </button>
  );
}
