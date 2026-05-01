'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';

const wrapBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
  color: 'var(--text)',
  textDecoration: 'none',
  cursor: 'pointer',
  transition: 'opacity var(--t-fast)',
};

const boxStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 'var(--radius-md)',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const nameStyle: CSSProperties = {
  fontSize: 'var(--fs-md)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export function AppLogoMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 4h6M2 8h12M2 12h8" />
    </svg>
  );
}

export function AppLogoLink({
  collapseLabelOnNarrow = false,
  maxWidth,
}: {
  collapseLabelOnNarrow?: boolean;
  maxWidth?: number;
}) {
  return (
    <Link
      href="/"
      data-testid="app-logo-link"
      data-collapse-narrow={collapseLabelOnNarrow ? '' : undefined}
      className="app-logo-link"
      aria-label="AI Lecturer — back to dashboard"
      style={{ ...wrapBase, maxWidth }}
    >
      <span style={boxStyle} aria-hidden>
        <AppLogoMark />
      </span>
      <span className="app-logo-label" style={nameStyle}>
        AI Lecturer
      </span>
    </Link>
  );
}
