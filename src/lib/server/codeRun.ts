// US-201: normalize a raw `KernelExecuteResult` (US-197 kernel manager) into
// the stable, Pyodide-mirroring shape that the `useKernel` client consumes.
//
// The client (`src/lib/kernel/client.ts`) reads an NDJSON stream of events from
// `POST /api/code/run`, the last of which is a single `final` event whose field
// names match `RunResult` (stdout / stderr / traceback / errorType /
// errorMessage) plus `images` and a coarse `status`. We keep the kernel path
// structurally identical to the Pyodide path so the widgets are runtime-blind.

import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import type { KernelExecuteResult } from '@/lib/server/kernelManager';

/** A lesson input file already fetched server-side, ready to write into the
 *  kernel session. */
export interface MountableInput {
  filename: string;
  /** Base64-encoded file bytes. */
  b64: string;
}

/** The virtual mount root lesson code references (`cv2.imread('/inputs/x.png')`).
 *  In the Pyodide worker this is a real writable VFS path, but on the host
 *  IPython kernel (US-201) the filesystem root isn't writable to the non-root
 *  dev-server user — `os.makedirs('/inputs')` throws `PermissionError [Errno
 *  13]`. So on the kernel path we map this virtual root to a real writable
 *  directory (`resolveInputsDir`) and rewrite it in the cells we send. */
export const INPUTS_MOUNT_PATH = '/inputs';

/**
 * Real, writable host directory that the virtual `/inputs` root maps to for a
 * given lesson session. cv2 / PIL open the literal path with C-level I/O, so we
 * can't shim it in Python — the path must resolve on the real filesystem. We
 * key by course+lesson so a re-run reuses the same mounted files and two
 * lessons can't collide on a shared filename.
 */
export function resolveInputsDir(courseSlug: string, lessonSlug: string): string {
  const base =
    process.env.KERNEL_INPUTS_DIR ?? path.join(os.tmpdir(), 'ai-lecturer-kernel');
  const key = crypto
    .createHash('sha1')
    .update(`${courseSlug}\n${lessonSlug}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(base, key, 'inputs');
}

/**
 * Build a Python cell that writes the given input files into `<mountDir>/<name>`
 * inside the kernel session (defaults to the virtual `/inputs` root). Paired
 * with `rewriteInputsPath`, user code reading `/inputs/x.png` resolves here
 * (US-201). Executed as its own cell before the user's code so it never shifts
 * the user traceback's line numbers.
 */
export function buildInputsMountCode(
  files: MountableInput[],
  mountDir: string = INPUTS_MOUNT_PATH,
): string {
  const lines = [
    'import os, base64',
    `os.makedirs(${JSON.stringify(mountDir)}, exist_ok=True)`,
  ];
  // The Submit/test path base64-encodes user code inside the harness, hiding it
  // from the route's text-level `rewriteInputsPath`. Register the real mount dir
  // (and the virtual root it stands in for) in the kernel namespace so the test
  // harness can rewrite the virtual `/inputs` root at runtime instead. No-op on
  // the Pyodide path, which mounts into a real `/inputs` VFS and never runs this.
  if (mountDir !== INPUTS_MOUNT_PATH) {
    lines.push(
      `globals()['__ai_inputs_dir'] = ${JSON.stringify(mountDir)}`,
      `globals()['__ai_inputs_root'] = ${JSON.stringify(INPUTS_MOUNT_PATH)}`,
    );
  }
  for (const f of files) {
    const filePath = JSON.stringify(`${mountDir}/${f.filename}`);
    lines.push(
      `with open(${filePath}, 'wb') as __ai_f:`,
      `    __ai_f.write(base64.b64decode(${JSON.stringify(f.b64)}))`,
    );
  }
  if (files.length > 0) lines.push('del __ai_f');
  return lines.join('\n') + '\n';
}

// Matches the virtual `/inputs` mount root only at a path boundary: it must be
// preceded by a string/line start or a non-word, non-slash char (a quote,
// paren, comma…) and followed by `/`, end, or a closing/separator char. That
// catches `'/inputs/x.png'` and `os.listdir('/inputs')` without mangling
// identifiers (`/inputs2`) or unrelated paths that merely end in `/inputs`.
const INPUTS_PATH_RE = /(^|[^\w/])\/inputs(?=$|[/'"`)\]\s,:])/g;

/**
 * Rewrite references to the virtual `/inputs` mount root in user code so they
 * resolve to the real writable directory the files were mounted into. A no-op
 * when `mountDir` is the virtual root itself (e.g. the Pyodide VFS).
 */
export function rewriteInputsPath(code: string, mountDir: string): string {
  if (mountDir === INPUTS_MOUNT_PATH) return code;
  return code.replace(INPUTS_PATH_RE, (_m, pre: string) => `${pre}${mountDir}`);
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
