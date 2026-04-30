import type { CSSProperties, ReactNode } from 'react';
import { widgetRegistry, type WidgetType } from './registry';

export type WidgetStatus = 'todo' | 'progress' | 'done';

export interface WidgetProps {
  type: WidgetType;
  sectionNumber: number;
  title: string;
  status: WidgetStatus;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
}

const containerStyle: CSSProperties = {
  position: 'relative',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-xs)',
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: 'var(--space-4) var(--space-5)',
  background: 'var(--bg-elevated)',
  borderBottom: '1px solid var(--border)',
};

const iconWrapStyle = (accent: string): CSSProperties => ({
  width: 28,
  height: 28,
  borderRadius: 'var(--radius-full)',
  background: 'var(--bg-subtle)',
  color: accent,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
});

const eyebrowStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  lineHeight: 1.2,
};

const titleStyle: CSSProperties = {
  margin: '2px 0 0',
  fontSize: 'var(--fs-md)',
  fontWeight: 600,
  color: 'var(--text)',
  lineHeight: 1.25,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const badgeBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 18,
  padding: '2px 7px',
  borderRadius: 'var(--radius-full)',
  fontSize: '10.5px',
  fontWeight: 500,
  letterSpacing: '0.01em',
  whiteSpace: 'nowrap',
};

const dotStyle: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: 'currentColor',
};

function StatusBadge({ status }: { status: WidgetStatus }) {
  if (status === 'done') {
    return (
      <span
        data-status="done"
        style={{
          ...badgeBaseStyle,
          background: 'var(--success-subtle)',
          color: 'var(--success)',
          border: '1px solid var(--success-border)',
        }}
      >
        <span style={dotStyle} />
        Completed
      </span>
    );
  }
  if (status === 'progress') {
    return (
      <span
        data-status="progress"
        style={{
          ...badgeBaseStyle,
          background: 'var(--accent-subtle)',
          color: 'var(--accent-text)',
          border: '1px solid var(--accent-border)',
        }}
      >
        <span style={dotStyle} />
        In progress
      </span>
    );
  }
  return null;
}

export function Widget({
  type,
  sectionNumber,
  title,
  status,
  children,
  footer,
  headerActions,
}: WidgetProps) {
  const meta = widgetRegistry[type];
  const accent = `var(${meta.accentVar})`;
  const Icon = meta.icon;

  return (
    <section data-widget-type={type} style={containerStyle}>
      <div
        data-widget-rail
        aria-hidden
        style={{
          height: 1,
          background: accent,
        }}
      />
      <header style={headerStyle}>
        <div style={iconWrapStyle(accent)}>
          <Icon size={14} aria-hidden />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <div style={eyebrowStyle}>
            {meta.label.toUpperCase()} · §{sectionNumber}
          </div>
          <h3 style={titleStyle}>{title}</h3>
        </div>
        {headerActions !== undefined && (
          <div
            data-widget-header-actions
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            {headerActions}
          </div>
        )}
        <StatusBadge status={status} />
      </header>
      <div data-widget-body>{children}</div>
      {footer !== undefined && (
        <div
          data-widget-footer
          style={{
            borderTop: '1px solid var(--border)',
          }}
        >
          {footer}
        </div>
      )}
    </section>
  );
}
