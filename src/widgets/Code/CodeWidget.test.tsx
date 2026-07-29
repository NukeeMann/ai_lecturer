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
const checkPackagesMock = vi.fn();
const stopMock = vi.fn();

// US-202: Code Submit + Run now execute on the real kernel via `useKernel`.
// Mock the kernel client (CodeWidget + CodeRunner both consume it).
vi.mock('@/lib/kernel/client', () => ({
  useKernel: () => ({
    status: 'ready',
    run: vi.fn(),
    runWithTests: runWithTestsMock,
    checkPackages: checkPackagesMock,
    stop: stopMock,
    reset: vi.fn(),
  }),
  KernelStopError: class KernelStopError extends Error {
    reason: 'user' | 'timeout';
    constructor(reason: 'user' | 'timeout' = 'user') {
      super('stopped');
      this.name = 'KernelStopError';
      this.reason = reason;
    }
  },
}));

// CodeRunner still imports `subscribePyodideRestart` from the pyodide client to
// surface the legacy restart banner; stub it so no real worker is touched.
vi.mock('@/lib/pyodide/client', () => ({
  subscribePyodideRestart: () => () => {},
}));

// Import AFTER vi.mock so the mocked useKernel is what the widget sees.
import { CodeWidget } from './CodeWidget';

beforeEach(() => {
  runWithTestsMock.mockReset();
  checkPackagesMock.mockReset();
  checkPackagesMock.mockResolvedValue([]);
  stopMock.mockReset();
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

describe('CodeWidget (US-202) — requiresPackages precondition check', () => {
  it('blocks Run and shows an actionable message when a package is missing', async () => {
    checkPackagesMock.mockResolvedValueOnce(['torch']);

    const { container } = render(
      <CodeWidget data={makeLiveData({ requiresPackages: ['torch'] })} />,
    );

    const runBtn = container.querySelector(
      '[data-testid="codewidget-run"]',
    ) as HTMLButtonElement | null;
    expect(runBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(runBtn!);
    });

    await waitFor(() => {
      const banner = container.querySelector(
        '[data-codewidget-missing-packages]',
      );
      expect(banner).not.toBeNull();
      expect(banner!.getAttribute('data-packages')).toBe('torch');
      expect(banner!.textContent ?? '').toMatch(/run setup/i);
    });

    // Precondition failed → the kernel run is never attempted.
    expect(checkPackagesMock).toHaveBeenCalledTimes(1);
    expect(checkPackagesMock).toHaveBeenCalledWith(['torch']);
    expect(runWithTestsMock).not.toHaveBeenCalled();
  });

  it('runs normally when all required packages are importable', async () => {
    checkPackagesMock.mockResolvedValueOnce([]);
    runWithTestsMock.mockResolvedValueOnce({
      testResults: [],
      stdout: '',
      stderr: '',
      png: new Uint8Array([137, 80, 78, 71]),
    });

    const { container } = render(
      <CodeWidget data={makeLiveData({ requiresPackages: ['numpy'] })} />,
    );

    const runBtn = container.querySelector(
      '[data-testid="codewidget-run"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      fireEvent.click(runBtn!);
    });

    await waitFor(() => {
      expect(runWithTestsMock).toHaveBeenCalledTimes(1);
    });
    expect(
      container.querySelector('[data-codewidget-missing-packages]'),
    ).toBeNull();
  });
});
