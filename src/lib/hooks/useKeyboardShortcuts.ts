'use client';

import { useEffect, useRef } from 'react';

export interface KeyboardShortcut {
  /** Predicate over the raw KeyboardEvent. Return true to invoke `handler`. */
  match: (e: KeyboardEvent) => boolean;
  handler: (e: KeyboardEvent) => void;
  /** Defaults to true. Set false to let the browser see the key. */
  preventDefault?: boolean;
}

/**
 * Returns true when keyboard input should NOT trigger app shortcuts —
 * the user is typing into a real text surface (form input, contenteditable,
 * or a CodeMirror editor).
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target.closest('.cm-editor') || target.closest('.cm-content')) return true;
  return false;
}

/**
 * Window-scoped keydown listener that ignores keys typed into inputs,
 * textareas, contenteditable surfaces, and CodeMirror editors.
 *
 * Pass an array of `{ match, handler }` shortcut specs. The first match wins.
 * The shortcuts array does NOT need a stable identity — the latest array is
 * read on every keypress via a ref, so closures inside `match`/`handler`
 * always see fresh state.
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]): void {
  const ref = useRef(shortcuts);
  useEffect(() => {
    ref.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      for (const sc of ref.current) {
        if (sc.match(e)) {
          if (sc.preventDefault !== false) e.preventDefault();
          sc.handler(e);
          return;
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/**
 * `true` when the OS-level "primary modifier" is held — ⌘ on macOS, Ctrl
 * elsewhere. The runtime can't tell the platform from a KeyboardEvent alone,
 * so we accept either.
 */
export function isMod(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

/**
 * Honour `(prefers-reduced-motion: reduce)` for keyboard-triggered scroll.
 * Falls back to 'smooth' when the user has not opted out.
 */
export function preferredScrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined') return 'smooth';
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
  } catch {
    return 'smooth';
  }
}
