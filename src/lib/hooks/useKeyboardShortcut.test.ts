import { describe, expect, test } from 'vitest';

import { matchesShortcut } from './useKeyboardShortcut';

function evt(init: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): KeyboardEvent {
  // vitest runs in node env (no DOM types backing KeyboardEvent), but the
  // matcher only reads these flags — duck-typing is sufficient.
  return init as unknown as KeyboardEvent;
}

describe('matchesShortcut', () => {
  test('matches plain key with no modifiers required', () => {
    expect(matchesShortcut(evt({ key: 'T' }), { key: 't' })).toBe(true);
  });

  test('case-insensitive on the key', () => {
    expect(matchesShortcut(evt({ key: 't' }), { key: 'T' })).toBe(true);
  });

  test('mod:true matches ⌘ (metaKey) — macOS', () => {
    expect(
      matchesShortcut(evt({ key: 't', metaKey: true }), { key: 't', mod: true }),
    ).toBe(true);
  });

  test('mod:true matches Ctrl (ctrlKey) — Windows / Linux', () => {
    expect(
      matchesShortcut(evt({ key: 't', ctrlKey: true }), { key: 't', mod: true }),
    ).toBe(true);
  });

  test('mod:true REJECTS plain key without modifier', () => {
    expect(matchesShortcut(evt({ key: 't' }), { key: 't', mod: true })).toBe(false);
  });

  test('mod:false (default) REJECTS modified key', () => {
    expect(
      matchesShortcut(evt({ key: 't', ctrlKey: true }), { key: 't' }),
    ).toBe(false);
  });

  test('different key does not match', () => {
    expect(
      matchesShortcut(evt({ key: 'r', ctrlKey: true }), { key: 't', mod: true }),
    ).toBe(false);
  });

  test('shift requirement is enforced both ways', () => {
    expect(
      matchesShortcut(evt({ key: 't', ctrlKey: true, shiftKey: true }), {
        key: 't',
        mod: true,
      }),
    ).toBe(false);
    expect(
      matchesShortcut(evt({ key: 't', ctrlKey: true }), {
        key: 't',
        mod: true,
        shift: true,
      }),
    ).toBe(false);
    expect(
      matchesShortcut(evt({ key: 't', ctrlKey: true, shiftKey: true }), {
        key: 't',
        mod: true,
        shift: true,
      }),
    ).toBe(true);
  });

  test('alt requirement is enforced both ways', () => {
    expect(
      matchesShortcut(evt({ key: 't', ctrlKey: true, altKey: true }), {
        key: 't',
        mod: true,
      }),
    ).toBe(false);
    expect(
      matchesShortcut(evt({ key: 't', ctrlKey: true, altKey: true }), {
        key: 't',
        mod: true,
        alt: true,
      }),
    ).toBe(true);
  });

  // ctrl:true requires the literal Ctrl key on every platform — used for
  // bindings where ⌘+key would collide with an OS shortcut (e.g. ⌘+Q quits
  // the browser on macOS).
  test('ctrl:true matches Ctrl on Windows / Linux', () => {
    expect(
      matchesShortcut(evt({ key: 'q', ctrlKey: true }), { key: 'q', ctrl: true }),
    ).toBe(true);
  });

  test('ctrl:true matches Ctrl on macOS (Cmd ⌘ NOT held)', () => {
    expect(
      matchesShortcut(evt({ key: 'q', ctrlKey: true, metaKey: false }), {
        key: 'q',
        ctrl: true,
      }),
    ).toBe(true);
  });

  test('ctrl:true REJECTS ⌘ (metaKey) — Cmd+Q must NOT fire on macOS', () => {
    expect(
      matchesShortcut(evt({ key: 'q', metaKey: true }), { key: 'q', ctrl: true }),
    ).toBe(false);
  });

  test('ctrl:true REJECTS plain key without modifier', () => {
    expect(
      matchesShortcut(evt({ key: 'q' }), { key: 'q', ctrl: true }),
    ).toBe(false);
  });

  test('ctrl:true REJECTS Ctrl+Cmd combo', () => {
    expect(
      matchesShortcut(evt({ key: 'q', ctrlKey: true, metaKey: true }), {
        key: 'q',
        ctrl: true,
      }),
    ).toBe(false);
  });
});
