'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Link from 'next/link';

const buttonStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  background: 'var(--accent-subtle)',
  color: 'var(--accent-text)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  fontFamily: 'inherit',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
};

const wrapStyle: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
};

const menuStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  minWidth: 180,
  maxWidth: 'calc(100vw - var(--space-4))',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-md)',
  padding: 'var(--space-2)',
  zIndex: 100,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const itemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 10px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  textDecoration: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const VIEWPORT_PADDING = 8;

export function AvatarMenu({ initial = 'U' }: { initial?: string }) {
  const [open, setOpen] = useState(false);
  const [shiftX, setShiftX] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShiftX(0);
      return;
    }
    const menu = menuRef.current;
    if (!menu) return;
    // Measure the un-shifted rect (the transform applies to the same node, so
    // temporarily clear it to read the natural position, then re-apply).
    const prev = menu.style.transform;
    menu.style.transform = '';
    const rect = menu.getBoundingClientRect();
    menu.style.transform = prev;
    const vw = window.innerWidth;
    let dx = 0;
    if (rect.right > vw - VIEWPORT_PADDING) {
      dx = vw - VIEWPORT_PADDING - rect.right;
    }
    if (rect.left + dx < VIEWPORT_PADDING) {
      dx = VIEWPORT_PADDING - rect.left;
    }
    setShiftX(dx);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (wrapRef.current && !wrapRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={wrapStyle} data-testid="avatar-menu">
      <button
        ref={buttonRef}
        type="button"
        data-testid="avatar-menu-button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        style={buttonStyle}
      >
        {initial}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          data-testid="avatar-menu-dropdown"
          aria-label="Account"
          className="avatar-menu-dropdown"
          style={{ ...menuStyle, transform: shiftX ? `translateX(${shiftX}px)` : undefined }}
        >
          <Link
            href="/"
            role="menuitem"
            data-testid="avatar-menu-my-courses"
            className="avatar-menu-item"
            style={itemStyle}
            onClick={close}
          >
            My courses
          </Link>
        </div>
      )}
    </div>
  );
}
