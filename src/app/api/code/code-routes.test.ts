// US-201: route layer over the kernel manager. The manager itself is mocked so
// these tests exercise validation, the NDJSON `final` shape, error mapping, and
// the control endpoints without spawning a real kernel.
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KernelExecuteResult } from '@/lib/server/kernelManager';
import { KernelRuntimeNotInstalledError } from '@/lib/server/kernelManager';

const { execute, interrupt, restart, reset } = vi.hoisted(() => ({
  execute: vi.fn(),
  interrupt: vi.fn(),
  restart: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('@/lib/server/kernelManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/kernelManager')>();
  return {
    ...actual,
    kernelManager: { execute, interrupt, restart, reset },
  };
});

import { POST as runPost } from './run/route';
import { POST as interruptPost } from './interrupt/route';
import { POST as restartPost } from './restart/route';
import { POST as resetPost } from './reset/route';

const SESSION = { courseSlug: 'c', lessonSlug: 'l', sectionId: 's' };

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/code/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function okResult(p: Partial<KernelExecuteResult>): KernelExecuteResult {
  return { status: 'ok', stdout: '', stderr: '', result: null, error: null, images: [], ...p };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/code/run', () => {
  it('returns a final NDJSON event from the kernel result', async () => {
    execute.mockResolvedValue(okResult({ stdout: '42\n' }));
    const res = await runPost(postReq({ ...SESSION, code: 'print(42)' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('ndjson');
    const text = (await res.text()).trim();
    const event = JSON.parse(text);
    expect(event).toMatchObject({ type: 'final', stdout: '42\n', status: 'ok' });
    expect(execute).toHaveBeenCalledWith('c', 'l', 'print(42)');
  });

  it('surfaces images in the final event', async () => {
    execute.mockResolvedValue(okResult({ images: ['PNGDATA'] }));
    const res = await runPost(postReq({ ...SESSION, code: 'show()' }));
    const event = JSON.parse((await res.text()).trim());
    expect(event.images).toEqual(['PNGDATA']);
  });

  it('rejects an invalid body with 400', async () => {
    const res = await runPost(postReq({ courseSlug: 'c' }));
    expect(res.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('maps a missing runtime to 503 with a code', async () => {
    execute.mockRejectedValue(new KernelRuntimeNotInstalledError('/x', '/x/py'));
    const res = await runPost(postReq({ ...SESSION, code: '1' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('kernel_runtime_not_installed');
  });

  it('mounts inputs before the user code when provided', async () => {
    execute.mockResolvedValue(okResult({ stdout: 'done\n' }));
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const res = await runPost(
      postReq({
        ...SESSION,
        code: 'print(open("/inputs/x.bin","rb").read())',
        inputs: [{ filename: 'x.bin', src: '/assets/x.bin' }],
      }),
    );
    expect(res.status).toBe(200);
    // First execute writes the mount cell, second runs the user code. Both the
    // mount cell and the user's `/inputs` reference are rewritten to a real
    // writable dir (the host FS root isn't writable to the kernel user).
    expect(execute).toHaveBeenCalledTimes(2);
    const mountCell = execute.mock.calls[0][2] as string;
    const userCell = execute.mock.calls[1][2] as string;
    expect(mountCell).toContain('os.makedirs(');
    expect(mountCell).not.toContain('"/inputs/x.bin"');
    expect(userCell).toContain('print(open');
    expect(userCell).not.toContain('"/inputs/x.bin"');
    // The mount target and the rewritten user path resolve to the same dir.
    const mountDir = /os\.makedirs\("([^"]+)"/.exec(mountCell)?.[1];
    expect(mountDir).toBeTruthy();
    expect(mountDir).not.toBe('/inputs');
    expect(userCell).toContain(`"${mountDir}/x.bin"`);
    fetchSpy.mockRestore();
  });
});

describe('control routes', () => {
  it('interrupt calls the manager and returns ok', async () => {
    interrupt.mockResolvedValue(undefined);
    const res = await interruptPost(postReq(SESSION));
    expect(res.status).toBe(200);
    expect(interrupt).toHaveBeenCalledWith('c', 'l');
  });

  it('restart calls the manager', async () => {
    restart.mockResolvedValue(undefined);
    const res = await restartPost(postReq(SESSION));
    expect(res.status).toBe(200);
    expect(restart).toHaveBeenCalledWith('c', 'l');
  });

  it('reset calls the manager', async () => {
    reset.mockResolvedValue(undefined);
    const res = await resetPost(postReq(SESSION));
    expect(res.status).toBe(200);
    expect(reset).toHaveBeenCalledWith('c', 'l');
  });

  it('rejects an invalid control body with 400', async () => {
    const res = await interruptPost(postReq({ courseSlug: 'c' }));
    expect(res.status).toBe(400);
    expect(interrupt).not.toHaveBeenCalled();
  });
});
