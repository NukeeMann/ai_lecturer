'use client';

import Link from 'next/link';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

// Avoids the React SSR warning for `useLayoutEffect`. We need the layout
// effect on the client so the label-fits measurement runs before paint
// (otherwise the label briefly renders at natural width and overlaps the
// breadcrumb when space is tight).
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const wrapBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  flexShrink: 0,
  color: 'var(--text)',
  textDecoration: 'none',
  cursor: 'pointer',
  transition: 'opacity var(--t-fast)',
};

const LOGO_PX = 28;

const logoImgStyle: CSSProperties = {
  display: 'block',
  width: LOGO_PX,
  height: LOGO_PX,
  borderRadius: 'var(--radius-md)',
  flexShrink: 0,
};

const nameStyle: CSSProperties = {
  fontSize: 'var(--fs-md)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  whiteSpace: 'nowrap',
};

const ghostStyle: CSSProperties = {
  ...nameStyle,
  position: 'absolute',
  visibility: 'hidden',
  pointerEvents: 'none',
  left: -9999,
  top: -9999,
};

const ICON_PLUS_GAP_PX = 28 + 10;

export function AppLogoMark({ size = LOGO_PX }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      style={{
        display: 'block',
        width: size,
        height: size,
        borderRadius: 'var(--radius-md)',
        flexShrink: 0,
      }}
      aria-hidden
    />
  );
}

export function AppLogoLink({
  collapseLabelOnNarrow = false,
  maxWidth,
}: {
  collapseLabelOnNarrow?: boolean;
  maxWidth?: number;
}) {
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const ghostRef = useRef<HTMLSpanElement | null>(null);
  // Start hidden; the layout effect below flips this on if the label fits.
  // Hiding by default ensures the first paint never shows an overlapping
  // label even before measurement has run.
  const [fits, setFits] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const link = linkRef.current;
    const ghost = ghostRef.current;
    if (!link || !ghost) return;
    const parent = link.parentElement;
    if (!parent) return;

    const compute = () => {
      let siblingsWidth = 0;
      for (const child of Array.from(parent.children)) {
        if (child === link) continue;
        if (!(child instanceof HTMLElement)) continue;
        const cs = window.getComputedStyle(child);
        const grow = parseFloat(cs.flexGrow || '0');
        if (grow > 0) continue;
        siblingsWidth += child.offsetWidth;
      }
      const available = parent.clientWidth - siblingsWidth;
      const required = ICON_PLUS_GAP_PX + ghost.offsetWidth;
      setFits(required <= available);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(parent);
    return () => {
      ro.disconnect();
    };
  }, []);

  return (
    <Link
      ref={linkRef}
      href="/"
      data-testid="app-logo-link"
      data-collapse-narrow={collapseLabelOnNarrow ? '' : undefined}
      className="app-logo-link"
      aria-label="AI Lecturer — back to dashboard"
      style={{ ...wrapBase, maxWidth }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt=""
        width={LOGO_PX}
        height={LOGO_PX}
        style={logoImgStyle}
        aria-hidden
      />
      {fits && (
        <span className="app-logo-label" style={nameStyle}>
          AI Lecturer
        </span>
      )}
      <span ref={ghostRef} aria-hidden style={ghostStyle}>
        AI Lecturer
      </span>
    </Link>
  );
}
