// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EegViewerWidget } from './EegViewerWidget';
import { eegViewerSample } from './sample';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EegViewerWidget', () => {
  it('renders a badged simulation with toolbar and task', () => {
    render(<EegViewerWidget data={eegViewerSample} />);
    expect(screen.getAllByText('SYMULACJA').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('Montage')).toBeTruthy();
    expect(screen.getByText(/Zaznacz każdą iglicę/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows an error card for invalid data instead of crashing', () => {
    render(<EegViewerWidget data={{ source: { kind: 'simulation' } }} />);
    expect(screen.getByRole('alert').textContent).toMatch(/invalid/i);
  });

  it('changes sensitivity with the toolbar buttons', () => {
    render(<EegViewerWidget data={eegViewerSample} />);
    const sel = screen.getByLabelText('Sens') as HTMLSelectElement;
    expect(sel.value).toBe('10');
    fireEvent.click(screen.getByLabelText('Larger traces (lower µV/mm)'));
    expect((screen.getByLabelText('Sens') as HTMLSelectElement).value).toBe('7');
  });

  it('loads a recording asset via fetch and shows its attribution', async () => {
    const { encodeRecording } = await import('@/lib/eeg');
    const n = 256 * 4;
    const sig = (f: number) => Array.from({ length: n }, (_, i) => 20 * Math.sin((2 * Math.PI * f * i) / 256));
    const file = encodeRecording({
      sampleRate: 256,
      reference: 'common',
      signals: ['Fp1', 'F7', 'T7', 'P7', 'O1', 'Fp2', 'F8', 'T8', 'P8', 'O2'].map((label, k) => ({ label, data: sig(5 + k) })),
      source: { dataset: 'Test set', record: 'r1', license: 'CC BY 4.0', url: 'https://example.org' },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(file), { status: 200 }));
    await act(async () => {
      render(<EegViewerWidget data={{ source: { kind: 'recording', src: '/api/courses/c/assets/eeg/r1.json' } }} />);
    });
    expect(await screen.findByText(/CC BY 4\.0/)).toBeTruthy();
    expect(screen.queryByText('SYMULACJA')).toBeNull();
  });

  it('reports a failed load', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404, statusText: 'Not Found' }));
    await act(async () => {
      render(<EegViewerWidget data={{ source: { kind: 'recording', src: '/api/courses/c/assets/eeg/missing.json' } }} />);
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/404/);
  });
});
