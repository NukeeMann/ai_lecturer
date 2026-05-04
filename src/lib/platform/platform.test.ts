import { describe, expect, test } from 'vitest';

import { isMacPlatform, keyLabel, modLabel } from './platform';

describe('isMacPlatform', () => {
  test('detects macOS desktop user-agent', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    expect(isMacPlatform(ua)).toBe(true);
  });

  test('detects iOS user-agent (iPhone/iPad/iPod)', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(isMacPlatform(iphone)).toBe(true);
    const ipad =
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
    expect(isMacPlatform(ipad)).toBe(true);
  });

  test('Windows user-agent is NOT mac', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(isMacPlatform(ua)).toBe(false);
  });

  test('Linux user-agent is NOT mac', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36';
    expect(isMacPlatform(ua)).toBe(false);
  });

  test('Android user-agent is NOT mac', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, ' +
      'like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    expect(isMacPlatform(ua)).toBe(false);
  });

  test('empty / undefined user-agent defaults to non-mac', () => {
    expect(isMacPlatform('')).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});

describe('keyLabel — macOS', () => {
  test('mod token → ⌘', () => {
    expect(keyLabel('mod', true)).toBe('⌘');
  });

  test('alt token → ⌥', () => {
    expect(keyLabel('alt', true)).toBe('⌥');
  });

  test('shift token → ⇧', () => {
    expect(keyLabel('shift', true)).toBe('⇧');
  });

  test('ctrl token → ⌃', () => {
    expect(keyLabel('ctrl', true)).toBe('⌃');
  });

  test('enter token stays as ↵ on macOS', () => {
    expect(keyLabel('enter', true)).toBe('↵');
  });

  test('literal keys pass through unchanged on macOS', () => {
    expect(keyLabel('B', true)).toBe('B');
    expect(keyLabel('.', true)).toBe('.');
    expect(keyLabel('?', true)).toBe('?');
  });
});

describe('keyLabel — Windows / Linux (bug repro for US-059)', () => {
  // Bug repro: AC says "On Windows + Linux: shortcut hints + modal display
  // 'Ctrl', 'Alt', 'Shift' (no ⌘/⌥/⌃ glyphs)". A pre-fix implementation
  // returning the macOS glyph regardless of platform fails these assertions.
  test('mod token → Ctrl (NOT ⌘)', () => {
    const label = keyLabel('mod', false);
    expect(label).toBe('Ctrl');
    expect(label).not.toBe('⌘');
  });

  test('alt token → Alt (NOT ⌥)', () => {
    const label = keyLabel('alt', false);
    expect(label).toBe('Alt');
    expect(label).not.toBe('⌥');
  });

  test('shift token → Shift (NOT ⇧)', () => {
    const label = keyLabel('shift', false);
    expect(label).toBe('Shift');
    expect(label).not.toBe('⇧');
  });

  test('ctrl token → Ctrl (NOT ⌃)', () => {
    const label = keyLabel('ctrl', false);
    expect(label).toBe('Ctrl');
    expect(label).not.toBe('⌃');
  });

  test('enter token stays as ↵ on non-mac (universal glyph)', () => {
    expect(keyLabel('enter', false)).toBe('↵');
  });

  test('literal keys pass through unchanged on non-mac', () => {
    expect(keyLabel('B', false)).toBe('B');
    expect(keyLabel('.', false)).toBe('.');
    expect(keyLabel('?', false)).toBe('?');
  });
});

describe('modLabel — inline hint helper', () => {
  test('returns ⌘ on macOS', () => {
    expect(modLabel(true)).toBe('⌘');
  });

  // Bug repro for US-059: chat composer hint must NOT show ⌘ on Windows/Linux.
  test('returns Ctrl on Windows / Linux (NOT ⌘)', () => {
    expect(modLabel(false)).toBe('Ctrl');
    expect(modLabel(false)).not.toBe('⌘');
  });
});
