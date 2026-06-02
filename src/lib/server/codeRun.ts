// US-201: normalize a raw `KernelExecuteResult` (US-197 kernel manager) into
// the stable, Pyodide-mirroring shape that the `useKernel` client consumes.
//
// The client (`src/lib/kernel/client.ts`) reads an NDJSON stream of events from
// `POST /api/code/run`, the last of which is a single `final` event whose field
// names match `RunResult` (stdout / stderr / traceback / errorType /
// errorMessage) plus `images` and a coarse `status`. We keep the kernel path
// structurally identical to the Pyodide path so the widgets are runtime-blind.

import type { KernelExecuteResult } from '@/lib/server/kernelManager';

/** A lesson input file already fetched server-side, ready to write into the
 *  kernel session. */
export interface MountableInput {
  filename: string;
  /** Base64-encoded file bytes. */
  b64: string;
}

/**
 * Build a Python cell that writes the given input files into `/inputs/<name>`
 * inside the kernel session — the same VFS path the Pyodide worker mounts to,
 * so user code (`cv2.imread('/inputs/x.png')`) reads them identically (US-201).
 * Executed as its own cell before the user's code so it never shifts the user
 * traceback's line numbers.
 */
export function buildInputsMountCode(files: MountableInput[]): string {
  const lines = ['import os, base64', "os.makedirs('/inputs', exist_ok=True)"];
  for (const f of files) {
    const path = JSON.stringify(`/inputs/${f.filename}`);
    lines.push(
      `with open(${path}, 'wb') as __ai_f:`,
      `    __ai_f.write(base64.b64decode(${JSON.stringify(f.b64)}))`,
    );
  }
  if (files.length > 0) lines.push('del __ai_f');
  return lines.join('\n') + '\n';
}

/** The single aggregated `final` event written to the NDJSON run stream. */
export interface CodeRunFinalEvent {
  type: 'final';
  stdout: string;
  stderr: string;
  traceback?: string;
  errorType?: string;
  errorMessage?: string;
  images?: string[];
  status: 'ok' | 'timeout' | 'error';
}

// Matches CSI / SGR ANSI escape sequences (IPython colorizes tracebacks).
const ANSI_RE = /\[[0-9;]*m/g;

/** Strip ANSI color codes so the rendered traceback is plain text — parity with
 *  the Pyodide worker, whose tracebacks are uncolored. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/**
 * Map a kernel execution result to the `final` run event. On a Python error the
 * IPython traceback (a list of colorized lines) is ANSI-stripped and joined;
 * `ename` / `evalue` populate `errorType` / `errorMessage`, mirroring the
 * Pyodide worker's normalization.
 */
export function toCodeRunFinal(result: KernelExecuteResult): CodeRunFinalEvent {
  const event: CodeRunFinalEvent = {
    type: 'final',
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
  if (result.images && result.images.length > 0) {
    event.images = result.images;
  }
  if (result.error) {
    const traceback = stripAnsi((result.error.traceback ?? []).join('\n')).trimEnd();
    event.traceback = traceback || `${result.error.ename}: ${result.error.evalue}`;
    if (result.error.ename) event.errorType = result.error.ename;
    if (result.error.evalue) event.errorMessage = result.error.evalue;
  }
  return event;
}
