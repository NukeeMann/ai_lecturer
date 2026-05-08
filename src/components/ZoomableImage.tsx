'use client';

import type { CSSProperties, ImgHTMLAttributes, MouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface ZoomableImageProps {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
  imgProps?: Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    'src' | 'alt' | 'style' | 'width' | 'height' | 'onClick'
  > & {
    [dataAttr: `data-${string}`]: string | number | boolean | undefined;
  };
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1100,
  padding: 16,
};

const modalImgStyle: CSSProperties = {
  display: 'block',
  width: '92vw',
  height: '92vh',
  maxWidth: '92vw',
  maxHeight: '92vh',
  objectFit: 'contain',
  borderRadius: 'var(--radius-md, 8px)',
  boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)',
};

const closeBtnStyle: CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 16,
  width: 40,
  height: 40,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.6)',
  color: '#ffffff',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: '999px',
  cursor: 'pointer',
  padding: 0,
  zIndex: 1101,
};

export function ZoomableImage({
  src,
  alt,
  width,
  height,
  style,
  imgProps,
}: ZoomableImageProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLImageElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const onBackdropClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setOpen(false);
    }
  }, []);

  const triggerStyle: CSSProperties = {
    cursor: 'zoom-in',
    ...style,
  };

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={triggerRef}
        src={src}
        alt={alt}
        width={width}
        height={height}
        style={triggerStyle}
        aria-haspopup="dialog"
        onClick={handleOpen}
        {...imgProps}
      />
      {open && mounted
        ? createPortal(
            <div
              data-testid="zoomable-image-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Image preview"
              onClick={onBackdropClick}
              style={backdropStyle}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                data-testid="zoomable-image-modal-img"
                src={src}
                alt={alt}
                style={modalImgStyle}
              />
              <button
                ref={closeBtnRef}
                type="button"
                data-testid="zoomable-image-close"
                aria-label="Close image preview"
                onClick={handleClose}
                style={closeBtnStyle}
              >
                <X size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
