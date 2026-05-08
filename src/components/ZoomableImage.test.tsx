// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ZoomableImage } from './ZoomableImage';

afterEach(() => {
  cleanup();
});

describe('ZoomableImage (US-131)', () => {
  it('renders the inline trigger img with the given src/alt and zoom-in cursor', () => {
    const { container } = render(<ZoomableImage src="/x.png" alt="a" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/x.png');
    expect(img!.getAttribute('alt')).toBe('a');
    expect(img!.style.cursor).toBe('zoom-in');
    expect(img!.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('opens the lightbox modal on click and closes it on Escape', () => {
    const { container } = render(<ZoomableImage src="/x.png" alt="a" />);
    expect(screen.queryByTestId('zoomable-image-modal')).toBeNull();

    const trigger = container.querySelector('img')!;
    fireEvent.click(trigger);

    const modal = screen.getByTestId('zoomable-image-modal');
    expect(modal).not.toBeNull();
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.getAttribute('aria-label')).toBe('Image preview');

    const modalImg = modal.querySelector('img');
    expect(modalImg).not.toBeNull();
    expect(modalImg!.getAttribute('src')).toBe('/x.png');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('zoomable-image-modal')).toBeNull();
  });
});
