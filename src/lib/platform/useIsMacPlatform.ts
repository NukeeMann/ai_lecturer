'use client';

import { useEffect, useState } from 'react';

import { isMacPlatform } from './platform';

/**
 * Hook for detecting macOS vs Windows/Linux on the client.
 *
 * Returns `false` for the first render (SSR + initial hydration) so server
 * and client output match — then flips to `true` after `useEffect` has
 * inspected `navigator.userAgent`. Non-mac users are by far the majority,
 * so defaulting to non-mac means most users never see a flash of incorrect
 * glyphs.
 */
export function useIsMacPlatform(): boolean {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    // One-shot platform detection — runs once on mount to swap the SSR-safe
    // default (false) to the real value derived from navigator.userAgent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMac(isMacPlatform());
  }, []);
  return isMac;
}
