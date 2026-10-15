// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EegCaseWidget } from './EegCaseWidget';
import { eegCaseSample } from './sample';

afterEach(cleanup);

describe('EegCaseWidget', () => {
  it('shows the vignette and only the first step', () => {
    render(<EegCaseWidget data={eegCaseSample} />);
    expect(screen.getByText(/zawieszania się/)).toBeTruthy();
    expect(screen.getByText(/Step 1 of 5/)).toBeTruthy();
    expect(screen.queryByText(/Step 2 of 5/)).toBeNull();
  });

  it('gives one more try, then reveals the answer and unlocks the next step', () => {
    render(<EegCaseWidget data={eegCaseSample} />);
    fireEvent.click(screen.getByLabelText('T7'));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText(/one more try/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('O1'));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(screen.getByText(/correct answer is highlighted/)).toBeTruthy();
    expect(screen.getByText(/Step 2 of 5/)).toBeTruthy();
  });

  it('restores progress and shows the summary when all steps are done', () => {
    const done = { attempts: 1, firstCorrect: true, done: true };
    render(
      <EegCaseWidget
        data={eegCaseSample}
        initialWidgetState={{ v: 1, answers: { where: { ...done, value: [0] }, mark: done, why: { ...done, value: [0, 1] }, grid: { ...done, value: 1000 }, confirm: { ...done, value: true } } }}
      />,
    );
    expect(screen.getByText(/Expert summary · 4\/4/)).toBeTruthy();
  });
});
