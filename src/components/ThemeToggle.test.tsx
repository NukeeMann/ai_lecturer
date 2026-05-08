// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeToggle } from './ThemeToggle';
import { THEME_STORAGE_KEY } from './SettingsMenu';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.setAttribute('data-theme', 'light');
});

afterEach(() => {
  cleanup();
});

describe('ThemeToggle (US-134) — 3-way cycle', () => {
  it('cycles light → sunset → dark → light on successive clicks, persisting each step', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<ThemeToggle />);
    const btn = screen.getByTestId('theme-toggle');

    // First click: light → sunset
    fireEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('sunset');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('sunset');
    expect(btn.getAttribute('data-theme-state')).toBe('sunset');

    // Second click: sunset → dark
    fireEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(btn.getAttribute('data-theme-state')).toBe('dark');

    // Third click: dark → light
    fireEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(btn.getAttribute('data-theme-state')).toBe('light');
  });

  it('updates aria-label per state to advertise the next state', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<ThemeToggle />);
    const btn = screen.getByTestId('theme-toggle');

    expect(btn.getAttribute('aria-label')).toBe('Switch to sunset mode');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-label')).toBe('Switch to dark mode');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-label')).toBe('Switch to light mode');
  });

  it('reads existing data-theme="sunset" on mount and advances to dark on first click', () => {
    document.documentElement.setAttribute('data-theme', 'sunset');
    render(<ThemeToggle />);
    const btn = screen.getByTestId('theme-toggle');
    expect(btn.getAttribute('data-theme-state')).toBe('sunset');
    expect(btn.getAttribute('aria-label')).toBe('Switch to dark mode');

    fireEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});
