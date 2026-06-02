// US-201: shared HTTP error mapping for the `/api/code/*` routes. Translates the
// typed kernel errors (US-196 runtime missing, bridge start failure, dead
// session, bad slug) into `{ status, body }` so a missing runtime renders as a
// 503 the client can detect via `isRuntimeNotInstalled` before any 200 stream
// opens.

import { InvalidSlugError } from '@/lib/server/paths';
import {
  KernelRuntimeNotInstalledError,
  KernelStartError,
  KernelDeadError,
} from '@/lib/server/kernelManager';

export interface CodeRunErrorResponse {
  status: number;
  body: { error: string; code?: string };
}

export function mapKernelError(err: unknown): CodeRunErrorResponse {
  if (err instanceof KernelRuntimeNotInstalledError) {
    return {
      status: 503,
      body: {
        error:
          'Python kernel runtime is not installed. Install it from Settings to run code.',
        code: 'kernel_runtime_not_installed',
      },
    };
  }
  if (err instanceof KernelStartError) {
    return {
      status: 503,
      body: { error: `Kernel failed to start: ${err.message}`, code: 'kernel_start_failed' },
    };
  }
  if (err instanceof KernelDeadError) {
    return {
      status: 503,
      body: { error: `Kernel session ended: ${err.message}`, code: 'kernel_dead' },
    };
  }
  if (err instanceof InvalidSlugError) {
    return { status: 400, body: { error: err.message, code: 'invalid_session' } };
  }
  const message = err instanceof Error ? err.message : 'Unknown kernel error';
  return { status: 500, body: { error: message, code: 'kernel_error' } };
}
