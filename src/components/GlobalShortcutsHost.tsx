'use client';

import { useCallback, useEffect, useState } from 'react';

import { ShortcutsModal } from '@/components/ShortcutsModal';
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts';

export const SHORTCUTS_OPEN_EVENT = 'shortcuts:open';

/**
 * Mount once at the app root. Listens for the '?' key (and a custom
 * `shortcuts:open` window event from in-app toolbar buttons) to surface
 * the shortcuts modal, and renders the modal.
 */
export function GlobalShortcutsHost() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useKeyboardShortcuts([
    {
      match: (e) => e.key === '?',
      handler: () => setOpen(true),
    },
  ]);

  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener(SHORTCUTS_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SHORTCUTS_OPEN_EVENT, onOpen);
  }, []);

  return <ShortcutsModal open={open} onClose={close} />;
}

/** Programmatic open — used by toolbar buttons. */
export function openShortcutsModal(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SHORTCUTS_OPEN_EVENT));
}
