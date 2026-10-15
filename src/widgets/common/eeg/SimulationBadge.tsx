'use client';

// Mandatory badge on every synthetic trace (user requirement): never show a
// simulated signal without it. A button so touch users can reveal the
// explanation (native `title` tooltips do not show on touch screens).

import { useState, type CSSProperties } from 'react';
import { FlaskConical } from 'lucide-react';

export const SIMULATION_LABEL_DEFAULT = 'SYMULACJA';
export const SIMULATION_TOOLTIP = 'Synthetic signal for demonstrating a mechanism — not a real recording';

export interface SimulationBadgeProps {
  /** Badge text (default "SYMULACJA"; widgets pass `data.simulationLabel`). */
  label?: string;
  /** `inline` for toolbars; `overlay` pins it to the top-right of a relative container. */
  variant?: 'inline' | 'overlay';
  style?: CSSProperties;
}

export function SimulationBadge({ label, variant = 'inline', style }: SimulationBadgeProps) {
  const [open, setOpen] = useState(false);
  const text = label && label.trim() ? label.trim() : SIMULATION_LABEL_DEFAULT;
  const overlay = variant === 'overlay';
  return (
    <span
      data-eeg-simulation-badge=""
      style={{
        position: overlay ? 'absolute' : 'relative',
        top: overlay ? 6 : undefined,
        right: overlay ? 6 : undefined,
        zIndex: overlay ? 2 : undefined,
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: overlay ? 'flex-end' : 'flex-start',
        gap: 4,
        maxWidth: overlay ? 'min(260px, calc(100% - 12px))' : '100%',
        pointerEvents: 'auto',
        ...style,
      }}
    >
      <button
        type="button"
        title={SIMULATION_TOOLTIP}
        aria-label={`${text}: ${SIMULATION_TOOLTIP}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 'var(--radius-full)',
          border: '1px solid var(--warning-border)',
          background: 'var(--warning-subtle)',
          color: 'var(--warning)',
          fontSize: 'var(--fs-xs)',
          fontWeight: 700,
          letterSpacing: '0.06em',
          lineHeight: 1.6,
          cursor: 'help',
          whiteSpace: 'nowrap',
          boxShadow: overlay ? 'var(--shadow-xs)' : undefined,
        }}
      >
        <FlaskConical size={12} aria-hidden />
        {text}
      </button>
      {open ? (
        <span
          role="note"
          style={{
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--warning-border)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            fontSize: 'var(--fs-xs)',
            lineHeight: 1.4,
            boxShadow: 'var(--shadow-sm)',
            overflowWrap: 'anywhere',
          }}
        >
          {SIMULATION_TOOLTIP}
        </span>
      ) : null}
    </span>
  );
}

export default SimulationBadge;
