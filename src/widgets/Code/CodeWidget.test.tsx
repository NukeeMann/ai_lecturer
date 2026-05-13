// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';

import type { CodeData } from './schema';

const runWithTestsMock = vi.fn();

vi.mock('@/lib/pyodide/client', () => ({
  usePyodide: () => ({
    status: 'ready',
    run: vi.fn(),
    runWithTests: runWithTestsMock,
    runWithPlotParam: vi.fn(),
    gaussFilter: vi.fn(),
    resetNamespace: vi.fn(),
    stop: vi.fn(),
  }),
  subscribePyodideRestart: () => () => {},
  PyodideStopError: class PyodideStopError extends Error {
    reason = 'user' as const;
  },
  PYODIDE_EXECUTION_TIMEOUT_MS: 30_000,
}));

// Import AFTER vi.mock so the mocked usePyodide is what the widget sees.
import { CodeWidget } from './CodeWidget';

beforeEach(() => {
  runWithTestsMock.mockReset();
});

afterEach(() => {
  cleanup();
});

function makeLiveData(overrides: Partial<CodeData> = {}): CodeData {
  return {
    taskMarkdown: 'demo',
    starterCode:
      'import matplotlib.pyplot as plt\nplt.imshow([[1,2],[3,4]])\n',
    tests: [],
    outputMedia: {
      kind: 'image',
      src: '/placeholder.png',
      live: true,
    },
    ...overrides,
  };
}

describe('CodeWidget (US-174) — live matplotlib figure capture', () => {
  it('swaps the static src for a blob URL when runWithTests returns png bytes', async () => {
    runWithTestsMock.mockResolvedValueOnce({
      testResults: [],
      stdout: '',
      stderr: '',
      png: new Uint8Array([137, 80, 78, 71]),
    });

    const { container } = render(<CodeWidget data={makeLiveData()} />);

    const runBtn = container.querySelector(
      '[data-testid="codewidget-run"]',
    ) as HTMLButtonElement | null;
    expect(runBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(runBtn!);
    });

    await waitFor(() => {
      const img = container.querySelector(
        '[data-codewidget-output-media] img[data-codewidget-output-img]',
      ) as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src') ?? '').toMatch(/^blob:/);
    });

    expect(runWithTestsMock).toHaveBeenCalledTimes(1);
    const opts = runWithTestsMock.mock.calls[0][2];
    expect(opts).toMatchObject({ captureLiveImage: true });
  });

  it('keeps the static src when runWithTests returns without png bytes', async () => {
    runWithTestsMock.mockResolvedValueOnce({
      testResults: [],
      stdout: '',
      stderr: '',
    });

    const { container } = render(<CodeWidget data={makeLiveData()} />);

    const runBtn = container.querySelector(
      '[data-testid="codewidget-run"]',
    ) as HTMLButtonElement | null;
    expect(runBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(runBtn!);
    });

    // Wait one tick for the awaited promise + setState to flush.
    await waitFor(() => {
      expect(runWithTestsMock).toHaveBeenCalledTimes(1);
    });

    const img = container.querySelector(
      '[data-codewidget-output-media] img[data-codewidget-output-img]',
    ) as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/placeholder.png');
    expect(img!.getAttribute('src') ?? '').not.toMatch(/^blob:/);
  });
});
