// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsMenu, THEME_STORAGE_KEY } from './SettingsMenu';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.setAttribute('data-theme', 'light');
});

afterEach(() => {
  cleanup();
});

describe('SettingsMenu (US-134) — Sunset theme option', () => {
  it('exposes Sunset as a Theme option and applies data-theme="sunset" when selected', () => {
    render(<SettingsMenu />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));

    const sunsetOpt = screen.getByTestId('settings-theme-sunset');
    expect(sunsetOpt).not.toBeNull();
    expect(sunsetOpt.textContent).toBe('Sunset');

    fireEvent.click(sunsetOpt);
    expect(document.documentElement.getAttribute('data-theme')).toBe('sunset');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('sunset');
  });

  it('still surfaces light/dark/system alongside sunset', () => {
    render(<SettingsMenu />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));

    expect(screen.getByTestId('settings-theme-light')).not.toBeNull();
    expect(screen.getByTestId('settings-theme-dark')).not.toBeNull();
    expect(screen.getByTestId('settings-theme-sunset')).not.toBeNull();
    expect(screen.getByTestId('settings-theme-system')).not.toBeNull();
  });
});
