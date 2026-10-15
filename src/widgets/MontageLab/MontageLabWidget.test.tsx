// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MontageLabWidget } from './MontageLabWidget';
import { montageLabSample } from './sample';

afterEach(cleanup);

describe('MontageLabWidget', () => {
  it('always shows the simulation badge and the montage buttons', () => {
    render(<MontageLabWidget data={montageLabSample} />);
    expect(screen.getAllByText('SYMULACJA').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Double banana' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Average ref' })).toBeTruthy();
  });

  it('answers an electrode challenge by clicking the head map and shows the explanation', () => {
    render(<MontageLabWidget data={montageLabSample} />);
    expect(screen.getByText(/Kliknij na główce/)).toBeTruthy();
    const f8 = document.querySelector('[data-electrode="F8"]') as Element;
    fireEvent.keyDown(f8, { key: 'Enter' });
    expect(screen.getByText(/Correct — F8/)).toBeTruthy();
    expect(screen.getByText(/odwrócenie fazy na/)).toBeTruthy();
  });

  it('marks a wrong electrode answer', () => {
    render(<MontageLabWidget data={montageLabSample} />);
    fireEvent.keyDown(document.querySelector('[data-electrode="O1"]') as Element, { key: 'Enter' });
    expect(screen.getByText(/you chose O1/)).toBeTruthy();
  });

  it('shows the computed localisation when there are no challenges', () => {
    render(<MontageLabWidget data={{ scenario: { preset: 'phaseReversalF8' } }} />);
    // Panel + the canvas description for screen readers.
    expect(screen.getAllByText(/Ujemne odwrócenie fazy/).length).toBeGreaterThanOrEqual(1);
  });

  it('rejects invalid data with an error card', () => {
    render(<MontageLabWidget data={{ scenario: { preset: 'nope' } }} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
