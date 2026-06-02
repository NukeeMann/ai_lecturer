import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import {
  __setKernelRuntimeDepsForTesting,
  KernelRuntimeNotInstalledError,
  kernelCudaAvailable,
  kernelCudaMarkerPath,
  kernelDeviceMode,
  kernelPythonPath,
  kernelRuntimeDir,
  probeKernelRuntime,
  requireKernelRuntime,
  resolveKernelDevice,
  type KernelRuntimeDeps,
} from '@/lib/server/kernelRuntime';

let homeRoot: string;

// Minimal fake child that emits `close` with a configurable exit code on the
// next tick — enough to drive the `nvidia-smi -L` probe without a real GPU.
class FakeChildProcess extends EventEmitter {
  pid = 9101;
  constructor(exitCode: number) {
    super();
    setImmediate(() => {
      this.emit('exit', exitCode, null);
      setImmediate(() => this.emit('close', exitCode, null));
    });
  }
}

function nvidiaSmiSpawn(exitCode: number): KernelRuntimeDeps['spawn'] {
  return ((command: string) => {
    if (command === 'nvidia-smi') {
      return new FakeChildProcess(exitCode) as unknown as ChildProcess;
    }
    throw new Error('unexpected spawn: ' + command);
  }) as unknown as KernelRuntimeDeps['spawn'];
}

beforeEach(async () => {
  homeRoot = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-kernelhome-'));
  process.env.AI_LECTURER_HOME_OVERRIDE = homeRoot;
});

afterEach(async () => {
  __setKernelRuntimeDepsForTesting(null);
  delete process.env.AI_LECTURER_HOME_OVERRIDE;
  delete process.env.AI_LECTURER_PY_RUNTIME;
  delete process.env.AI_LECTURER_KERNEL_DEVICE;
  await fs.rm(homeRoot, { recursive: true, force: true });
});

describe('path helpers (US-196)', () => {
  it('defaults the venv dir under ~/.ai-lecturer/py-runtime', () => {
    expect(kernelRuntimeDir()).toBe(path.join(homeRoot, 'py-runtime'));
  });

  it('honours AI_LECTURER_PY_RUNTIME override', () => {
    process.env.AI_LECTURER_PY_RUNTIME = '/custom/py-runtime';
    expect(kernelRuntimeDir()).toBe('/custom/py-runtime');
    expect(kernelCudaMarkerPath()).toBe('/custom/py-runtime/.cuda-enabled');
  });

  it('points the python path inside the venv', () => {
    const py = kernelPythonPath();
    expect(py.startsWith(kernelRuntimeDir())).toBe(true);
    // POSIX layout in CI; on win32 it would be Scripts/python.exe.
    expect(py).toMatch(/python/);
  });
});

describe('kernelDeviceMode (US-196)', () => {
  it('defaults to auto', () => {
    expect(kernelDeviceMode()).toBe('auto');
  });
  it('reads cpu / cuda / auto verbatim', () => {
    process.env.AI_LECTURER_KERNEL_DEVICE = 'cpu';
    expect(kernelDeviceMode()).toBe('cpu');
    process.env.AI_LECTURER_KERNEL_DEVICE = 'CUDA';
    expect(kernelDeviceMode()).toBe('cuda');
    process.env.AI_LECTURER_KERNEL_DEVICE = 'auto';
    expect(kernelDeviceMode()).toBe('auto');
  });
  it('falls back to auto on unknown values', () => {
    process.env.AI_LECTURER_KERNEL_DEVICE = 'gpu';
    expect(kernelDeviceMode()).toBe('auto');
  });
});

describe('kernelCudaAvailable (US-196)', () => {
  it('available=true when marker present and nvidia-smi exits 0', async () => {
    __setKernelRuntimeDepsForTesting({
      spawn: nvidiaSmiSpawn(0),
      cudaMarkerExists: async () => true,
    });
    const probe = await kernelCudaAvailable();
    expect(probe.available).toBe(true);
  });

  it('available=false when the CUDA marker is missing (short-circuits before nvidia-smi)', async () => {
    __setKernelRuntimeDepsForTesting({
      spawn: (() => {
        throw new Error('nvidia-smi must not be probed when marker is missing');
      }) as unknown as KernelRuntimeDeps['spawn'],
      cudaMarkerExists: async () => false,
    });
    const probe = await kernelCudaAvailable();
    expect(probe.available).toBe(false);
  });

  it('available=false when nvidia-smi exits non-zero even with the marker present', async () => {
    __setKernelRuntimeDepsForTesting({
      spawn: nvidiaSmiSpawn(1),
      cudaMarkerExists: async () => true,
    });
    const probe = await kernelCudaAvailable();
    expect(probe.available).toBe(false);
  });

  it('memoizes the probe result across calls', async () => {
    let probeCount = 0;
    __setKernelRuntimeDepsForTesting({
      spawn: ((command: string) => {
        if (command === 'nvidia-smi') {
          probeCount += 1;
          return new FakeChildProcess(0) as unknown as ChildProcess;
        }
        throw new Error('unexpected spawn: ' + command);
      }) as unknown as KernelRuntimeDeps['spawn'],
      cudaMarkerExists: async () => true,
    });
    const first = await kernelCudaAvailable();
    const second = await kernelCudaAvailable();
    expect(first.available).toBe(true);
    expect(second.available).toBe(true);
    expect(probeCount).toBe(1);
  });
});

