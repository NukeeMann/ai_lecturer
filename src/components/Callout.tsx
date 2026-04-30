import type { ComponentType, CSSProperties, ReactNode } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  Lightbulb,
  type LucideProps,
} from 'lucide-react';

export type CalloutTone = 'info' | 'insight' | 'warning' | 'danger';

interface ToneSpec {
  bg: string;
  border: string;
  color: string;
  Icon: ComponentType<LucideProps>;
}

const toneMap: Record<CalloutTone, ToneSpec> = {
  info: {
    bg: 'var(--info-subtle)',
    border: 'var(--info-border)',
    color: 'var(--info)',
    Icon: Info,
  },
  insight: {
    bg: 'var(--insight-subtle)',
    border: 'var(--insight-border)',
    color: 'var(--insight)',
    Icon: Lightbulb,
  },
  warning: {
    bg: 'var(--warning-subtle)',
    border: 'var(--warning-border)',
    color: 'var(--warning)',
    Icon: AlertTriangle,
  },
  danger: {
    bg: 'var(--danger-subtle)',
    border: 'var(--danger-border)',
    color: 'var(--danger)',
    Icon: AlertOctagon,
  },
};

export interface CalloutProps {
  tone?: CalloutTone;
  title?: string;
  children?: ReactNode;
}

const wrapStyle = (spec: ToneSpec): CSSProperties => ({
  background: spec.bg,
  border: `1px solid ${spec.border}`,
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4) var(--space-5)',
  display: 'flex',
  gap: 'var(--space-3)',
  margin: 'var(--space-4) 0',
});

const iconStyle = (spec: ToneSpec): CSSProperties => ({
  color: spec.color,
  flexShrink: 0,
  marginTop: 2,
  lineHeight: 0,
});

const titleStyle = (spec: ToneSpec): CSSProperties => ({
  fontWeight: 600,
  color: spec.color,
  marginBottom: 4,
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.35,
});

const bodyStyle: CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.65,
};

export function Callout({ tone = 'info', title, children }: CalloutProps) {
  const spec = toneMap[tone];
  const Icon = spec.Icon;
  return (
    <aside data-callout-tone={tone} style={wrapStyle(spec)}>
      <div style={iconStyle(spec)}>
        <Icon size={16} aria-hidden />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? <div style={titleStyle(spec)}>{title}</div> : null}
        <div style={bodyStyle}>{children}</div>
      </div>
    </aside>
  );
}
