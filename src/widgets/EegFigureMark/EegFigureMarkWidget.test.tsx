// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { markAt } from '@/widgets/common/eeg/FigureMarkBoard';

import { EegFigureMarkWidget } from './EegFigureMarkWidget';
import { eegFigureMarkSample } from './sample';

afterEach(cleanup);

describe('EegFigureMarkWidget', () => {
  it('renders the prompt, tools, attribution and a disabled Check', () => {
    render(<EegFigureMarkWidget data={eegFigureMarkSample} />);
    expect(screen.getByText(/mrugnięcie/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mark/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Caliper/ })).toBeTruthy();
    expect(screen.getByText(/CC BY-NC-SA 4\.0/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('restores a checked state with feedback', () => {
    render(
      <EegFigureMarkWidget
        data={eegFigureMarkSample}
        initialWidgetState={{ v: 1, marks: [{ kind: 'box', x: 0.3, y: 0.2, w: 0.04, h: 0.4 }], checked: true }}
      />,
    );
    expect(screen.getByText(/Found 1 of 1/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy();
  });
  it('shows a readable error for invalid data', () => {
    render(<EegFigureMarkWidget data={{ prompt: 'x' }} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('markAt', () => {
  const marks = [
    { id: 'm1', kind: 'point' as const, x: 0.5, y: 0.5 },
    { id: 'm2', kind: 'box' as const, x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
  ];
  it('hits points within the radius and boxes by containment', () => {
    expect(markAt(marks, { x: 0.505, y: 0.5 })).toBe('m1');
    expect(markAt(marks, { x: 0.15, y: 0.15 })).toBe('m2');
    expect(markAt(marks, { x: 0.8, y: 0.8 })).toBeNull();
  });
});
