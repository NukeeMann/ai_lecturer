'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Moon, Sun } from 'lucide-react';

import {
  SETTINGS_CHANGE_EVENT,
  THEME_STORAGE_KEY,
} from '@/components/SettingsMenu';

type Theme = 'light' | 'dark';

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
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
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable; in-memory toggle still works for the session.
    }
    setTheme(next);
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
  };

  const isDark = theme === 'dark';
  const ariaLabel = isDark ? 'Switch to light mode' : 'Switch to dark mode';

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
    // Hide both icons until we've read the actual theme to avoid a one-frame
    // mismatch between SSR (always 'light') and the post-script DOM.
    opacity: mounted ? 1 : 0,
  };

  const layeredIcon: CSSProperties = {
    position: 'absolute',
    inset: 0,
    transition: 'opacity 120ms ease, transform 120ms ease',
  };

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
            opacity: isDark ? 1 : 0,
            transform: isDark ? 'rotate(0deg)' : 'rotate(-180deg)',
          }}
        />
        <Moon
          size={16}
          strokeWidth={2}
          style={{
            ...layeredIcon,
            opacity: isDark ? 0 : 1,
            transform: isDark ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </span>
    </button>
  );
}
