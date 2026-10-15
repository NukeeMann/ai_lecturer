'use client';

// Small shared controls for the EEG widgets' toolbars and feedback panels,
// styled with the app's design tokens (theme-aware, compact, wrap on phones).

import type { ButtonHTMLAttributes, CSSProperties, ReactNode, SelectHTMLAttributes } from 'react';

export const eegWidgetBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  padding: 'var(--space-4)',
  minWidth: 0,
};

export const eegToolbarStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
};

export const eegMutedTextStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-tertiary)',
  fontVariantNumeric: 'tabular-nums',
};

const controlBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 30,
  padding: '0 8px',
  borderRadius: 'var(--radius-md)',
  // Longhands only: buttons override borderColor when active/primary, and
  // React warns when a shorthand and its longhand are mixed across renders.
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-xs)',
  fontFamily: 'inherit',
  lineHeight: 1,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

export interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Toggle buttons: pressed state (aria-pressed + accent styling). */
  active?: boolean;
  /** Visually emphasised primary action (Check / Submit). */
  primary?: boolean;
  children: ReactNode;
}

export function ToolButton({ active, primary, children, style, disabled, ...rest }: ToolButtonProps) {
  const s: CSSProperties = {
    ...controlBase,
    ...(active ? { borderColor: 'var(--accent-border)', background: 'var(--accent-subtle)', color: 'var(--accent-text)' } : null),
    ...(primary ? { borderColor: 'var(--accent)', background: 'var(--accent)', color: 'var(--text-on-accent)', fontWeight: 600 } : null),
    ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : null),
    ...style,
  };
  return (
    <button type="button" aria-pressed={active === undefined ? undefined : active} disabled={disabled} style={s} {...rest}>
      {children}
    </button>
  );
}

export interface ToolSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  /** Visible short label (also the accessible name). */
  label: string;
  options: readonly { value: string; label: string }[];
}

export function ToolSelect({ label, options, style, ...rest }: ToolSelectProps) {
  return (
    <label style={{ ...controlBase, cursor: 'default', paddingRight: 4 }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <select
        aria-label={label}
        style={{
          border: 'none',
          background: 'transparent',
          color: 'var(--text)',
          fontSize: 'var(--fs-xs)',
          fontFamily: 'inherit',
          padding: '0 2px',
          cursor: 'pointer',
          maxWidth: 170,
          ...style,
        }}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export type FeedbackTone = 'success' | 'warning' | 'danger' | 'neutral';

export function FeedbackPanel({ tone, title, children }: { tone: FeedbackTone; title?: ReactNode; children?: ReactNode }) {
  const palette: Record<FeedbackTone, [string, string, string]> = {
    success: ['var(--success-border)', 'var(--success-subtle)', 'var(--success)'],
    warning: ['var(--warning-border)', 'var(--warning-subtle)', 'var(--warning)'],
    danger: ['var(--danger-border)', 'var(--danger-subtle)', 'var(--danger)'],
    neutral: ['var(--border)', 'var(--bg-subtle)', 'var(--text)'],
  };
  const [border, bg, fg] = palette[tone];
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        border: `1px solid ${border}`,
        background: bg,
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3) var(--space-4)',
        fontSize: 'var(--fs-sm)',
        color: 'var(--text)',
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      {title ? <div style={{ fontWeight: 600, color: fg, marginBottom: children ? 'var(--space-2)' : 0 }}>{title}</div> : null}
      {/* Block container: MarkdownInline renders inline fragments, which must
          flow as text — never make them flex items. */}
      {children ? <div style={{ lineHeight: 1.55 }}>{children}</div> : null}
    </div>
  );
}

/** Thin vertical separator between toolbar groups (hidden when the row wraps awkwardly is fine). */
export function ToolSeparator() {
  return <span aria-hidden style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />;
}
