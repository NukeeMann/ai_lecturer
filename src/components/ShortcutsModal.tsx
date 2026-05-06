'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';

import { keyLabel, type KeyToken } from '@/lib/platform/platform';
import { useIsMacPlatform } from '@/lib/platform/useIsMacPlatform';

interface ShortcutSpec {
  keys: KeyToken[];
  label: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutSpec[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    items: [
      { keys: ['?'], label: 'Show keyboard shortcuts' },
      { keys: ['esc'], label: 'Close modal' },
    ],
  },
  {
    title: 'Lesson',
    items: [
      { keys: ['j'], label: 'Next section' },
      { keys: ['down'], label: 'Next section' },
      { keys: ['k'], label: 'Previous section' },
      { keys: ['up'], label: 'Previous section' },
      { keys: ['mod', 'B'], label: 'Toggle table of contents' },
      { keys: ['ctrl', 'Q'], label: 'Toggle AI tutor' },
      { keys: ['space'], label: 'Mark current section complete' },
      { keys: ['n'], label: 'Next lesson (when current is complete)' },
      { keys: ['p'], label: 'Previous lesson' },
      { keys: ['f'], label: 'Focus mode (collapse panels)' },
    ],
  },
  {
    title: 'Code editor',
    items: [
      { keys: ['mod', 'enter'], label: 'Run code' },
      { keys: ['tab'], label: 'Indent' },
      { keys: ['shift', 'tab'], label: 'Outdent' },
    ],
  },
  {
    title: 'Chat composer',
    items: [
      { keys: ['enter'], label: 'Send message' },
      { keys: ['shift', 'enter'], label: 'New line' },
    ],
  },
];

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: '12vh',
  paddingLeft: 16,
  paddingRight: 16,
  zIndex: 1000,
};

const dialogStyle: CSSProperties = {
  width: '100%',
  maxWidth: 520,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-xl)',
  boxShadow: 'var(--shadow-lg)',
  color: 'var(--text)',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '76vh',
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid var(--border)',
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-md)',
  fontWeight: 600,
  letterSpacing: '-0.005em',
  color: 'var(--text)',
};

const closeBtnStyle: CSSProperties = {
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
};

const bodyStyle: CSSProperties = {
  padding: '12px 20px 20px',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};

const groupTitleStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
  color: 'var(--text-tertiary)',
  margin: '0 0 6px',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 0',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  gap: 12,
};

const keysWrapStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
};

const kbdStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  lineHeight: 1,
  color: 'var(--text-secondary)',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '3px 6px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 18,
};

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  const isMac = useIsMacPlatform();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="shortcuts-backdrop"
      role="presentation"
      onClick={onClose}
      style={backdropStyle}
    >
      <div
        data-testid="shortcuts-modal"
        data-platform={isMac ? 'mac' : 'non-mac'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={dialogStyle}
      >
        <header style={headerStyle}>
          <h2 id="shortcuts-modal-title" style={titleStyle}>
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            data-testid="shortcuts-close"
            aria-label="Close shortcuts"
            onClick={onClose}
            style={closeBtnStyle}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </header>
        <div style={bodyStyle}>
          {GROUPS.map((group) => (
            <Group
              key={group.title}
              title={group.title}
              items={group.items}
              isMac={isMac}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Group({
  title,
  items,
  isMac,
}: {
  title: string;
  items: ShortcutSpec[];
  isMac: boolean;
}) {
  return (
    <section data-testid="shortcuts-group" data-group={title}>
      <h3 style={groupTitleStyle}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((item, i) => (
          <Row
            key={`${item.label}-${i}`}
            keys={item.keys}
            label={item.label}
            isMac={isMac}
          />
        ))}
      </div>
    </section>
  );
}

function Row({
  keys,
  label,
  isMac,
}: {
  keys: KeyToken[];
  label: string;
  isMac: boolean;
}) {
  return (
    <div data-testid="shortcuts-row" style={rowStyle}>
      <span>{label}</span>
      <span style={keysWrapStyle}>
        {keys.map((k, i) => (
          <Kbd key={i}>{keyLabel(k, isMac)}</Kbd>
        ))}
      </span>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <span data-testid="kbd" style={kbdStyle}>
      {children}
    </span>
  );
}
