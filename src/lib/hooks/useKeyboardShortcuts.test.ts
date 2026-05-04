import { describe, expect, test } from 'vitest';

import { isMod } from './useKeyboardShortcuts';

/**
 * `isMod` is the cross-platform "primary modifier" predicate. macOS users
 * press ⌘ (`metaKey`); Windows / Linux users press Ctrl (`ctrlKey`). The
 * KeyboardEvent itself doesn't reveal the platform, so the only correct
 * implementation is to accept either flag — that's what makes US-059's
 * `Mod-B` / `Mod-.` shortcuts fire on Windows + Linux too.
 */

function evt(init: { metaKey?: boolean; ctrlKey?: boolean }): KeyboardEvent {
  // Casting through `unknown` because vitest runs in node env (no DOM types
  // backing `KeyboardEventInit`). `isMod` only reads metaKey + ctrlKey.
  return init as unknown as KeyboardEvent;
}

describe('isMod', () => {
  test('returns true when metaKey is held (macOS ⌘)', () => {
    expect(isMod(evt({ metaKey: true }))).toBe(true);
  });

  // Bug repro for US-059: pre-fix code that checked only `e.metaKey` would
  // FAIL this assertion — Windows/Linux users press Ctrl, not Cmd, so a
  // Cmd-only handler never fires for them.
  test('returns true when ctrlKey is held (Windows / Linux Ctrl)', () => {
    expect(isMod(evt({ ctrlKey: true }))).toBe(true);
  });

  test('returns false when no modifier is held', () => {
    expect(isMod(evt({ metaKey: false, ctrlKey: false }))).toBe(false);
  });

  test('returns true when both modifiers are held (rare, but valid)', () => {
    expect(isMod(evt({ metaKey: true, ctrlKey: true }))).toBe(true);
  });
});
