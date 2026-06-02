// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import type { SandboxData } from './schema';

const runWithTestsMock = vi.fn();
const checkPackagesMock = vi.fn();
const stopMock = vi.fn();

// US-203: Sandbox free-run now executes on the real kernel via `useKernel`.
// Mock the kernel client (SandboxWidget + CodeRunner both consume it).
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
import { SandboxWidget } from './SandboxWidget';
import { KernelStopError } from '@/lib/kernel/client';

beforeEach(() => {
  runWithTestsMock.mockReset();
  checkPackagesMock.mockReset();
  checkPackagesMock.mockResolvedValue([]);
  stopMock.mockReset();
  if (typeof URL.createObjectURL !== 'function') {
    // jsdom does not implement object URLs.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () =>
      'blob:mock';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  }
});

afterEach(() => {
  cleanup();
});

function makeLiveData(overrides: Partial<SandboxData> = {}): SandboxData {
  return {
    starterCode:
      'import matplotlib.pyplot as plt\nplt.imshow([[1,2],[3,4]])\n',
    encouragement: 'Play with it.',
    outputMedia: {
      kind: 'image',
      src: '/placeholder.png',
      live: true,
    },
    ...overrides,
  };
}

describe('SandboxWidget (US-203) — kernel free-run', () => {
  it('runs free-run on the kernel and swaps the placeholder for a blob URL', async () => {
    runWithTestsMock.mockResolvedValueOnce({
      testResults: [],
      stdout: '',
      stderr: '',
      png: new Uint8Array([137, 80, 78, 71]),
    });

    const { getByTestId, container } = render(
      <SandboxWidget data={makeLiveData()} />,
    );

    await act(async () => {
      fireEvent.click(getByTestId('sandbox-live-run'));
    });

    await waitFor(() => {
      expect(runWithTestsMock).toHaveBeenCalledTimes(1);
    });
    // runWithTests called with no tests + live capture.
    const [, tests, options] = runWithTestsMock.mock.calls[0];
    expect(tests).toEqual([]);
    expect(options).toMatchObject({ captureLiveImage: true });

    await waitFor(() => {
      const img = container.querySelector('img[src^="blob:"]');
      expect(img).not.toBeNull();
    });
  });

  it('treats requiresPackages as a precondition and aborts without running', async () => {
    checkPackagesMock.mockResolvedValueOnce(['torch']);

    const { getByTestId, container } = render(
      <SandboxWidget data={makeLiveData({ requiresPackages: ['torch'] })} />,
    );

    await act(async () => {
      fireEvent.click(getByTestId('sandbox-live-run'));
    });

    await waitFor(() => {
      expect(checkPackagesMock).toHaveBeenCalledWith(['torch']);
    });
    // Missing package -> never executes user code.
    expect(runWithTestsMock).not.toHaveBeenCalled();
    const banner = container.querySelector('[data-sandbox-missing-packages]');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('data-packages')).toBe('torch');
  });

  it('surfaces a stop banner when the kernel run is stopped', async () => {
    runWithTestsMock.mockRejectedValueOnce(new KernelStopError('user'));

    const { getByTestId, container } = render(
      <SandboxWidget data={makeLiveData()} />,
    );

    await act(async () => {
      fireEvent.click(getByTestId('sandbox-live-run'));
    });

    await waitFor(() => {
      const banner = container.querySelector('[data-sandbox-stop]');
      expect(banner).not.toBeNull();
      expect(banner?.getAttribute('data-stop-reason')).toBe('user');
    });
  });

  it('keeps the encouragement UX unchanged', () => {
    const { container } = render(
      <SandboxWidget data={makeLiveData({ encouragement: 'Tinker freely.' })} />,
    );
    const enc = container.querySelector('[data-sandbox-encouragement]');
    expect(enc?.textContent).toBe('Tinker freely.');
  });
});
