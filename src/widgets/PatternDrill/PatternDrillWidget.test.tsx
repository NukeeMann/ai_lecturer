// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PatternDrillWidget } from './PatternDrillWidget';
import { patternDrillSample } from './sample';

afterEach(cleanup);

describe('PatternDrillWidget', () => {
  it('shows a card with category buttons and the IFCN checklist', () => {
    render(<PatternDrillWidget data={patternDrillSample} />);
    expect(screen.getByRole('button', { name: /Artefakt/ })).toBeTruthy();
    expect(screen.getByText(/IFCN criteria/)).toBeTruthy();
    expect(screen.getByText(/Criteria met/)).toBeTruthy();
  });

  it('counts ticked IFCN criteria', () => {
    render(<PatternDrillWidget data={patternDrillSample} />);
    const boxes = screen.getAllByRole('checkbox');
    boxes.slice(0, 4).forEach((b) => fireEvent.click(b));
    expect(screen.getAllByText('4/6').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/≥ 4 suggests/)).toBeTruthy();
  });

  it('gives feedback and finishes the deck with a summary', () => {
    render(<PatternDrillWidget data={patternDrillSample} />);
    // Both sample cards are artifacts: answer correctly twice.
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Artefakt/ }));
      expect(screen.getByText('Correct')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Next card/ }));
    }
    expect(screen.getByText(/First-try accuracy 100%/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /New shuffled round/ })).toBeTruthy();
  });

  it('shows the contrast pair and re-queues after a wrong answer', () => {
    render(<PatternDrillWidget data={{ ...patternDrillSample, session: { interleave: false } }} />);
    fireEvent.click(screen.getByRole('button', { name: /Wariant prawidłowy/ }));
    expect(screen.getByText(/Not quite — this is: Artefakt/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Next card/ }));
    expect(screen.getByText(/incl\. 1 to repeat/)).toBeTruthy();
  });

  it('answers with number keys', () => {
    render(<PatternDrillWidget data={patternDrillSample} />);
    fireEvent.keyDown(document.querySelector('[data-pattern-drill]') as Element, { key: '1' });
    expect(screen.getByText('Correct')).toBeTruthy();
  });
});
