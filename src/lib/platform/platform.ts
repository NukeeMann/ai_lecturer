/**
 * Platform-aware keyboard modifier rendering.
 *
 * `isMod` in `useKeyboardShortcuts` already accepts BOTH `metaKey` and
 * `ctrlKey`, so a single `Mod-X` binding fires for ⌘+X on macOS AND Ctrl+X on
 * Windows/Linux. The bug US-059 fixes is purely on the display side: the
 * shortcuts modal and the inline `⌘.` glyph on the toolbar tutor button were
 * hard-coded to macOS glyphs, so a Windows/Linux learner saw symbols that did
 * not match their physical keyboard.
 *
 * This module exposes:
 *  - `isMacPlatform(userAgent?)` — pure detection used by both runtime + tests
 *  - `KeyToken` — semantic tokens like `'mod'|'alt'|'shift'` used in shortcut
 *    descriptors so callers stay platform-agnostic
 *  - `keyLabel(token, isMac)` — translates a token (or literal) to its glyph
 *    on macOS or its word on Windows/Linux
 */

export type KeyToken =
  | 'mod' // ⌘ on macOS, Ctrl elsewhere
  | 'alt' // ⌥ on macOS, Alt elsewhere
  | 'shift' // ⇧ on macOS, Shift elsewhere
  | 'ctrl' // ⌃ on macOS, Ctrl elsewhere
  | 'enter' // ↵ on both
  | 'tab'
  | 'space'
  | 'esc'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | (string & {}); // any literal like 'B', '.', '?' falls through

const MAC_UA_REGEX = /Mac|iPhone|iPad|iPod/i;

export function isMacPlatform(userAgent?: string): boolean {
  const ua =
    userAgent ??
    (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : '');
  if (!ua) return false;
  return MAC_UA_REGEX.test(ua);
}

const MAC_LABELS: Record<string, string> = {
  mod: '⌘', // ⌘
  alt: '⌥', // ⌥
  shift: '⇧', // ⇧
  ctrl: '⌃', // ⌃
  enter: '↵', // ↵
  tab: 'Tab',
  space: 'Space',
  esc: 'Esc',
  up: '↑', // ↑
  down: '↓', // ↓
  left: '←', // ←
  right: '→', // →
};

const NON_MAC_LABELS: Record<string, string> = {
  mod: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  ctrl: 'Ctrl',
  enter: '↵', // ↵ — universal Enter glyph, kept on both platforms
  tab: 'Tab',
  space: 'Space',
  esc: 'Esc',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

/**
 * Translate a `KeyToken` (or a literal like `'B'`, `'.'`, `'?'`) into the
 * label that should appear in a `<kbd>` for the given platform.
 * Unknown tokens fall through verbatim — keeps the call sites concise.
 */
export function keyLabel(token: KeyToken, isMac: boolean): string {
  const table = isMac ? MAC_LABELS : NON_MAC_LABELS;
  return table[token] ?? token;
}

/**
 * Convenience: translate the primary modifier as a single label, used by
 * inline hints like the chat composer's `⌘+Enter to send` / `Ctrl+Enter to
 * send` and the toolbar tutor button's `⌘.` / `Ctrl+.`.
 */
export function modLabel(isMac: boolean): string {
  return isMac ? '⌘' : 'Ctrl';
}
