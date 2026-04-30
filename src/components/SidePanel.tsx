'use client';

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface SidePanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}

const SIDE_PANEL_WIDTH = 320;

const overlayStyle = (open: boolean): CSSProperties => ({
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: SIDE_PANEL_WIDTH,
  background: 'var(--bg-elevated)',
  borderLeft: '1px solid var(--border)',
  boxShadow: 'var(--shadow-lg)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 60,
  transform: open ? 'translateX(0)' : 'translateX(100%)',
  transition: 'transform 200ms ease',
  pointerEvents: open ? 'auto' : 'none',
});

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  padding: 'var(--space-4) var(--space-5)',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  flexShrink: 0,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-md)',
  fontWeight: 600,
  color: 'var(--text)',
  lineHeight: 1.2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const closeButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  flexShrink: 0,
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
};

export function SidePanel({ open, title, onClose, children, testId }: SidePanelProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <aside
      data-testid={testId ?? 'side-panel'}
      data-open={open ? 'true' : 'false'}
      aria-hidden={!open}
      style={overlayStyle(open)}
    >
      <header style={headerStyle}>
        <h2 style={titleStyle}>{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          data-testid="side-panel-close"
          style={closeButtonStyle}
        >
          <X size={14} aria-hidden />
        </button>
      </header>
      <div data-testid="side-panel-body" style={bodyStyle}>
        {children}
      </div>
    </aside>
  );
}
