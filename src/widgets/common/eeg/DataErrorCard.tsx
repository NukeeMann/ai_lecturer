'use client';

// Readable error card for invalid widget data / failed loads — widgets
// render this instead of crashing (spec §0 "self-parsing").

import type { CSSProperties } from 'react';
import { AlertTriangle } from 'lucide-react';

import { describeDataError } from './dataError';

export interface DataErrorCardProps {
  /** e.g. "This EEG viewer's data is invalid". */
  title: string;
  /** ZodError, Error, or string. */
  error: unknown;
  style?: CSSProperties;
}

export function DataErrorCard({ title, error, style }: DataErrorCardProps) {
  const lines = describeDataError(error);
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--danger-border)',
        background: 'var(--danger-subtle)',
        color: 'var(--text)',
        fontSize: 'var(--fs-sm)',
        minWidth: 0,
        ...style,
      }}
    >
      <AlertTriangle size={16} aria-hidden style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', overflowWrap: 'anywhere' }}>
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default DataErrorCard;
