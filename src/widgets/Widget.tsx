import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { widgetRegistry, type WidgetType } from './registry';

export type WidgetStatus = 'todo' | 'progress' | 'done';

export interface WidgetCheckboxProps {
  /**
   * Whether the widget currently reports a Complete state (e.g. quiz answered
   * correctly, code passed tests, drag-match solved). The wrapper subscribes to
   * this and auto-checks the checkbox when it flips true.
   */
  completed: boolean;
  /** Called when the user explicitly toggles the checkbox. */
  onToggle: (next: boolean) => void;
  testId?: string;
  ariaLabel?: { checked: string; unchecked: string };
  title?: { checked: string; unchecked: string };
}

export interface WidgetProps {
  type: WidgetType;
  sectionNumber: number;
  title: string;
  description?: string;
  status: WidgetStatus;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  /** Optional completion checkbox rendered in the header. */
  checkbox?: WidgetCheckboxProps;
}

export function resolveCheckboxChecked(opts: {
  userOverride: boolean | null;
  completed: boolean;
}): boolean {
  return opts.userOverride !== null ? opts.userOverride : opts.completed;
}

// Recency rule: any flip of `completed` clears a prior user override so the
// fresh auto-state takes over (= the more recent signal wins).
export function applyCompletedTransition(
  prevOverride: boolean | null,
  prevCompleted: boolean,
  nextCompleted: boolean,
): boolean | null {
  return prevCompleted !== nextCompleted ? null : prevOverride;
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

function CompletionCheckbox({
  completed,
  onToggle,
  testId,
  ariaLabel,
  title,
}: WidgetCheckboxProps) {
  const [userOverride, setUserOverride] = useState<boolean | null>(null);
  const prevCompletedRef = useRef(completed);

  useEffect(() => {
    if (prevCompletedRef.current !== completed) {
      prevCompletedRef.current = completed;
      setUserOverride(null);
    }
  }, [completed]);

  const checked = resolveCheckboxChecked({ userOverride, completed });
  const titleText = checked
    ? title?.checked ?? 'Unmark as completed'
    : title?.unchecked ?? 'Mark as completed';
  const aria = checked
    ? ariaLabel?.checked ?? 'Mark as not completed'
    : ariaLabel?.unchecked ?? 'Mark as completed';

  return (
    <label
      data-section-complete-checkbox
      data-checked={checked ? 'true' : 'false'}
      title={titleText}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <input
        type="checkbox"
        data-testid={testId}
        aria-label={aria}
        checked={checked}
        onChange={(e) => {
          const next = e.currentTarget.checked;
          setUserOverride(next);
          onToggle(next);
        }}
        style={{
          width: 16,
          height: 16,
          margin: 0,
          cursor: 'pointer',
          accentColor: 'var(--success)',
        }}
      />
    </label>
  );
}

export function Widget({
  type,
  sectionNumber,
  title,
  description,
  status,
  children,
  footer,
  headerActions,
  checkbox,
}: WidgetProps) {
  const hasDescription =
    typeof description === 'string' && description.trim().length > 0;
  const meta = widgetRegistry[type];
  const accent = `var(${meta.accentVar})`;
  const Icon = meta.icon;
  const hasHeaderActions = headerActions !== undefined || checkbox !== undefined;

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
        {hasHeaderActions && (
          <div
            data-widget-header-actions
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            {headerActions}
            {checkbox !== undefined && <CompletionCheckbox {...checkbox} />}
          </div>
        )}
        <StatusBadge status={status} />
      </header>
      {hasDescription && (
        <p
          data-widget-description
          style={{
            margin: 0,
            padding: 'var(--space-3) var(--space-5)',
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}
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