describe('resolveKernelDevice (US-196)', () => {
  it('auto + CUDA available → cuda', async () => {
    __setKernelRuntimeDepsForTesting({
      spawn: nvidiaSmiSpawn(0),
      cudaMarkerExists: async () => true,
    });
    expect(await resolveKernelDevice()).toBe('cuda');
  });

  it('auto + no CUDA → cpu', async () => {
    __setKernelRuntimeDepsForTesting({
      spawn: (() => {
        throw new Error('nvidia-smi must not run');
      }) as unknown as KernelRuntimeDeps['spawn'],
      cudaMarkerExists: async () => false,
    });
    expect(await resolveKernelDevice()).toBe('cpu');
  });

  it('AI_LECTURER_KERNEL_DEVICE=cuda forces cuda without probing', async () => {
    process.env.AI_LECTURER_KERNEL_DEVICE = 'cuda';
    __setKernelRuntimeDepsForTesting({
      spawn: (() => {
        throw new Error('device=cuda must not probe nvidia-smi');
      }) as unknown as KernelRuntimeDeps['spawn'],
      cudaMarkerExists: async () => {
        throw new Error('device=cuda must not check the marker');
      },
    });
    expect(await resolveKernelDevice()).toBe('cuda');
  });

  it('AI_LECTURER_KERNEL_DEVICE=cpu forces cpu even when CUDA would be available', async () => {
    process.env.AI_LECTURER_KERNEL_DEVICE = 'cpu';
    __setKernelRuntimeDepsForTesting({
      spawn: (() => {
        throw new Error('device=cpu must not probe nvidia-smi');
      }) as unknown as KernelRuntimeDeps['spawn'],
      cudaMarkerExists: async () => {
        throw new Error('device=cpu must not check the marker');
      },
    });
    expect(await resolveKernelDevice()).toBe('cpu');
  });
});

describe('probeKernelRuntime / requireKernelRuntime (US-196)', () => {
  it('reports installed=true with device when the venv python exists', async () => {
    __setKernelRuntimeDepsForTesting({
      spawn: nvidiaSmiSpawn(0),
      pythonExists: async () => true,
      cudaMarkerExists: async () => true,
    });
    const status = await probeKernelRuntime();
    expect(status.installed).toBe(true);
    expect(status.device).toBe('cuda');
    expect(status.runtimeDir).toBe(path.join(homeRoot, 'py-runtime'));
    expect(status.pythonPath).toBe(kernelPythonPath());
  });

  it('reports installed=false (device still resolved) when the venv is missing', async () => {
    __setKernelRuntimeDepsForTesting({
      pythonExists: async () => false,
      cudaMarkerExists: async () => false,
    });
    const status = await probeKernelRuntime();
    expect(status.installed).toBe(false);
    expect(status.device).toBe('cpu');
  });

  it('requireKernelRuntime resolves the status when installed', async () => {
    __setKernelRuntimeDepsForTesting({
      pythonExists: async () => true,
      cudaMarkerExists: async () => false,
    });
    const status = await requireKernelRuntime();
    expect(status.installed).toBe(true);
    expect(status.device).toBe('cpu');
  });

  it('requireKernelRuntime throws a typed KernelRuntimeNotInstalledError when missing', async () => {
    __setKernelRuntimeDepsForTesting({
      pythonExists: async () => false,
      cudaMarkerExists: async () => false,
    });
    await expect(requireKernelRuntime()).rejects.toBeInstanceOf(
      KernelRuntimeNotInstalledError,
    );
    await expect(requireKernelRuntime()).rejects.toThrow(/setup-kernel\.sh/);
  });
});
