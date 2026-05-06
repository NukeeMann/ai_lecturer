'use client';

import { useEffect, useRef } from 'react';

export interface KeyboardShortcutSpec {
  /** Required key (case-insensitive). Compared against KeyboardEvent.key. */
  key: string;
  /** Require the cross-platform primary modifier (⌘ on macOS, Ctrl elsewhere). */
  mod?: boolean;
  /**
   * Require the literal Ctrl key (NOT ⌘) on every platform. Use this for
   * bindings where ⌘+key would collide with an OS shortcut — notably ⌘+Q,
   * which quits the browser on macOS. When true, `mod` is ignored.
   */
  ctrl?: boolean;
  /** Require Shift. */
  shift?: boolean;
  /** Require Alt / Option. */
  alt?: boolean;
}

export interface UseKeyboardShortcutOptions extends KeyboardShortcutSpec {
  /** Skip registering the listener entirely. */
  enabled?: boolean;
  /** Default true: call preventDefault() so browser shortcuts (e.g. Ctrl+T new tab) don't fire. */
  preventDefault?: boolean;
  /** Default true: call stopPropagation() so other listeners don't double-handle. */
  stopPropagation?: boolean;
}

/**
 * True when the event target is a form input, contenteditable surface, or
 * CodeMirror editor — i.e. the user is typing and shortcut should not fire.
 */
export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target.closest('.cm-editor') || target.closest('.cm-content')) return true;
  return false;
}

/** Pure matcher used by `useKeyboardShortcut`; exported for unit testing. */
export function matchesShortcut(
  e: KeyboardEvent,
  spec: KeyboardShortcutSpec,
): boolean {
  if (e.key.toLowerCase() !== spec.key.toLowerCase()) return false;
  if (spec.ctrl === true) {
    if (!e.ctrlKey) return false;
    if (e.metaKey) return false;
  } else {
    const wantMod = spec.mod === true;
    const hasMod = Boolean(e.metaKey || e.ctrlKey);
    if (wantMod !== hasMod) return false;
  }
  if ((spec.shift === true) !== Boolean(e.shiftKey)) return false;
  if ((spec.alt === true) !== Boolean(e.altKey)) return false;
  return true;
}

/**
 * Single-shortcut window-scoped keydown listener.
 *
 * Designed for the common case "one component owns one binding" — components
 * that need many bindings should reach for `useKeyboardShortcuts` instead.
 *
 * Skips firing while the user is typing in an editable surface, and by default
 * calls preventDefault + stopPropagation so the binding wins over the browser
 * (e.g. Ctrl+T → new tab) and over any outer global listener.
 *
 * The handler can be inline / unstable — it's read via a ref each fire, so the
 * effect doesn't re-bind on every render.
 *
 * Browser caveat: some platform-level shortcuts cannot be prevented by web
 * pages — notably Cmd+T on macOS Safari, where the browser captures the
 * combo before the page sees it. Chrome and Firefox honour preventDefault on
 * Ctrl+T / Cmd+T as of recent versions.
 */
export function useKeyboardShortcut(
  options: UseKeyboardShortcutOptions,
  handler: (e: KeyboardEvent) => void,
): void {
  const {
    key,
    mod = false,
    ctrl = false,
    shift = false,
    alt = false,
    enabled = true,
    preventDefault = true,
    stopPropagation = true,
  } = options;

  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!matchesShortcut(e, { key, mod, ctrl, shift, alt })) return;
      if (isEditableShortcutTarget(e.target)) return;
      if (preventDefault) e.preventDefault();
      if (stopPropagation) e.stopPropagation();
      handlerRef.current(e);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key, mod, ctrl, shift, alt, enabled, preventDefault, stopPropagation]);
}
