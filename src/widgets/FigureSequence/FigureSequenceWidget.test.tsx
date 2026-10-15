// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FigureSequenceWidget } from './FigureSequenceWidget';
import { figureSequenceSample } from './sample';

afterEach(cleanup);

describe('FigureSequenceWidget', () => {
  it('slider: moves across frames and completes after all were seen', () => {
    const onComplete = vi.fn();
    render(<FigureSequenceWidget data={figureSequenceSample} onComplete={onComplete} />);
    expect(screen.getByText('Wiek: 11 mies.')).toBeTruthy();
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '3' } });
    expect(screen.getByText('Wiek: 10 lat')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('stepper: dots and arrow keys', () => {
    render(<FigureSequenceWidget data={{ ...figureSequenceSample, layout: 'stepper' }} />);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    fireEvent.keyDown(document.querySelector('[data-figure-sequence]') as Element, { key: 'ArrowRight' });
    expect(screen.getByText('12 mies.', { selector: 'strong' })).toBeTruthy();
  });

  it('compare: two panes with selectors', () => {
    render(<FigureSequenceWidget data={{ ...figureSequenceSample, layout: 'compare', compareDefaults: ['m11', 'y10'] }} />);
    expect((screen.getByLabelText('Left') as HTMLSelectElement).value).toBe('0');
    expect((screen.getByLabelText('Right') as HTMLSelectElement).value).toBe('3');
    expect(screen.getAllByText(/CC BY-NC-SA/)).toHaveLength(2);
  });
});
